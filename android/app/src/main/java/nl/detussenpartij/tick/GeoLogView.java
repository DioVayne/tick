package nl.detussenpartij.tick;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.text.format.DateFormat;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import com.google.android.gms.location.GeofenceStatusCodes;

import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Het logboek van de locatiemeldingen (GeoLog) in "Tick op deze telefoon": ingeklapt onder een knop, nieuwste regel
 * bovenaan, met een knop om alles te kopiëren (om door te sturen als een melding uitbleef).
 */
final class GeoLogView {
    /** Zoveel regels staan er op het scherm; Kopiëren neemt alles mee. */
    private static final int SHOWN = 30;

    private final Activity a;
    private final TextView lines;

    private GeoLogView(Activity a, TextView lines) {
        this.a = a;
        this.lines = lines;
    }

    static GeoLogView addTo(Activity a, LinearLayout root) {
        float d = a.getResources().getDisplayMetrics().density;
        LinearLayout box = new LinearLayout(a);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setVisibility(View.GONE);

        Button toggle = new Button(a, null, android.R.attr.borderlessButtonStyle);
        toggle.setText(a.getString(R.string.geolog_title) + " ▸");
        toggle.setOnClickListener(v -> {
            boolean show = box.getVisibility() != View.VISIBLE;
            box.setVisibility(show ? View.VISIBLE : View.GONE);
            toggle.setText(a.getString(R.string.geolog_title) + (show ? " ▾" : " ▸"));
        });
        root.addView(toggle);
        root.addView(box);

        TextView help = new TextView(a);
        help.setText(R.string.geolog_help);
        help.setPadding(0, 0, 0, (int) (8 * d));
        box.addView(help);

        TextView lines = new TextView(a);
        lines.setTextIsSelectable(true);
        lines.setPadding(0, 0, 0, (int) (8 * d));
        box.addView(lines);

        GeoLogView view = new GeoLogView(a, lines);
        Button copy = new Button(a);
        copy.setText(R.string.geolog_copy);
        copy.setOnClickListener(v -> view.copy());
        box.addView(copy);
        return view;
    }

    /** Bijwerken (uit onResume). */
    void refresh() {
        List<JSONObject> entries = GeoLog.newestFirst(Prefs.geoLog(a), SHOWN);
        lines.setText(entries.isEmpty() ? a.getString(R.string.geolog_empty) : join(a, entries));
    }

    private void copy() {
        List<JSONObject> entries = GeoLog.newestFirst(Prefs.geoLog(a), GeoLog.KEEP);
        String text = a.getString(R.string.geolog_title) + " (" + BuildConfig.VERSION_NAME + ")\n" + join(a, entries);
        ClipboardManager cm = a.getSystemService(ClipboardManager.class);
        cm.setPrimaryClip(ClipData.newPlainText(a.getString(R.string.geolog_title), text));
        Toast.makeText(a, R.string.geolog_copied, Toast.LENGTH_SHORT).show();
    }

    private static String join(Context c, List<JSONObject> entries) {
        SimpleDateFormat when = new SimpleDateFormat(
                DateFormat.getBestDateTimePattern(Locale.getDefault(), "EEEdMMMHHmm"), Locale.getDefault());
        SimpleDateFormat time = new SimpleDateFormat(DateFormat.getBestDateTimePattern(Locale.getDefault(), "HHmm"),
                Locale.getDefault());
        StringBuilder sb = new StringBuilder();
        for (JSONObject e : entries) {
            if (sb.length() > 0) sb.append('\n');
            sb.append(when.format(new Date(e.optLong("at")))).append(" · ").append(text(c, e));
            int times = e.optInt("times", 1);
            if (times > 1) sb.append(c.getString(R.string.geolog_repeat, times, time.format(new Date(e.optLong("since")))));
        }
        return sb.toString();
    }

    /** De tekst van één regel. */
    static String text(Context c, JSONObject e) {
        switch (e.optString("kind")) {
            case GeoLog.REG:
                if (!e.optBoolean("full")) return c.getString(R.string.geolog_reg, e.optInt("n"), e.optInt("added"));
                return c.getString(R.string.geolog_reg_full, e.optInt("n"), why(c, e.optString("why")));
            case GeoLog.REG_FAILED:
                return c.getString(R.string.geolog_reg_failed, e.optString("why"));
            case GeoLog.EVENT:
                return c.getString(e.optBoolean("exit") ? R.string.geolog_event_exit : R.string.geolog_event_enter, e.optInt("n"));
            case GeoLog.EVENT_ERROR:
                return c.getString(R.string.geolog_event_error, GeofenceStatusCodes.getStatusCodeString(e.optInt("code")));
            case GeoLog.DECIDE: {
                String title = e.optString("title");
                if (title.isEmpty()) title = c.getString(R.string.geolog_untitled);
                String result = e.optString("result");
                boolean net = e.optBoolean("net");
                if (GeoLog.SHOWN.equals(result)) {
                    return c.getString(net ? R.string.geolog_net_shown : R.string.geolog_shown, title);
                }
                return c.getString(net ? R.string.geolog_net_skipped : R.string.geolog_skipped, title, reason(c, result));
            }
            case GeoLog.NET:
                if (!e.has("acc")) return c.getString(R.string.geolog_net_no_acc, e.optInt("tasks"));
                return c.getString(R.string.geolog_net, e.optInt("acc"), e.optInt("tasks"));
            case GeoLog.NET_NO_FIX:
                return c.getString(R.string.geolog_net_no_fix);
            default:
                return e.optString("kind");
        }
    }

    private static String why(Context c, String why) {
        switch (why) {
            case GeoLog.Why.DAILY: return c.getString(R.string.geolog_why_daily);
            case GeoLog.Why.LOST: return c.getString(R.string.geolog_why_lost);
            case GeoLog.Why.MISSED: return c.getString(R.string.geolog_why_missed);
            default: return c.getString(R.string.geolog_why_start);
        }
    }

    private static String reason(Context c, String result) {
        switch (result) {
            case "GEEN_TAAK": return c.getString(R.string.geolog_r_no_task);
            case "AF": return c.getString(R.string.geolog_r_done);
            case "AL_GEMELD": return c.getString(R.string.geolog_r_server);
            case "ANDERE_PLEK": return c.getString(R.string.geolog_r_other_place);
            case "AL_AFGEGAAN": return c.getString(R.string.geolog_r_this_phone);
            case "ANDERE_RICHTING": return c.getString(R.string.geolog_r_direction);
            case GeoLog.OFF: return c.getString(R.string.geolog_r_off);
            default: return result;
        }
    }
}
