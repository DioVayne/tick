package nl.detussenpartij.tick;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Intent;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.TextView;

import org.json.JSONArray;

import java.text.Collator;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Widget-instellingen: tekstgrootte en regelafstand (voor alle widgets). Werkt ook als configuratiescherm van de widget
 * zelf; dan kies je bovenaan ook wat deze widget toont (Alles, Vandaag of een lijst).
 */
public class SettingsActivity extends Activity {
    static final int FONT_MIN = 12, FONT_MAX = 24, FONT_DEFAULT = 15;
    static final int SPACING_MIN = 0, SPACING_MAX = 16, SPACING_DEFAULT = 0;

    private int font;
    private int spacing;
    private TextView fontLabel;
    private TextView spacingLabel;
    private final TextView[] sample = new TextView[3];
    private float density;
    private int widgetId = AppWidgetManager.INVALID_APPWIDGET_ID;
    private RadioGroup viewGroup;
    private final List<String> viewValues = new ArrayList<>();

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        density = getResources().getDisplayMetrics().density;
        int pad = (int) (20 * density);

        // Als de widget dit scherm opent bij het toevoegen, is wegklikken ook goed: de standaardwaarden gelden dan.
        widgetId = getIntent().getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        if (widgetId != AppWidgetManager.INVALID_APPWIDGET_ID) {
            setResult(RESULT_OK, new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId));
        }

        font = Prefs.fontSp(this);
        spacing = Prefs.spacingDp(this);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, pad);

        TextView title = new TextView(this);
        title.setText(R.string.widget_settings);
        title.setTextSize(24);
        root.addView(title);

        if (widgetId != AppWidgetManager.INVALID_APPWIDGET_ID) {
            TextView label = new TextView(this);
            label.setText(R.string.widget_view_label);
            label.setPadding(0, (int) (16 * density), 0, 0);
            root.addView(label);
            viewGroup = new RadioGroup(this);
            root.addView(viewGroup);
            fillViews(namesFromCache());
            loadListsFromServer();
        }

        // Voorbeeld
        LinearLayout preview = new LinearLayout(this);
        preview.setOrientation(LinearLayout.VERTICAL);
        preview.setPadding((int) (8 * density), (int) (8 * density), (int) (8 * density), (int) (8 * density));
        preview.setBackgroundResource(R.drawable.widget_bg);
        LinearLayout.LayoutParams pp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        pp.topMargin = (int) (16 * density);
        pp.bottomMargin = (int) (8 * density);
        String[] texts = getResources().getStringArray(R.array.settings_examples);
        for (int i = 0; i < sample.length; i++) {
            sample[i] = new TextView(this);
            sample[i].setText("○  " + texts[i]);
            sample[i].setTextColor(getColor(R.color.widget_text));
            preview.addView(sample[i]);
        }
        root.addView(preview, pp);

        fontLabel = new TextView(this);
        root.addView(fontLabel);
        SeekBar fontBar = new SeekBar(this);
        fontBar.setMax(FONT_MAX - FONT_MIN);
        fontBar.setProgress(font - FONT_MIN);
        root.addView(fontBar);

        spacingLabel = new TextView(this);
        spacingLabel.setPadding(0, (int) (16 * density), 0, 0);
        root.addView(spacingLabel);
        SeekBar spacingBar = new SeekBar(this);
        spacingBar.setMax(SPACING_MAX - SPACING_MIN);
        spacingBar.setProgress(spacing - SPACING_MIN);
        root.addView(spacingBar);

        SeekBar.OnSeekBarChangeListener listener = new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar bar, int progress, boolean fromUser) {
                if (bar == fontBar) font = FONT_MIN + progress;
                else spacing = SPACING_MIN + progress;
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
            font = FONT_DEFAULT;
            spacing = SPACING_DEFAULT;
            fontBar.setProgress(font - FONT_MIN);
            spacingBar.setProgress(spacing - SPACING_MIN);
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
            finishAndRemoveTask();
        });
        root.addView(done);

        ScrollView scroll = new ScrollView(this);
        scroll.addView(root);
        scroll.setFitsSystemWindows(true);
        setContentView(scroll);
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
        });
    }

    private void refreshPreview() {
        fontLabel.setText(getString(R.string.settings_font, font));
        spacingLabel.setText(getString(R.string.settings_spacing, spacing));
        int padPx = (int) (spacing * density);
        for (TextView t : sample) {
            t.setTextSize(TypedValue.COMPLEX_UNIT_SP, font);
            t.setPadding(0, padPx + (int) (4 * density), 0, padPx + (int) (4 * density));
            t.setVisibility(View.VISIBLE);
        }
    }

    private void save() {
        Prefs.setLook(this, font, spacing);
        TaskWidgetProvider.updateAll(this);
    }

    @Override
    protected void onPause() {
        super.onPause();
        save();
    }
}
