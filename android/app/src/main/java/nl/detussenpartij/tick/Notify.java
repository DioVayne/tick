package nl.detussenpartij.tick;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.drawable.Icon;
import android.net.Uri;
import android.os.Bundle;
import android.service.notification.StatusBarNotification;

/** Meldingen op het toestel; nu alleen voor locatiereminders. */
final class Notify {
    static final String CHANNEL = "locatie";

    /** Maakt het kanaal "locatie" aan (mag vaker), zodat het al in te stellen is voordat er een melding is. */
    static NotificationChannel ensureChannel(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, c.getString(R.string.loc_channel), NotificationManager.IMPORTANCE_HIGH));
        return nm.getNotificationChannel(CHANNEL);
    }

    /** Of het kanaal "locatie" door de gebruiker uitgezet is. */
    static boolean channelBlocked(Context c) {
        NotificationChannel ch = ensureChannel(c);
        return ch == null || ch.getImportance() == NotificationManager.IMPORTANCE_NONE;
    }

    /** Extra in de melding: GeoPlan.key van de plek, voor het wegvegen (ook na doneFailed). */
    private static final String EXTRA_KEY = "tick_key";

    /**
     * Melding voor een taak bij aankomst of vertrek. Tik opent de taak in de web-app, "Afvinken" rondt hem af,
     * wegvegen zet de herinnering weer klaar voor de volgende keer. key: GeoPlan.key van de plek.
     * Geeft false als meldingen (of het kanaal "locatie") uit staan en er dus niets te zien is.
     */
    static boolean location(Context c, String id, String key, String title, String text) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (channelBlocked(c) || !nm.areNotificationsEnabled()) return false;
        try {
            nm.notify(id.hashCode(), build(c, id, key, title, text));
            return true;
        } catch (SecurityException e) {
            return false; // geen toestemming voor meldingen (meer)
        }
    }

    /**
     * Afvinken vanuit de melding is mislukt: de melding blijft staan, met een tekst die dat zegt.
     * Is de melding er niet (meer), bijvoorbeeld bij afvinken in de widget, dan gebeurt er niets.
     */
    static void doneFailed(Context c, String id, String reason) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        int code = id.hashCode();
        for (StatusBarNotification sbn : nm.getActiveNotifications()) {
            if (sbn.getId() != code || !CHANNEL.equals(sbn.getNotification().getChannelId())) continue;
            CharSequence title = sbn.getNotification().extras.getCharSequence(Notification.EXTRA_TITLE);
            String key = sbn.getNotification().extras.getString(EXTRA_KEY);
            try {
                nm.notify(code, build(c, id, key, title == null ? "" : title.toString(), c.getString(R.string.loc_done_failed, reason)));
            } catch (SecurityException ignored) {
                // meldingen staan uit; de Toast zegt het dan nog
            }
            return;
        }
    }

    private static Notification build(Context c, String id, String key, String title, String text) {
        int code = id.hashCode();
        // Eigen data-URI per taak, zodat de PendingIntents van verschillende taken elkaar niet overschrijven.
        Uri data = Uri.parse("tick://taak/" + Uri.encode(id));
        // Openen loopt via WidgetClickActivity naar Launch.task (de taak in de TWA). Via die tussenstap bepaalt de app
        // pas bij de tik of er pair=1 bij moet, en niet al toen de melding verscheen.
        PendingIntent open = PendingIntent.getActivity(c, code,
                new Intent(c, WidgetClickActivity.class).setData(data)
                        .putExtra(ActionReceiver.EXTRA_ID, id)
                        .putExtra(WidgetClickActivity.EXTRA_ACTION, WidgetClickActivity.ACTION_OPEN),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent done = PendingIntent.getBroadcast(c, code,
                new Intent(c, ActionReceiver.class).setAction(ActionReceiver.ACTION_DONE).setData(data)
                        .putExtra(ActionReceiver.EXTRA_ID, id)
                        .putExtra(ActionReceiver.EXTRA_FROM_NOTIFICATION, true),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        // Wegvegen (niet tikken of afvinken): de herinnering komt de volgende keer terug. Eigen request-code, zodat hij
        // de intent van "Afvinken" niet overschrijft. Zonder key (oude melding) geen actie.
        PendingIntent dismissed = key == null ? null : PendingIntent.getBroadcast(c, code ^ 0x5EED,
                new Intent(c, ActionReceiver.class).setAction(ActionReceiver.ACTION_DISMISSED).setData(data)
                        .putExtra(ActionReceiver.EXTRA_ID, id)
                        .putExtra(ActionReceiver.EXTRA_KEY, key),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Bundle extras = new Bundle();
        if (key != null) extras.putString(EXTRA_KEY, key);

        return new Notification.Builder(c, CHANNEL)
                .addExtras(extras)
                .setDeleteIntent(dismissed)
                .setSmallIcon(R.drawable.ic_notify_place)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setCategory(Notification.CATEGORY_REMINDER)
                .setContentIntent(open)
                .setAutoCancel(true)
                .setOnlyAlertOnce(true) // een bijgewerkte melding (afvinken mislukt) trilt niet opnieuw
                .addAction(new Notification.Action.Builder(Icon.createWithResource(c, R.drawable.ic_check_done),
                        c.getString(R.string.done), done).build())
                .build();
    }

    static void cancel(Context c, String id) {
        c.getSystemService(NotificationManager.class).cancel(id.hashCode());
    }

    private Notify() {}
}
