package nl.detussenpartij.tick;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.Instant;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

public class TaskListService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new Factory(getApplicationContext(),
                intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID));
    }

    static class Factory implements RemoteViewsFactory {
        private final Context ctx;
        private final int widgetId;
        private final List<JSONObject> items = new ArrayList<>();
        /** Per rij het moment van de afvinktik (ms), of 0 als de taak open is. */
        private final List<Long> tickedAt = new ArrayList<>();
        private String view = "";
        private Map<String, Integer> subtasks = new java.util.HashMap<>();
        private Set<String> listNames = new java.util.HashSet<>();
        /** De rijen na de statusregel: taken en (Ruim) kopjes; zie WidgetSections. */
        private List<WidgetSections.Entry> entries = new ArrayList<>();
        private WidgetRows rows;

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
            tickedAt.clear();
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
                    // Net afgevinkt: nog even op zijn plek (doorgestreept, met Ongedaan maken). Daarna weg. Sync houdt
                    // zo'n taak in die tijd ook in de cache vast (UndoPlan.merge), dus de lijst verschuift niet.
                    if (tapped && now - pending.optLong(id) > UndoPlan.UNDO_WINDOW_MS) continue;
                    items.add(o);
                    tickedAt.add(tapped ? pending.optLong(id) : 0L);
                }
            } catch (Exception ignored) {
                // lege lijst
            }
            // Uiterlijk van deze widget: zijn eigen instellingen, Compact of Ruim naar keuze of naar zijn maat.
            WidgetLook look = WidgetRows.lookOf(ctx, widgetId);
            Instant at = Instant.ofEpochMilli(now);
            entries = WidgetSections.plan(items, view, at, look.sections());
            rows = new WidgetRows(ctx, look, view, subtasks, listNames, at);
        }

        /**
         * Positie 0 is de statusregel (bijgewerkt om, of de fout); daarna de taken. Hij staat in de lijst omdat
         * sommige launchers de rest van de widget niet meer bijwerken (Android 16+, "update deferred"), de lijst wel.
         */
        private RemoteViews statusRow() {
            RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_status);
            String error = Prefs.syncError(ctx);
            String text;
            long now = System.currentTimeMillis();
            String note = Prefs.outboxNote(ctx);
            int waiting = Outbox.waiting(Prefs.outbox(ctx), now);
            if (Prefs.token(ctx).isEmpty()) text = ctx.getString(R.string.widget_no_token);
            // De server wees net een wijziging af (taak weg, niet meer gedeeld): even zeggen.
            else if (!note.isEmpty() && now - Prefs.outboxNoteAt(ctx) <= Outbox.NOTE_MS) text = error = note;
            // Wijzigingen in de wachtrij: rustig melden, in plaats van een rode foutmelding. Ze gaan vanzelf weg.
            else if (waiting > 0) {
                text = ctx.getResources().getQuantityString(R.plurals.outbox_waiting, waiting, waiting);
                error = "";
            } else if (!error.isEmpty()) text = error;
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
            if (rows == null || position >= entries.size()) return new RemoteViews(ctx.getPackageName(), R.layout.widget_item);
            WidgetSections.Entry e = entries.get(position);
            if (e.header) return rows.section(e.section);
            return rows.task(items.get(e.task), tickedAt.get(e.task), e.groupEnd);
        }

        @Override
        public int getCount() {
            return entries.size() + 1; // + statusregel
        }

        @Override
        public RemoteViews getLoadingView() {
            return null;
        }

        @Override
        public int getViewTypeCount() {
            return 3; // statusregel, taak en kopje
        }

        @Override
        public long getItemId(int position) {
            if (position == 0) return Long.MIN_VALUE; // statusregel
            if (position - 1 >= entries.size()) return position;
            WidgetSections.Entry e = entries.get(position - 1);
            if (e.header) return Long.MIN_VALUE + 1 + e.section; // kopje: vast per groep
            return items.get(e.task).optString("id").hashCode();
        }

        @Override
        public boolean hasStableIds() {
            return true;
        }

        @Override
        public void onDestroy() {
            items.clear();
            tickedAt.clear();
            entries.clear();
        }
    }
}
