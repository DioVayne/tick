package nl.detussenpartij.tick;

import android.content.Context;
import android.content.Intent;
import android.graphics.Typeface;
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
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class TaskListService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new Factory(getApplicationContext());
    }

    static class Factory implements RemoteViewsFactory {
        private static final DateTimeFormatter FMT =
                DateTimeFormatter.ofPattern("EEE d MMM HH:mm", Locale.getDefault()).withZone(ZoneId.systemDefault());

        private final Context ctx;
        private final List<JSONObject> items = new ArrayList<>();
        private final List<Boolean> justDone = new ArrayList<>();

        Factory(Context ctx) {
            this.ctx = ctx;
        }

        @Override
        public void onCreate() {}

        /** Leest alleen de opgeslagen lijst, dus direct. Het ophalen van de server gebeurt in Sync.refresh. */
        @Override
        public void onDataSetChanged() {
            items.clear();
            justDone.clear();
            JSONObject pending = Prefs.pending(ctx);
            long now = System.currentTimeMillis();
            try {
                JSONArray arr = new JSONArray(Prefs.cache(ctx));
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject o = arr.getJSONObject(i);
                    if (!o.isNull("parent_id")) continue; // alleen hoofdtaken
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
                text = items.isEmpty() ? ctx.getString(R.string.widget_empty) + (synced.isEmpty() ? "" : " · " + synced) : synced;
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
            rv.setTextViewTextSize(R.id.due, TypedValue.COMPLEX_UNIT_SP, Math.max(10, font - 3));
            rv.setViewLayoutWidth(R.id.check, check, TypedValue.COMPLEX_UNIT_DIP);
            rv.setViewLayoutHeight(R.id.check, check, TypedValue.COMPLEX_UNIT_DIP);
            int padPx = Math.round(Prefs.spacingDp(ctx) * density);
            rv.setViewPadding(R.id.row, 0, padPx, 0, padPx);

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

            String remind = t.isNull("remind_at") ? null : t.optString("remind_at", null);
            if (remind != null && !remind.isEmpty() && !done) {
                Instant at = Instant.parse(remind);
                rv.setTextViewText(R.id.due, "🔔 " + FMT.format(at));
                rv.setTextColor(R.id.due, ctx.getColor(at.isBefore(Instant.now()) ? R.color.overdue : R.color.widget_muted));
                rv.setViewVisibility(R.id.due, View.VISIBLE);
            } else {
                rv.setViewVisibility(R.id.due, View.GONE);
            }

            String id = t.optString("id");
            rv.setOnClickFillInIntent(R.id.check, new Intent().putExtra(ActionReceiver.EXTRA_ID, id));
            rv.setOnClickFillInIntent(R.id.text_block, new Intent()
                    .putExtra(ActionReceiver.EXTRA_ID, id)
                    .putExtra(WidgetClickActivity.EXTRA_ACTION, done ? WidgetClickActivity.ACTION_UNDO : WidgetClickActivity.ACTION_OPEN));
            return rv;
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
