package nl.detussenpartij.tick;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Intent;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.Collator;
import java.time.Instant;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Instellingen van één widget: wat hij toont (Alles, Vandaag of een lijst), de weergave (Automatisch, Compact, Ruim),
 * tekstgrootte en regelafstand, met een voorbeeld dat precies de widget is (dezelfde rijen uit WidgetRows). Opent als
 * configuratiescherm van de widget (toevoegen, of lang indrukken); vanuit de app ("Widget-instellingen") eerst een keuze
 * welke widget, of meteen de enige.
 */
public class SettingsActivity extends Activity {
    /** Gezet als dit scherm uit de keuzelijst in de app komt (niet van de launcher). */
    private static final String EXTRA_FROM_APP = "fromApp";

    private int font;
    private int spacing;
    private int mode;
    private TextView fontLabel;
    private TextView spacingLabel;
    private float density;
    private int widgetId = AppWidgetManager.INVALID_APPWIDGET_ID;
    private RadioGroup viewGroup;
    private RadioButton autoButton;
    private final List<String> viewValues = new ArrayList<>();
    /** Het voorbeeld: een kopie van de widget (kop, statusregel, rijen). */
    private LinearLayout preview;
    private TextView previewTitle;
    private LinearLayout previewRows;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        density = getResources().getDisplayMetrics().density;

        widgetId = getIntent().getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        if (widgetId != AppWidgetManager.INVALID_APPWIDGET_ID) {
            // Als de widget dit scherm opent bij het toevoegen, is wegklikken ook goed: de standaardwaarden gelden dan.
            setResult(RESULT_OK, new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId));
        } else {
            // Vanuit de app: welke widget? Met precies één widget meteen die.
            int[] ids = widgetIds();
            if (ids.length != 1) {
                showPicker(ids);
                return;
            }
            widgetId = ids[0];
        }
        showSettings();
    }

    private int[] widgetIds() {
        return AppWidgetManager.getInstance(this).getAppWidgetIds(new ComponentName(this, TaskWidgetProvider.class));
    }

    private LinearLayout page() {
        int pad = (int) (20 * density);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, pad);
        TextView title = new TextView(this);
        title.setText(R.string.widget_settings);
        title.setTextSize(24);
        root.addView(title);
        ScrollView scroll = new ScrollView(this);
        scroll.addView(root);
        scroll.setFitsSystemWindows(true);
        setContentView(scroll);
        return root;
    }

    private TextView label(LinearLayout root, int text) {
        TextView label = new TextView(this);
        label.setText(text);
        label.setPadding(0, (int) (16 * density), 0, 0);
        root.addView(label);
        return label;
    }

    /** Keuze uit de widgets op het startscherm (of uitleg als er geen is). */
    private void showPicker(int[] ids) {
        LinearLayout root = page();
        if (ids.length == 0) {
            label(root, R.string.settings_no_widgets);
        } else {
            label(root, R.string.settings_pick_widget);
            for (int id : ids) {
                int[] size = WidgetRows.sizeDp(this, id);
                boolean roomy = WidgetLook.isRoomy(Prefs.widgetMode(this, id), size[0], size[1]);
                Button b = new Button(this);
                b.setText(getString(R.string.settings_widget_item,
                        TaskWidgetProvider.title(this, Prefs.widgetView(this, id)), layoutName(roomy)));
                b.setOnClickListener(v -> startActivity(new Intent(this, SettingsActivity.class)
                        .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id).putExtra(EXTRA_FROM_APP, true)));
                root.addView(b);
            }
        }
        Button done = new Button(this);
        done.setText(R.string.settings_done);
        done.setOnClickListener(v -> finish());
        LinearLayout.LayoutParams rp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        rp.topMargin = (int) (24 * density);
        root.addView(done, rp);
    }

    private String layoutName(boolean roomy) {
        return getString(roomy ? R.string.settings_layout_roomy : R.string.settings_layout_compact);
    }

    private void showSettings() {
        font = Prefs.widgetFont(this, widgetId);
        spacing = Prefs.widgetSpacing(this, widgetId);
        mode = Prefs.widgetMode(this, widgetId);
        LinearLayout root = page();

        label(root, R.string.widget_view_label);
        viewGroup = new RadioGroup(this);
        root.addView(viewGroup);
        fillViews(namesFromCache());
        loadListsFromServer();

        // Weergave: Automatisch (naar de grootte), Compact of Ruim.
        label(root, R.string.settings_layout_label);
        RadioGroup modeGroup = new RadioGroup(this);
        int[] modes = {WidgetLook.AUTO, WidgetLook.COMPACT, WidgetLook.ROOMY};
        for (int m : modes) {
            RadioButton b = new RadioButton(this);
            b.setId(View.generateViewId());
            b.setText(m == WidgetLook.COMPACT ? getString(R.string.settings_layout_compact)
                    : m == WidgetLook.ROOMY ? getString(R.string.settings_layout_roomy) : "");
            if (m == WidgetLook.AUTO) autoButton = b;
            modeGroup.addView(b);
            if (m == mode) modeGroup.check(b.getId());
        }
        modeGroup.setOnCheckedChangeListener((group, checkedId) -> {
            int index = group.indexOfChild(group.findViewById(checkedId));
            if (index < 0) return;
            mode = modes[index];
            refreshPreview();
            save();
        });
        root.addView(modeGroup);
        TextView hint = new TextView(this);
        hint.setText(R.string.settings_layout_hint);
        hint.setTextSize(13);
        root.addView(hint);

        // Voorbeeld: de widget zelf, met kop en voorbeeldtaken (lange titels, lijsten, tijden, wie het doet).
        label(root, R.string.settings_preview);
        preview = new LinearLayout(this);
        preview.setOrientation(LinearLayout.VERTICAL);
        preview.setBackgroundResource(R.drawable.widget_bg);
        preview.setPadding((int) (2 * density), (int) (4 * density), (int) (2 * density), (int) (6 * density));
        View header = LayoutInflater.from(this).inflate(R.layout.widget_header, preview, false);
        previewTitle = header.findViewById(R.id.header_title);
        // Alleen kijken: de knoppen in het voorbeeld doen niets.
        header.findViewById(R.id.btn_refresh).setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        header.findViewById(R.id.btn_add).setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        preview.addView(header);
        // Geen melding bovenaan: die staat er alleen bij een probleem of een lege lijst (WidgetStatus).
        previewRows = new LinearLayout(this);
        previewRows.setOrientation(LinearLayout.VERTICAL);
        preview.addView(previewRows);
        LinearLayout.LayoutParams pp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        pp.topMargin = (int) (8 * density);
        pp.bottomMargin = (int) (8 * density);
        // Zo breed als de widget op het startscherm (als de launcher dat doorgaf), zodat titels net zo afbreken.
        int widthDp = WidgetRows.sizeDp(this, widgetId)[0];
        int maxPx = getResources().getDisplayMetrics().widthPixels - (int) (40 * density);
        if (widthDp > 0 && widthDp * density < maxPx) {
            pp.width = Math.round(widthDp * density);
            pp.gravity = Gravity.CENTER_HORIZONTAL;
        }
        root.addView(preview, pp);

        fontLabel = new TextView(this);
        fontLabel.setPadding(0, (int) (8 * density), 0, 0);
        root.addView(fontLabel);
        SeekBar fontBar = new SeekBar(this);
        fontBar.setMax(WidgetLook.FONT_MAX - WidgetLook.FONT_MIN);
        fontBar.setProgress(font - WidgetLook.FONT_MIN);
        root.addView(fontBar);

        spacingLabel = new TextView(this);
        spacingLabel.setPadding(0, (int) (16 * density), 0, 0);
        root.addView(spacingLabel);
        SeekBar spacingBar = new SeekBar(this);
        spacingBar.setMax(WidgetLook.SPACING_MAX - WidgetLook.SPACING_MIN);
        spacingBar.setProgress(spacing - WidgetLook.SPACING_MIN);
        root.addView(spacingBar);

        SeekBar.OnSeekBarChangeListener listener = new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar bar, int progress, boolean fromUser) {
                if (bar == fontBar) font = WidgetLook.FONT_MIN + progress;
                else spacing = WidgetLook.SPACING_MIN + progress;
                refreshPreview();
            }

            @Override
            public void onStartTrackingTouch(SeekBar bar) {}

            @Override
            public void onStopTrackingTouch(SeekBar bar) {
                save();
            }
        };
        fontBar.setOnSeekBarChangeListener(listener);
        spacingBar.setOnSeekBarChangeListener(listener);

        Button reset = new Button(this);
        reset.setText(R.string.settings_reset);
        reset.setOnClickListener(v -> {
            font = WidgetLook.FONT_DEFAULT;
            spacing = WidgetLook.SPACING_DEFAULT;
            fontBar.setProgress(font - WidgetLook.FONT_MIN);
            spacingBar.setProgress(spacing - WidgetLook.SPACING_MIN);
            modeGroup.check(autoButton.getId()); // zet mode en slaat op
            refreshPreview();
            save();
        });
        LinearLayout.LayoutParams rp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        rp.topMargin = (int) (24 * density);
        root.addView(reset, rp);

        Button done = new Button(this);
        done.setText(R.string.settings_done);
        done.setOnClickListener(v -> {
            save();
            // Van de launcher: het hele scherm weg. Vanuit de app: terug naar waar je was.
            if (AppWidgetManager.ACTION_APPWIDGET_CONFIGURE.equals(getIntent().getAction())) finishAndRemoveTask();
            else finish();
        });
        root.addView(done);

        refreshPreview();
    }

    /** Lijstnamen uit de opgeslagen taken: direct beschikbaar, ook zonder verbinding. */
    private Set<String> namesFromCache() {
        try {
            return WidgetFilter.listNames(new JSONArray(Prefs.cache(this)));
        } catch (Exception e) {
            return new LinkedHashSet<>();
        }
    }

    /** Ook lege lijsten en lijsten met alleen afgeronde taken: die kent alleen de server (GET /api/lists). */
    private void loadListsFromServer() {
        new Thread(() -> {
            try {
                JSONArray arr = new JSONArray(Api.call(this, "GET", "/api/lists", null));
                Set<String> names = namesFromCache();
                for (int i = 0; i < arr.length(); i++) names.add(WidgetFilter.normName(arr.getJSONObject(i).optString("name")));
                runOnUiThread(() -> {
                    if (!isFinishing()) fillViews(names);
                });
            } catch (Exception ignored) {
                // Dan blijft de lijst uit de cache staan.
            }
        }).start();
    }

    /** Keuzes: Alles, Vandaag & te laat, Inbox en de eigen lijsten op naam; de huidige keuze staat aangevinkt. */
    private void fillViews(Set<String> names) {
        String current = Prefs.widgetView(this, widgetId);
        List<String> own = new ArrayList<>();
        for (String n : names) if (!WidgetFilter.INBOX.equals(WidgetFilter.normName(n))) own.add(n);
        // Bestaat de gekozen lijst (nog) niet in de taken, laat hem dan toch zien zodat de keuze niet verdwijnt.
        if (!current.isEmpty() && !WidgetFilter.TODAY.equals(current) && !WidgetFilter.INBOX.equals(current)
                && !own.contains(current)) own.add(current);
        Collator coll = Collator.getInstance(Locale.getDefault());
        coll.setStrength(Collator.PRIMARY);
        own.sort(coll);

        viewValues.clear();
        viewValues.add("");
        viewValues.add(WidgetFilter.TODAY);
        viewValues.add(WidgetFilter.INBOX);
        viewValues.addAll(own);

        viewGroup.setOnCheckedChangeListener(null);
        viewGroup.removeAllViews();
        for (int i = 0; i < viewValues.size(); i++) {
            String v = viewValues.get(i);
            RadioButton b = new RadioButton(this);
            b.setId(View.generateViewId());
            b.setText(v.isEmpty() ? getString(R.string.widget_view_all)
                    : WidgetFilter.TODAY.equals(v) ? getString(R.string.widget_view_today_long) : v);
            viewGroup.addView(b);
            if (v.equals(current)) viewGroup.check(b.getId());
        }
        viewGroup.setOnCheckedChangeListener((group, checkedId) -> {
            int index = group.indexOfChild(group.findViewById(checkedId));
            if (index < 0) return;
            Prefs.setWidgetView(this, widgetId, viewValues.get(index));
            TaskWidgetProvider.updateAll(this);
            refreshPreview();
        });
    }

    /** Het voorbeeld opnieuw: dezelfde rijen als de widget (WidgetRows), toegepast op gewone views. */
    private void refreshPreview() {
        if (preview == null || fontLabel == null || spacingLabel == null) return; // scherm nog niet af
        fontLabel.setText(getString(R.string.settings_font, font));
        spacingLabel.setText(getString(R.string.settings_spacing, spacing));
        int[] size = WidgetRows.sizeDp(this, widgetId);
        boolean roomyBySize = WidgetLook.isRoomy(WidgetLook.AUTO, size[0], size[1]);
        autoButton.setText(getString(R.string.settings_layout_auto, layoutName(roomyBySize)));
        WidgetLook look = new WidgetLook(font, spacing, WidgetLook.isRoomy(mode, size[0], size[1]), size[0], size[1]);

        String view = Prefs.widgetView(this, widgetId);
        previewTitle.setText(TaskWidgetProvider.title(this, view));
        previewTitle.setTextSize(TypedValue.COMPLEX_UNIT_SP, look.headerSp());

        Instant now = Instant.now();
        List<JSONObject> tasks = sampleTasks(view);
        Map<String, Integer> subs = new HashMap<>();
        subs.put("preview-3", 3);
        Set<String> lists = new HashSet<>();
        for (JSONObject t : tasks) lists.add(t.optString("list"));
        WidgetRows rows = new WidgetRows(this, look, view, subs, lists, now, PREVIEW_ME);
        previewRows.removeAllViews();
        for (WidgetSections.Entry e : WidgetSections.plan(tasks, view, now, look.sections())) {
            android.widget.RemoteViews rv = e.header ? rows.section(e.section) : rows.task(tasks.get(e.task), 0, e.groupEnd);
            View row = rv.apply(this, previewRows);
            previewRows.addView(row);
        }
    }

    /** Wie "ik" ben in de voorbeeldtaken. */
    private static final String PREVIEW_ME = "preview-me";

    /**
     * Voorbeeldtaken: een lange titel die afbreekt (te laat, herhaalt, vastgezet), een korte (vandaag, met een plaats,
     * iemand anders doet hem) en een lange gedeelde met subtaken. In een widget op één lijst staan ze allemaal in die
     * lijst (geen lijstnaam).
     */
    private List<JSONObject> sampleTasks(String view) {
        ZonedDateTime now = ZonedDateTime.now();
        ZonedDateTime endOfDay = now.toLocalDate().plusDays(1).atStartOfDay(now.getZone());
        ZonedDateTime later = now.plusHours(1).truncatedTo(ChronoUnit.HOURS);
        if (!later.isBefore(endOfDay)) later = endOfDay.minusMinutes(1);
        ZonedDateTime yesterday = now.minusDays(1).withHour(16).withMinute(0).withSecond(0).withNano(0);
        boolean oneList = !view.isEmpty() && !WidgetFilter.TODAY.equals(view);
        List<JSONObject> out = new ArrayList<>();
        try {
            out.add(new JSONObject().put("id", "preview-1").put("title", getString(R.string.preview_task_long))
                    .put("list", oneList ? view : getString(R.string.preview_list_home))
                    .put("remind_at", yesterday.toInstant().toString()).put("repeat", new JSONObject())
                    .put("pinned", true).put("parent_id", JSONObject.NULL));
            out.add(new JSONObject().put("id", "preview-2").put("title", getString(R.string.preview_task_short))
                    .put("list", oneList ? view : getString(R.string.preview_list_groceries))
                    .put("remind_at", later.toInstant().toString()).put("location", new JSONObject())
                    .put("claimed_by", new JSONObject().put("id", "preview-person").put("name", getString(R.string.preview_person)))
                    .put("pinned", false).put("parent_id", JSONObject.NULL));
            out.add(new JSONObject().put("id", "preview-3").put("title", getString(R.string.preview_task_work))
                    .put("list", oneList ? view : getString(R.string.preview_list_work))
                    .put("remind_at", WidgetFilter.TODAY.equals(view) ? later.toInstant().toString() : JSONObject.NULL)
                    .put("share", new JSONObject().put("mine", true)
                            .put("owner", new JSONObject().put("id", PREVIEW_ME).put("name", ""))
                            .put("members", new JSONArray().put(new JSONObject().put("user_id", "preview-person")
                                    .put("name", getString(R.string.preview_person)).put("status", "accepted"))))
                    .put("pinned", false).put("parent_id", JSONObject.NULL));
        } catch (Exception ignored) {
            // JSONObject.put met een gewone sleutel faalt niet
        }
        return out;
    }

    private void save() {
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID || preview == null) return;
        Prefs.setWidgetLook(this, widgetId, font, spacing, mode);
        TaskWidgetProvider.updateAll(this);
    }

    @Override
    protected void onPause() {
        super.onPause();
        save();
    }
}
