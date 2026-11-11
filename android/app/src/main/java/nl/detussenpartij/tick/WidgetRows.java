package nl.detussenpartij.tick;

import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.StrikethroughSpan;
import android.util.TypedValue;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONObject;

import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Bouwt de rijen van de widget (taak en kopje) als RemoteViews. Dezelfde code vult de lijst op het startscherm
 * (TaskListService) en het voorbeeld in de instellingen (SettingsActivity, via RemoteViews.apply), zodat het voorbeeld
 * precies de widget is. Elke stap (uiterlijk, titel, metaregel, lijstpil, klikken) is een eigen methode; iets nieuws in
 * de rij krijgt er een bij.
 */
final class WidgetRows {
    private static final DateTimeFormatter FMT =
            DateTimeFormatter.ofPattern("EEE d MMM HH:mm", Locale.getDefault()).withZone(ZoneId.systemDefault());
    private static final int[] META_ICONS = {R.id.bell, R.id.repeat, R.id.place, R.id.people, R.id.copy, R.id.subtasks};
    private static final int[] EXTRA_ICONS = {R.id.repeat, R.id.place, R.id.people, R.id.copy, R.id.subtasks, R.id.subtask_count};

    private final Context ctx;
    private final WidgetLook look;
    private final String view;
    private final Map<String, Integer> subtasks;
    private final Set<String> listNames;
    private final Instant now;

    WidgetRows(Context ctx, WidgetLook look, String view, Map<String, Integer> subtasks, Set<String> listNames, Instant now) {
        this.ctx = ctx;
        this.look = look;
        this.view = view == null ? "" : view;
        this.subtasks = subtasks;
        this.listNames = listNames;
        this.now = now;
    }

    /** Kopje boven een groep (alleen in de weergave Ruim). Te laat in de kleur van te laat. */
    RemoteViews section(int section) {
        RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_section);
        int text;
        switch (section) {
            case WidgetSections.OVERDUE: text = R.string.widget_section_overdue; break;
            case WidgetSections.TODAY: text = R.string.widget_section_today; break;
            case WidgetSections.PINNED: text = R.string.widget_section_pinned; break;
            default: text = R.string.widget_section_other; break;
        }
        rv.setTextViewText(R.id.section_text, ctx.getString(text));
        rv.setTextViewTextSize(R.id.section_text, TypedValue.COMPLEX_UNIT_SP, look.sectionSp());
        rv.setTextColor(R.id.section_text, ctx.getColor(section == WidgetSections.OVERDUE ? R.color.overdue : R.color.widget_muted));
        return rv;
    }

    /** Een taak. doneAt: moment van de afvinktik (ms), of 0 als hij open is. groupEnd: extra ruimte erna. */
    RemoteViews task(JSONObject t, long doneAt, boolean groupEnd) {
        RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_item);
        boolean done = doneAt > 0;
        applyLook(rv, groupEnd);
        bindTitle(rv, t, done);
        boolean meta = bindMeta(rv, t, done);
        rv.setViewVisibility(R.id.meta, meta ? View.VISIBLE : View.GONE);
        bindPill(rv, t, done);
        bindClicks(rv, t, doneAt);
        return rv;
    }

    /**
     * Maten uit WidgetLook: tekstgrootte, bolletje dat meeschaalt (tikvlak minstens 48 dp), ruimte boven en onder het
     * tekstblok, tegeltje of vlakke rij. Alles steeds zetten: de lijst hergebruikt rijen.
     */
    private void applyLook(RemoteViews rv, boolean groupEnd) {
        float density = ctx.getResources().getDisplayMetrics().density;
        rv.setTextViewTextSize(R.id.title, TypedValue.COMPLEX_UNIT_SP, look.titleSp());
        rv.setInt(R.id.title, "setMaxLines", look.titleLines());
        rv.setTextViewTextSize(R.id.due, TypedValue.COMPLEX_UNIT_SP, look.smallSp());
        rv.setTextViewTextSize(R.id.subtask_count, TypedValue.COMPLEX_UNIT_SP, look.smallSp());
        for (int iconId : META_ICONS) {
            rv.setViewLayoutWidth(iconId, look.iconDp(), TypedValue.COMPLEX_UNIT_DIP);
            rv.setViewLayoutHeight(iconId, look.iconDp(), TypedValue.COMPLEX_UNIT_DIP);
        }
        rv.setViewLayoutWidth(R.id.check, look.touchDp(), TypedValue.COMPLEX_UNIT_DIP);
        rv.setViewLayoutHeight(R.id.check, look.touchDp(), TypedValue.COMPLEX_UNIT_DIP);
        int checkPad = Math.round(look.checkPadDp() * density);
        rv.setViewPadding(R.id.check, checkPad, checkPad, checkPad, checkPad);
        rv.setTextViewTextSize(R.id.undo, TypedValue.COMPLEX_UNIT_SP, look.undoSp());
        // Op het tekstblok, niet op de rij: dan is een rij van één regel precies zo hoog als het tikvlak van het bolletje.
        int textPad = Math.round(look.textPadDp() * density);
        rv.setViewPadding(R.id.row, 0, 0, 0, 0);
        rv.setViewPadding(R.id.text_block, 0, textPad, 0, textPad);
        rv.setInt(R.id.row, "setBackgroundResource", look.tiles() ? R.drawable.tile_bg : 0);
        rv.setViewLayoutMargin(R.id.row, RemoteViews.MARGIN_BOTTOM, groupEnd ? look.groupGapDp() : look.gapDp(),
                TypedValue.COMPLEX_UNIT_DIP);
    }

    /** Titel; net afgevinkt doorgestreept en grijs, met een vinkje. */
    private void bindTitle(RemoteViews rv, JSONObject t, boolean done) {
        String title = t.optString("title");
        if (done) {
            SpannableString s = new SpannableString(title);
            s.setSpan(new StrikethroughSpan(), 0, s.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            rv.setTextViewText(R.id.title, s);
            rv.setTextColor(R.id.title, ctx.getColor(R.color.widget_muted));
            rv.setImageViewResource(R.id.check, R.drawable.ic_check_done);
        } else {
            rv.setTextViewText(R.id.title, title);
            rv.setTextColor(R.id.title, ctx.getColor(R.color.widget_text));
            rv.setImageViewResource(R.id.check, R.drawable.ic_circle);
        }
    }

    /**
     * Metaregel (links onder de titel), alleen voor open taken en alleen als er iets te melden is. Compact toont alleen
     * de herinnering; Ruim ook herhaling, plaats, delen, kopie en subtaken. Geeft terug of er iets in staat.
     */
    private boolean bindMeta(RemoteViews rv, JSONObject t, boolean done) {
        boolean meta = false;
        String remind = Sync.remindAt(t);
        if (!remind.isEmpty() && !done) {
            try {
                Instant at = Instant.parse(remind);
                // Te laat: belletje en tijd samen rood, zodat het als één geheel leest.
                int when = ctx.getColor(at.isBefore(now) ? R.color.overdue : R.color.widget_muted);
                rv.setTextViewText(R.id.due, FMT.format(at));
                rv.setTextColor(R.id.due, when);
                rv.setInt(R.id.bell, "setColorFilter", when);
                meta = true;
            } catch (Exception ignored) {
                // geen leesbare tijd: geen herinnering tonen
            }
        }
        show(rv, R.id.bell, meta);
        show(rv, R.id.due, meta);
        if (!look.extraIcons()) {
            for (int id : EXTRA_ICONS) show(rv, id, false);
            return meta;
        }
        meta |= show(rv, R.id.repeat, !done && !t.isNull("repeat") && t.optJSONObject("repeat") != null);
        meta |= show(rv, R.id.place, !done && !t.isNull("location") && t.optJSONObject("location") != null);
        // Gedeeld (één taak samen) in de accentkleur, kopie (ieder een eigen exemplaar) grijs, net als in de webapp.
        meta |= show(rv, R.id.people, !done && WidgetFilter.isShared(t));
        rv.setInt(R.id.people, "setColorFilter", ctx.getColor(R.color.accent));
        meta |= show(rv, R.id.copy, !done && WidgetFilter.isCopy(t));
        Integer subs = subtasks.get(t.optString("id"));
        boolean hasSubs = !done && subs != null && subs > 0;
        if (hasSubs) rv.setTextViewText(R.id.subtask_count, String.valueOf(subs));
        show(rv, R.id.subtask_count, hasSubs);
        meta |= show(rv, R.id.subtasks, hasSubs);
        return meta;
    }

    /**
     * De lijstnaam alleen als de widget meer dan één lijst toont, net als de pil in Alles in de webapp. Altijd rechts op
     * de eerste titelregel, zodat hij steeds op dezelfde plek staat en de rij er niet hoger van wordt.
     */
    private void bindPill(RemoteViews rv, JSONObject t, boolean done) {
        boolean pill = isMixed() && !done; // afgevinkt: plaats voor Ongedaan maken
        show(rv, R.id.title_pill, pill);
        if (pill) {
            String list = WidgetFilter.normName(t.isNull("list") ? null : t.optString("list"));
            rv.setTextViewText(R.id.title_pill, list);
            rv.setTextViewTextSize(R.id.title_pill, TypedValue.COMPLEX_UNIT_SP, look.pillSp());
            // De naam in de lijstkleur (zo nodig iets lichter of donkerder, zodat hij leesbaar is); Inbox blijft grijs.
            String hex = WidgetFilter.listColor(list, listNames, Locale.getDefault());
            int color = hex == null ? ctx.getColor(R.color.widget_muted)
                    : WidgetFilter.readable(Color.parseColor(hex), ctx.getColor(R.color.widget_pill) & 0xFFFFFF, isDark());
            rv.setTextColor(R.id.title_pill, color);
        }
        // Zonder pil (widget op één lijst) dezelfde afstand tot de rand van het tegeltje als de pil heeft.
        rv.setViewLayoutMargin(R.id.title, RemoteViews.MARGIN_END, pill ? 0 : 8, TypedValue.COMPLEX_UNIT_DIP);
    }

    /**
     * Bolletje = afvinken, titel = openen, Ongedaan maken = terugzetten. Elke rij zet alle drie, want de lijst
     * hergebruikt rijen (en daarmee hun oude klikdoel). Op een net afgevinkte rij doen bolletje en titel niets: de
     * ontvanger negeert een tweede afvinktik, en terugzetten gaat alleen met de knop.
     */
    private void bindClicks(RemoteViews rv, JSONObject t, long doneAt) {
        boolean done = doneAt > 0;
        String id = t.optString("id");
        rv.setOnClickFillInIntent(R.id.check, new Intent().putExtra(ActionReceiver.EXTRA_ID, id));
        rv.setOnClickFillInIntent(R.id.text_block, new Intent()
                .putExtra(ActionReceiver.EXTRA_ID, id)
                .putExtra(WidgetClickActivity.EXTRA_ACTION, done ? WidgetClickActivity.ACTION_NONE : WidgetClickActivity.ACTION_OPEN));
        show(rv, R.id.undo, done);
        rv.setOnClickFillInIntent(R.id.undo, new Intent()
                .putExtra(ActionReceiver.EXTRA_ID, id)
                .putExtra(ActionReceiver.EXTRA_TICKED_AT, doneAt)
                .putExtra(WidgetClickActivity.EXTRA_ACTION, WidgetClickActivity.ACTION_UNDO));
        if (done) rv.setContentDescription(R.id.undo, ctx.getString(R.string.undo_task, t.optString("title")));
    }

    /** Alles en Vandaag tonen taken uit verschillende lijsten; dan helpt de lijstnaam. */
    private boolean isMixed() {
        return view.isEmpty() || WidgetFilter.TODAY.equals(view);
    }

    private boolean isDark() {
        return (ctx.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
    }

    private static boolean show(RemoteViews rv, int id, boolean visible) {
        rv.setViewVisibility(id, visible ? View.VISIBLE : View.GONE);
        return visible;
    }

    // --- Weergave van een widget op het startscherm ---

    /** De maat van een widget staand (dp): breedte en hoogte; 0 als de launcher die niet doorgaf. */
    static int[] sizeDp(Context c, int widgetId) {
        android.os.Bundle o = android.appwidget.AppWidgetManager.getInstance(c).getAppWidgetOptions(widgetId);
        if (o == null) return new int[] {0, 0};
        return new int[] {o.getInt(android.appwidget.AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0),
                o.getInt(android.appwidget.AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0)};
    }

    /** Het uiterlijk van een widget: zijn eigen instellingen, en Compact of Ruim naar keuze of naar zijn maat. */
    static WidgetLook lookOf(Context c, int widgetId) {
        int[] size = sizeDp(c, widgetId);
        boolean roomy = WidgetLook.isRoomy(Prefs.widgetMode(c, widgetId), size[0], size[1]);
        return new WidgetLook(Prefs.widgetFont(c, widgetId), Prefs.widgetSpacing(c, widgetId), roomy);
    }
}
