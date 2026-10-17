package nl.detussenpartij.tick;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;

/** Opent Tick (de PWA in de app) op een bepaalde plek. */
final class Launch {
    private Launch() {}

    /**
     * Opent een taak in de TWA. Het adres ligt op Api.BASE, dezelfde https-oorsprong als DEFAULT_URL, dus de
     * Browser Helper vertrouwt het en gebruikt het (zie TickLauncherActivity). Zonder sleutel komt er pair=1 bij.
     */
    static void task(Context c, String taskId) {
        c.startActivity(new Intent(c, TickLauncherActivity.class)
                .setAction(Intent.ACTION_VIEW)
                .setData(Uri.parse(StartUrl.task(Api.BASE, taskId, Prefs.token(c).isEmpty())))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    }
}
