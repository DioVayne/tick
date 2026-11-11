package nl.detussenpartij.tick;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Typeface;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.text.style.StyleSpan;
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
        /** De rijen na de melding: taken en (Ruim) kopjes; zie WidgetSections. */
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
            rows = new WidgetRows(ctx, look, view, subtasks, listNames, at, Prefs.userId(ctx));
            decideStatus();
        }

        /**
         * De melding bovenaan (WidgetStatus), of null als er niets te melden is; dan begint de lijst meteen met de
         * taken. Hij staat in de lijst (en niet in de kop) omdat sommige launchers de rest van de widget niet meer
         * bijwerken (Android 16+, "update deferred"), de lijst wel. Daarom gaat ook de tik erop via het sjabloon van
         * de lijst (WidgetClickActivity).
         */
        private WidgetStatus status = WidgetStatus.decide(true, false, 0, false, false, false, 0, 0);

        private void decideStatus() {
            long now = System.currentTimeMillis();
            String note = Prefs.outboxNote(ctx);
            boolean noteActive = !note.isEmpty() && now - Prefs.outboxNoteAt(ctx) <= Outbox.NOTE_MS;
            status = WidgetStatus.decide(!Prefs.token(ctx).isEmpty(), noteActive, Outbox.waiting(Prefs.outbox(ctx), now),
                    !Prefs.syncError(ctx).isEmpty(), Prefs.syncOffline(ctx), items.isEmpty(), Prefs.lastSync(ctx), now);
        }

        private int head() {
            return status.visible() ? 1 : 0;
        }

        private RemoteViews statusRow() {
            if (status.kind == WidgetStatus.Kind.STALE) {
                RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_status_hint);
                rv.setTextViewText(R.id.status_hint,
                        ctx.getString(R.string.widget_synced_at, TaskWidgetProvider.syncTime(ctx, Prefs.lastSync(ctx))));
                return rv;
            }
            RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_status);
            String text;
            String action = null;
            switch (status.kind) {
                case PAIR: text = ctx.getString(R.string.status_pair); break;
                case NOTE: text = Prefs.outboxNote(ctx); break;
                case WAITING: {
                    int n = Outbox.waiting(Prefs.outbox(ctx), System.currentTimeMillis());
                    text = ctx.getResources().getQuantityString(R.plurals.outbox_waiting, n, n);
                    action = ctx.getString(R.string.status_retry);
                    break;
                }
                case OFFLINE: text = ctx.getString(R.string.status_offline); action = ctx.getString(R.string.status_retry); break;
                case SERVER: text = Prefs.syncError(ctx); action = ctx.getString(R.string.status_retry); break;
                default: { // EMPTY
                    int empty = WidgetFilter.TODAY.equals(view) ? R.string.widget_empty_today
                            : view.isEmpty() ? R.string.widget_empty : R.string.widget_empty_list;
                    text = ctx.getString(empty);
                    action = ctx.getString(R.string.status_add);
                }
            }
            int tone = ctx.getColor(status.alert() ? R.color.overdue
                    : status.kind == WidgetStatus.Kind.PAIR ? R.color.accent : R.color.widget_muted);
            SpannableStringBuilder sb = new SpannableStringBuilder(text);
            sb.setSpan(new ForegroundColorSpan(tone), 0, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            if (action != null) {
                sb.append(" · ");
                int from = sb.length();
                sb.append(action);
                sb.setSpan(new ForegroundColorSpan(ctx.getColor(R.color.accent)), from, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                sb.setSpan(new StyleSpan(Typeface.BOLD), from, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            }
            rv.setTextViewText(R.id.status_text, sb);
            rv.setContentDescription(R.id.status_text, sb.toString());
            String click;
            switch (status.action) {
                case RETRY: click = WidgetClickActivity.ACTION_RETRY; break;
                case PAIR: click = WidgetClickActivity.ACTION_PAIR; break;
                case ADD: click = WidgetClickActivity.ACTION_ADD; break;
                default: click = WidgetClickActivity.ACTION_NONE;
            }
            // Altijd een fill-in intent (de lijst hergebruikt rijen); zonder actie doet de tik niets.
            rv.setOnClickFillInIntent(R.id.status_text, new Intent()
                    .putExtra(WidgetClickActivity.EXTRA_ACTION, click)
                    .putExtra(QuickAddActivity.EXTRA_VIEW, view));
            return rv;
        }

        @Override
        public RemoteViews getViewAt(int position) {
            if (position < head()) return statusRow();
            position -= head();
            if (rows == null || position >= entries.size()) return new RemoteViews(ctx.getPackageName(), R.layout.widget_item);
            WidgetSections.Entry e = entries.get(position);
            if (e.header) return rows.section(e.section);
            return rows.task(items.get(e.task), tickedAt.get(e.task), e.groupEnd);
        }

        @Override
        public int getCount() {
            return entries.size() + head();
        }

        @Override
        public RemoteViews getLoadingView() {
            return null;
        }

        @Override
        public int getViewTypeCount() {
            return 4; // melding, kleine tijd, taak en kopje
        }

        @Override
        public long getItemId(int position) {
            if (position < head()) return Long.MIN_VALUE; // melding
            position -= head();
            if (position >= entries.size()) return position;
            WidgetSections.Entry e = entries.get(position);
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
