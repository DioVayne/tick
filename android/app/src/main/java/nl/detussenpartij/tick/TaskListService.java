package nl.detussenpartij.tick;

import android.appwidget.AppWidgetManager;
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
import android.widget.RemoteViewsService;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

public class TaskListService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new Factory(getApplicationContext(),
                intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID));
    }

    static class Factory implements RemoteViewsFactory {
        private static final DateTimeFormatter FMT =
                DateTimeFormatter.ofPattern("EEE d MMM HH:mm", Locale.getDefault()).withZone(ZoneId.systemDefault());

        private final Context ctx;
        private final int widgetId;
        private final List<JSONObject> items = new ArrayList<>();
        private final List<Boolean> justDone = new ArrayList<>();
        private String view = "";
        private Map<String, Integer> subtasks = new java.util.HashMap<>();
        private Set<String> listNames = new java.util.HashSet<>();

        Factory(Context ctx, int widgetId) {
            this.ctx = ctx;
            this.widgetId = widgetId;
        }

        @Override
        public void onCreate() {}

        /** Leest alleen de opgeslagen lijst, dus direct. Het ophalen van de server gebeurt in Sync.refresh. */
        @Override
        public void onDataSetChanged() {
            items.clear();
            justDone.clear();
            view = Prefs.widgetView(ctx, widgetId);
            JSONObject pending = Prefs.pending(ctx);
            long now = System.currentTimeMillis();
            try {
                JSONArray arr = new JSONArray(Prefs.cache(ctx));
                subtasks = WidgetFilter.openSubtasks(arr);
                listNames = WidgetFilter.listNames(arr);
                for (JSONObject o : WidgetFilter.select(arr, view, ZonedDateTime.now())) {
                    String id = o.optString("id");
                    boolean tapped = pending.has(id);
                    // Net afgevinkt: nog even zichtbaar (doorgestreept). Daarna weg.
                    if (tapped && now - pending.optLong(id) > Sync.UNDO_WINDOW_MS) continue;
                    items.add(o);
                    justDone.add(tapped);
                }
            } catch (Exception ignored) {
                // lege lijst
            }
        }

        /**
         * Positie 0 is de statusregel (bijgewerkt om, of de fout); daarna de taken. Hij staat in de lijst omdat
         * sommige launchers de rest van de widget niet meer bijwerken (Android 16+, "update deferred"), de lijst wel.
         */
        private RemoteViews statusRow() {
            RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_status);
            String error = Prefs.syncError(ctx);
            String text;
            if (Prefs.token(ctx).isEmpty()) text = ctx.getString(R.string.widget_no_token);
            else if (!error.isEmpty()) text = error;
            else {
                long last = Prefs.lastSync(ctx);
                String synced = last > 0 ? ctx.getString(R.string.widget_synced_at, TaskWidgetProvider.syncTime(ctx, last)) : "";
                String empty = ctx.getString(WidgetFilter.TODAY.equals(view) ? R.string.widget_empty_today : R.string.widget_empty);
                text = items.isEmpty() ? empty + (synced.isEmpty() ? "" : " · " + synced) : synced;
            }
            rv.setTextViewText(R.id.status_text, text);
            rv.setTextColor(R.id.status_text, ctx.getColor(error.isEmpty() ? R.color.widget_muted : R.color.overdue));
            return rv;
        }

        @Override
        public RemoteViews getViewAt(int position) {
            if (position == 0) return statusRow();
            position--;
            RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_item);
            if (position >= items.size()) return rv;
            JSONObject t = items.get(position);
            boolean done = justDone.get(position);
            String title = t.optString("title");

            // Uiterlijk uit de instellingen: tekstgrootte, bolletje meeschalend, extra ruimte boven en onder elke regel.
            int font = Prefs.fontSp(ctx);
            float density = ctx.getResources().getDisplayMetrics().density;
            float check = Math.max(24f, font * 2.1f);
            rv.setTextViewTextSize(R.id.title, TypedValue.COMPLEX_UNIT_SP, font);
            int small = Math.max(10, font - 3);
            rv.setTextViewTextSize(R.id.due, TypedValue.COMPLEX_UNIT_SP, small);
            rv.setTextViewTextSize(R.id.subtask_count, TypedValue.COMPLEX_UNIT_SP, small);
            float icon = small + 2f; // icoontjes zo hoog als de kleine tekst
            for (int iconId : META_ICONS) {
                rv.setViewLayoutWidth(iconId, icon, TypedValue.COMPLEX_UNIT_DIP);
                rv.setViewLayoutHeight(iconId, icon, TypedValue.COMPLEX_UNIT_DIP);
            }
            rv.setViewLayoutWidth(R.id.check, check, TypedValue.COMPLEX_UNIT_DIP);
            rv.setViewLayoutHeight(R.id.check, check, TypedValue.COMPLEX_UNIT_DIP);
            int padPx = Math.round(Prefs.spacingDp(ctx) * density);
            // Binnenruimte van het tegeltje: vast 3dp boven en onder, plus de regelafstand uit de instellingen.
            int tilePad = Math.round(TILE_PADDING_DP * density) + padPx;
            rv.setViewPadding(R.id.row, Math.round(2 * density), tilePad, 0, tilePad);

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

            // Metaregel (links onder de titel), alleen voor open taken en alleen als er iets te melden is.
            boolean meta = false;
            String remind = Sync.remindAt(t);
            if (!remind.isEmpty() && !done) {
                Instant at = Instant.parse(remind);
                // Te laat: belletje en tijd samen rood, zodat het als één geheel leest.
                int when = ctx.getColor(at.isBefore(Instant.now()) ? R.color.overdue : R.color.widget_muted);
                rv.setTextViewText(R.id.due, FMT.format(at));
                rv.setTextColor(R.id.due, when);
                rv.setInt(R.id.bell, "setColorFilter", when);
                meta = true;
            }
            show(rv, R.id.bell, meta);
            show(rv, R.id.due, meta);
            meta |= show(rv, R.id.repeat, !done && !t.isNull("repeat") && t.optJSONObject("repeat") != null);
            meta |= show(rv, R.id.place, !done && !t.isNull("location") && t.optJSONObject("location") != null);
            meta |= show(rv, R.id.people, !done && isShared(t));
            Integer subs = subtasks.get(t.optString("id"));
            boolean hasSubs = !done && subs != null && subs > 0;
            if (hasSubs) rv.setTextViewText(R.id.subtask_count, String.valueOf(subs));
            show(rv, R.id.subtask_count, hasSubs);
            meta |= show(rv, R.id.subtasks, hasSubs);

            // De lijstnaam alleen als de widget meer dan één lijst toont, net als de pil in Alles in de webapp. Altijd
            // rechts op de eerste titelregel, zodat hij steeds op dezelfde plek staat en de rij er niet hoger van wordt.
            boolean pill = isMixed();
            show(rv, R.id.title_pill, pill);
            if (pill) {
                String list = WidgetFilter.normName(t.isNull("list") ? null : t.optString("list"));
                int pillSp = Math.max(9, font - 4);
                rv.setTextViewText(R.id.title_pill, list);
                rv.setTextViewTextSize(R.id.title_pill, TypedValue.COMPLEX_UNIT_SP, pillSp);
                // De naam in de lijstkleur (zo nodig iets lichter of donkerder, zodat hij leesbaar is); Inbox blijft grijs.
                String hex = WidgetFilter.listColor(list, listNames, Locale.getDefault());
                int color = hex == null ? ctx.getColor(R.color.widget_muted)
                        : WidgetFilter.readable(Color.parseColor(hex), ctx.getColor(R.color.widget_pill) & 0xFFFFFF, isDark());
                if (done) color = (color & 0x00FFFFFF) | 0x80000000; // afgevinkt: half doorzichtig
                rv.setTextColor(R.id.title_pill, color);
            }
            // Zonder pil (widget op één lijst) dezelfde afstand tot de rand van het tegeltje als de pil heeft. Steeds zetten,
            // want de lijst hergebruikt rijen.
            rv.setViewLayoutMargin(R.id.title, RemoteViews.MARGIN_END, pill ? 0 : 8, TypedValue.COMPLEX_UNIT_DIP);

            // Vastgezette taken staan bovenaan; na de laatste daarvan meer ruimte tot het volgende tegeltje (in plaats van een
            // punaise). Niet in Vandaag: daar staat alles op tijd, niet vastgezet eerst.
            boolean groupEnd = !WidgetFilter.TODAY.equals(view) && t.optBoolean("pinned")
                    && position + 1 < items.size() && !items.get(position + 1).optBoolean("pinned");
            rv.setViewLayoutMargin(R.id.row, RemoteViews.MARGIN_BOTTOM, groupEnd ? GROUP_GAP_DP : TILE_GAP_DP,
                    TypedValue.COMPLEX_UNIT_DIP);
            rv.setViewVisibility(R.id.meta, meta ? View.VISIBLE : View.GONE);

            String id = t.optString("id");
            rv.setOnClickFillInIntent(R.id.check, new Intent().putExtra(ActionReceiver.EXTRA_ID, id));
            rv.setOnClickFillInIntent(R.id.text_block, new Intent()
                    .putExtra(ActionReceiver.EXTRA_ID, id)
                    .putExtra(WidgetClickActivity.EXTRA_ACTION, done ? WidgetClickActivity.ACTION_UNDO : WidgetClickActivity.ACTION_OPEN));
            return rv;
        }

        /** Tegeltjes: binnenruimte boven en onder, ruimte ertussen, en de grotere ruimte na de vastgezette taken (dp). */
        private static final int TILE_PADDING_DP = 3;
        private static final float TILE_GAP_DP = 3;
        private static final float GROUP_GAP_DP = 10;

        private static final int[] META_ICONS = {R.id.bell, R.id.repeat, R.id.place, R.id.people, R.id.subtasks};

        private boolean isDark() {
            return (ctx.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                    == Configuration.UI_MODE_NIGHT_YES;
        }

        /** Alles en Vandaag tonen taken uit verschillende lijsten; dan helpt de lijstnaam. */
        private boolean isMixed() {
            return view.isEmpty() || WidgetFilter.TODAY.equals(view);
        }

        private static boolean show(RemoteViews rv, int id, boolean visible) {
            rv.setViewVisibility(id, visible ? View.VISIBLE : View.GONE);
            return visible;
        }

        /** Gedeeld (als eigenaar of ontvanger): de server zet dan share, net als het icoontje in de webapp. */
        private static boolean isShared(JSONObject t) {
            return t.optJSONObject("share") != null;
        }

        @Override
        public int getCount() {
            return items.size() + 1; // + statusregel
        }

        @Override
        public RemoteViews getLoadingView() {
            return null;
        }

        @Override
        public int getViewTypeCount() {
            return 2; // statusregel en taak
        }

        @Override
        public long getItemId(int position) {
            if (position == 0) return Long.MIN_VALUE; // statusregel
            return position - 1 < items.size() ? items.get(position - 1).optString("id").hashCode() : position;
        }

        @Override
        public boolean hasStableIds() {
            return true;
        }

        @Override
        public void onDestroy() {
            items.clear();
            justDone.clear();
        }
    }
}
