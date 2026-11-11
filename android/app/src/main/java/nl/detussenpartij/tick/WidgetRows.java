package nl.detussenpartij.tick;

import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.text.SpannableString;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
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
    private static final int[] META_ICONS = {R.id.bell, R.id.repeat, R.id.place};

    private final Context ctx;
    private final WidgetLook look;
    private final String view;
    private final Map<String, Integer> subtasks;
    private final Set<String> listNames;
    private final Instant now;
    /** Mijn user_id ("" als onbekend), om "Sanne doet dit" en "Gedeeld met" niet over mezelf te zeggen. */
    private final String me;

    WidgetRows(Context ctx, WidgetLook look, String view, Map<String, Integer> subtasks, Set<String> listNames, Instant now,
               String me) {
        this.ctx = ctx;
        this.look = look;
        this.view = view == null ? "" : view;
        this.subtasks = subtasks;
        this.listNames = listNames;
        this.now = now;
        this.me = me == null ? "" : me;
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
        Instant at = remindAt(t);
        Integer subs = subtasks.get(t.optString("id"));
        RowMeta plan = RowMeta.plan(t, done, isMixed(), look.roomy, look.narrow, me, subs == null ? 0 : subs, at != null);
        bindMeta(rv, t, plan, at);
        bindPill(rv, t, plan.pill);
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
        rv.setTextViewTextSize(R.id.meta_text, TypedValue.COMPLEX_UNIT_SP, look.smallSp());
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

    private static Instant remindAt(JSONObject t) {
        String remind = Sync.remindAt(t);
        if (remind.isEmpty()) return null;
        try {
            return Instant.parse(remind);
        } catch (Exception e) {
            return null; // geen leesbare tijd: geen herinnering tonen
        }
    }

    /**
     * Metaregel (links onder de titel), alleen als er iets in staat; wat erin komt, kiest RowMeta. Eén tekst met
     * " · " ertussen: tijd (te laat: belletje en tijd samen rood), lijst (in de lijstkleur), wie het doet, open subtaken,
     * met wie gedeeld. Daarna herhaling en plaats als icoontje.
     */
    private void bindMeta(RemoteViews rv, JSONObject t, RowMeta plan, Instant at) {
        SpannableStringBuilder sb = new SpannableStringBuilder();
        if (plan.time) {
            int when = ctx.getColor(at.isBefore(now) ? R.color.overdue : R.color.widget_muted);
            rv.setInt(R.id.bell, "setColorFilter", when);
            append(sb, FMT.format(at), when);
        }
        show(rv, R.id.bell, plan.time);
        if (plan.listInMeta) {
            String list = listName(t);
            append(sb, list, listColor(list, look.tiles() ? R.color.widget_tile : R.color.widget_bg));
        }
        if (plan.doer != null) append(sb, ctx.getString(R.string.meta_doer, plan.doer), 0);
        if (plan.subtasks > 0) {
            append(sb, ctx.getResources().getQuantityString(R.plurals.meta_subtasks_open, plan.subtasks, plan.subtasks), 0);
        }
        if (plan.sharedWith != null) {
            append(sb, plan.sharedOthers > 0
                    ? ctx.getResources().getQuantityString(R.plurals.meta_shared_with_more, plan.sharedOthers,
                            plan.sharedWith, plan.sharedOthers)
                    : ctx.getString(R.string.meta_shared_with, plan.sharedWith), 0);
        } else if (plan.sharedPlain) {
            append(sb, ctx.getString(R.string.meta_shared), 0);
        }
        rv.setTextViewText(R.id.meta_text, sb);
        show(rv, R.id.meta_text, sb.length() > 0);
        show(rv, R.id.repeat, plan.repeat);
        show(rv, R.id.place, plan.place);
        show(rv, R.id.meta, plan.any());
    }

    /** Een stukje van de metaregel, met " · " ervoor als er al iets staat; color 0 is de gewone grijze kleur. */
    private static void append(SpannableStringBuilder sb, String part, int color) {
        if (sb.length() > 0) sb.append(" · ");
        int from = sb.length();
        sb.append(part);
        if (color != 0) sb.setSpan(new ForegroundColorSpan(color), from, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
    }

    private static String listName(JSONObject t) {
        return WidgetFilter.normName(t.isNull("list") ? null : t.optString("list"));
    }

    /**
     * De lijstnaam in de lijstkleur (zo nodig iets lichter of donkerder, zodat hij op bg leesbaar is); Inbox grijs, net
     * als de pil in Alles in de webapp.
     */
    private int listColor(String list, int bg) {
        String hex = WidgetFilter.listColor(list, listNames, Locale.getDefault());
        return hex == null ? ctx.getColor(R.color.widget_muted)
                : WidgetFilter.readable(Color.parseColor(hex), ctx.getColor(bg) & 0xFFFFFF, isDark());
    }

    /**
     * De lijstnaam als pil, alleen als de widget meer dan één lijst toont en breed genoeg is (RowMeta). Altijd rechts op
     * de eerste titelregel, zodat hij steeds op dezelfde plek staat en de rij er niet hoger van wordt.
     */
    private void bindPill(RemoteViews rv, JSONObject t, boolean pill) {
        show(rv, R.id.title_pill, pill);
        if (pill) {
            String list = listName(t);
            rv.setTextViewText(R.id.title_pill, list);
            rv.setTextViewTextSize(R.id.title_pill, TypedValue.COMPLEX_UNIT_SP, look.pillSp());
            rv.setTextColor(R.id.title_pill, listColor(list, R.color.widget_pill));
        }
        // Zonder pil dezelfde afstand tot de rand van het tegeltje als de pil heeft.
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

    /**
     * Het uiterlijk van een widget: zijn eigen instellingen, Compact of Ruim naar keuze of naar zijn maat, en of hij
     * smal of laag is (titelregels, lijstnaam naast de titel of eronder).
     */
    static WidgetLook lookOf(Context c, int widgetId) {
        int[] size = sizeDp(c, widgetId);
        boolean roomy = WidgetLook.isRoomy(Prefs.widgetMode(c, widgetId), size[0], size[1]);
        return new WidgetLook(Prefs.widgetFont(c, widgetId), Prefs.widgetSpacing(c, widgetId), roomy, size[0], size[1]);
    }
}
