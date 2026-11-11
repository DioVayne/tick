package nl.detussenpartij.tick;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DatePickerDialog;
import android.app.TimePickerDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Insets;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.text.format.DateFormat;
import android.view.View;
import android.view.WindowInsets;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.TextStyle;
import java.time.temporal.WeekFields;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.TreeSet;
import java.util.UUID;

public class QuickAddActivity extends Activity {
    /** Weergave van de widget waar de + op zat: een lijstnaam, WidgetFilter.TODAY of leeg. */
    static final String EXTRA_VIEW = "view";

    private static final DateTimeFormatter SHOWN = DateTimeFormatter.ofPattern("EEE d MMM HH:mm", Locale.getDefault());
    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("HH:mm", Locale.getDefault());
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("EEE d MMM", Locale.getDefault());

    private EditText title;
    private EditText notes;
    private TextView send;
    private TextView listChip, today, tomorrow, week, pick, repeatChip, notesToggle, status;
    private TextView placeChip, placeEnter, placeExit, moreToggle, remindText;
    private View placeRow, more, remindRow, remindClear, draftRow;

    /** Waar de popup mee begint (en na "nog een" weer op terugvalt). */
    private boolean fromToday;
    /** De lijst van de widget waarop je tikte (of Inbox): een concept houdt alleen een zelf gekozen andere lijst. */
    private String openedList;
    private LocalDateTime remindAt;
    /** Je koos of wiste de herinnering zelf; anders is het de beginwaarde (van de widget Vandaag). */
    private boolean remindChanged;
    /** Na toevoegen dicht: niets als concept bewaren. */
    private boolean finished;
    /** Via "Delen": geen concept terugzetten of overschrijven (de tekst staat nog in de andere app). */
    private boolean draftsOn = true;
    private QuickAddPlan.Repeat repeat = QuickAddPlan.Repeat.NONE;
    /** De lijst voor de nieuwe taak; Inbox stuurt de app niet mee (dan kiest de server Inbox). */
    private String list = WidgetFilter.INBOX;
    /** Lijstnamen voor de kiezer: eerst uit de widgetcache, daarna aangevuld met /api/lists (ook lege en gedeelde). */
    private final TreeSet<String> lists = new TreeSet<>(String.CASE_INSENSITIVE_ORDER);
    /** De plek voor de nieuwe taak (of null), en of hij bij vertrek meldt in plaats van bij aankomst. */
    private QuickAddPlan.Place place;
    private boolean placeOnExit;
    /** Favoriete plekken uit /api/places; leeg tot ze binnen zijn (of offline). */
    private List<JSONObject> favorites = Collections.emptyList();
    private static final int REQ_LOCATION = 1;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        setContentView(R.layout.quick_add);

        View scrim = findViewById(R.id.scrim);
        View sheet = findViewById(R.id.sheet);
        title = findViewById(R.id.title);
        notes = findViewById(R.id.notes);
        send = findViewById(R.id.send);
        listChip = findViewById(R.id.list);
        today = findViewById(R.id.when_today);
        tomorrow = findViewById(R.id.when_tomorrow);
        week = findViewById(R.id.when_week);
        pick = findViewById(R.id.when_pick);
        repeatChip = findViewById(R.id.repeat);
        notesToggle = findViewById(R.id.notes_toggle);
        status = findViewById(R.id.status);
        placeChip = findViewById(R.id.place);
        placeEnter = findViewById(R.id.place_enter);
        placeExit = findViewById(R.id.place_exit);
        placeRow = findViewById(R.id.place_row);
        more = findViewById(R.id.more);
        moreToggle = findViewById(R.id.more_toggle);
        remindRow = findViewById(R.id.remind_row);
        remindText = findViewById(R.id.remind_text);
        remindClear = findViewById(R.id.remind_clear);
        draftRow = findViewById(R.id.draft_row);
        CheckBox keepOpen = findViewById(R.id.keep_open);

        // De app tekent tot onder de systeembalken (edge-to-edge): het paneel schuift zelf boven het toetsenbord.
        int padBottom = sheet.getPaddingBottom();
        scrim.setOnApplyWindowInsetsListener((v, insets) -> {
            Insets in = insets.getInsets(WindowInsets.Type.ime() | WindowInsets.Type.systemBars());
            sheet.setPadding(sheet.getPaddingLeft(), sheet.getPaddingTop(), sheet.getPaddingRight(), padBottom + in.bottom);
            return WindowInsets.CONSUMED;
        });
        scrim.setOnClickListener(v -> finishAndRemoveTask());

        String view = getIntent().getStringExtra(EXTRA_VIEW);
        // Vanuit Vandaag: anders zou de nieuwe taak niet in die widget staan.
        fromToday = WidgetFilter.TODAY.equals(view);
        if (!fromToday && view != null && !view.isEmpty()) list = WidgetFilter.normName(view);
        openedList = list;
        lists.add(WidgetFilter.INBOX);
        lists.add(list);
        try {
            lists.addAll(WidgetFilter.listNames(new JSONArray(Prefs.cache(this))));
        } catch (Exception ignored) {
            // Geen of een kapotte cache: dan alleen wat /api/lists straks geeft.
        }
        loadLists();
        loadFavorites();
        resetWhen();

        String shared = getIntent().getStringExtra(Intent.EXTRA_TEXT);
        if (shared != null) title.setText(shared.trim());
        draftsOn = shared == null;
        // Eén regel voor de toets Versturen op het toetsenbord, maar lange titels lopen door over meer regels.
        title.setHorizontallyScrolling(false);
        title.setMaxLines(4);
        title.setOnEditorActionListener((v, action, e) -> {
            if (action != EditorInfo.IME_ACTION_SEND) return false;
            submit();
            return true;
        });
        title.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int a, int b, int c) {}
            @Override public void onTextChanged(CharSequence s, int a, int b, int c) {}
            @Override public void afterTextChanged(Editable s) { refreshSend(); }
        });
        send.setOnClickListener(v -> submit());

        listChip.setCompoundDrawableTintList(null);
        listChip.setOnClickListener(v -> pickList());
        today.setOnClickListener(v -> choose(QuickAddPlan.today(LocalDateTime.now())));
        tomorrow.setOnClickListener(v -> choose(QuickAddPlan.tomorrow(LocalDateTime.now())));
        week.setOnClickListener(v -> choose(QuickAddPlan.nextWeek(LocalDateTime.now(), firstDayOfWeek())));
        pick.setOnClickListener(v -> pickDateTime());
        repeatChip.setOnClickListener(v -> pickRepeat());
        placeChip.setOnClickListener(v -> pickPlace());
        placeEnter.setOnClickListener(v -> { placeOnExit = false; refreshPlace(); });
        placeExit.setOnClickListener(v -> { placeOnExit = true; refreshPlace(); });
        notesToggle.setOnClickListener(v -> {
            boolean show = notes.getVisibility() != View.VISIBLE;
            notes.setVisibility(show ? View.VISIBLE : View.GONE);
            notesToggle.setSelected(show);
            (show ? notes : title).requestFocus();
        });
        keepOpen.setChecked(Prefs.quickKeepOpen(this));
        keepOpen.setOnCheckedChangeListener((b, on) -> Prefs.setQuickKeepOpen(this, on));
        moreToggle.setOnClickListener(v -> setMore(more.getVisibility() != View.VISIBLE));
        // De herinneringsregel: tik om te wijzigen; zonder herinnering (vanuit Vandaag) zet tikken de beginwaarde terug.
        remindText.setOnClickListener(v -> {
            if (remindAt != null) pickDateTime();
            else resetWhen();
        });
        remindClear.setOnClickListener(v -> {
            remindAt = null;
            remindChanged = true;
            refreshWhen();
        });
        draftRow.findViewById(R.id.draft_discard).setOnClickListener(v -> discardDraft());

        // Per ongeluk gesloten? Dan staat het concept er weer (niet bij "Delen": dan begint hij met de gedeelde tekst).
        QuickAddPlan.Draft draft = draftsOn ? QuickAddPlan.Draft.fromJson(Prefs.quickDraft(this)) : null;
        if (draft != null && (draft.expired(System.currentTimeMillis()) || !draft.worthKeeping())) {
            Prefs.setQuickDraft(this, null);
            draft = null;
        }
        // Na draaien of terugkomen na een opgeruimd proces is het geen nieuws: dan zonder de melding.
        if (draft != null) applyDraft(draft, state == null);

        refreshList();
        refreshRepeat();
        refreshPlace();
        refreshSend();
        title.requestFocus();
        title.setSelection(title.length());
        // Ook via "Delen" vanuit een andere app: de app staat nu op de voorgrond, zie MainActivity.setUp.
        TaskWidgetProvider.updateAll(this);
    }

    /** Herinnering zoals de popup begint: vanuit de widget Vandaag het eerstvolgende hele uur, anders geen. */
    private void resetWhen() {
        remindAt = QuickAddPlan.startReminder(fromToday, LocalDateTime.now());
        remindChanged = false;
        refreshWhen();
    }

    /** Een snelknop kiezen; nog eens tikken op de gekozen knop wist de herinnering. */
    private void choose(LocalDateTime at) {
        remindAt = at == null || at.equals(remindAt) ? null : at;
        remindChanged = true;
        refreshWhen();
    }

    /**
     * De herinnering in woorden onder de titel, zodat een melding nooit verrast (vanuit Vandaag staat er al een). Zonder
     * herinnering alleen vanuit Vandaag: dan zegt de regel dat de taak niet in die widget komt.
     */
    private void refreshRemindLine() {
        remindRow.setVisibility(remindAt != null || fromToday ? View.VISIBLE : View.GONE);
        remindClear.setVisibility(remindAt != null ? View.VISIBLE : View.GONE);
        if (remindAt == null) {
            remindText.setText(R.string.quick_remind_none_today);
            remindText.setTextColor(getColor(R.color.widget_muted));
            return;
        }
        String time = TIME.format(remindAt);
        switch (QuickAddPlan.day(LocalDateTime.now(), remindAt)) {
            case TODAY: remindText.setText(getString(R.string.quick_remind_today, time)); break;
            case TOMORROW: remindText.setText(getString(R.string.quick_remind_tomorrow, time)); break;
            default: remindText.setText(getString(R.string.quick_remind_on, DAY.format(remindAt), time));
        }
        remindText.setTextColor(getColor(R.color.widget_text));
    }

    /** "Meer opties" open of dicht. */
    private void setMore(boolean open) {
        more.setVisibility(open ? View.VISIBLE : View.GONE);
        refreshMoreToggle();
    }

    /** Dichtgeklapt maar met een plek, ritme of omschrijving: dan is de knop blauw, zodat je ziet dat er iets staat. */
    private void refreshMoreToggle() {
        boolean open = more.getVisibility() == View.VISIBLE;
        boolean extras = repeat != QuickAddPlan.Repeat.NONE || place != null
                || !notes.getText().toString().trim().isEmpty();
        moreToggle.setText(open ? R.string.quick_less : R.string.quick_more);
        moreToggle.setSelected(!open && extras);
    }

    /** Een concept terugzetten. Lijst en herinnering alleen als je die zelf koos (zie QuickAddPlan.Draft). */
    private void applyDraft(QuickAddPlan.Draft d, boolean announce) {
        LocalDateTime now = LocalDateTime.now();
        title.setText(d.title);
        notes.setText(d.notes);
        boolean hasNotes = !d.notes.trim().isEmpty();
        notes.setVisibility(hasNotes ? View.VISIBLE : View.GONE);
        notesToggle.setSelected(hasNotes);
        list = d.listFor(openedList);
        lists.add(list);
        remindAt = d.remindFor(QuickAddPlan.startReminder(fromToday, now), now);
        remindChanged = d.keepsReminder(now);
        repeat = d.repeat;
        place = d.place;
        placeOnExit = d.placeOnExit;
        setMore(d.usesExtras());
        draftRow.setVisibility(announce ? View.VISIBLE : View.GONE);
        refreshWhen();
    }

    /** Weggooien: het concept wissen en opnieuw beginnen zoals de popup opende. */
    private void discardDraft() {
        Prefs.setQuickDraft(this, null);
        title.setText("");
        notes.setText("");
        notes.setVisibility(View.GONE);
        notesToggle.setSelected(false);
        list = openedList;
        repeat = QuickAddPlan.Repeat.NONE;
        place = null;
        placeOnExit = false;
        draftRow.setVisibility(View.GONE);
        status.setVisibility(View.GONE);
        refreshList();
        refreshPlace();
        resetWhen();
        setMore(false);
        title.requestFocus();
    }

    /** Wat er nu in de popup staat, als concept voor de volgende keer. */
    private QuickAddPlan.Draft currentDraft() {
        QuickAddPlan.Draft d = new QuickAddPlan.Draft();
        d.title = title.getText().toString();
        d.notes = notes.getText().toString();
        d.list = list;
        d.listChanged = !list.equalsIgnoreCase(openedList);
        d.remindAt = remindAt;
        d.remindChanged = remindChanged;
        d.repeat = repeat;
        d.place = place;
        d.placeOnExit = placeOnExit;
        d.savedAt = System.currentTimeMillis();
        return d;
    }

    /** Dicht zonder toevoegen (terug, naast het paneel getikt, andere app): bewaren; met een lege titel weg ermee. */
    @Override
    protected void onPause() {
        super.onPause();
        if (finished || !draftsOn) return;
        try {
            QuickAddPlan.Draft d = currentDraft();
            Prefs.setQuickDraft(this, d.worthKeeping() ? d.toJson().toString() : null);
        } catch (Exception ignored) {
            // Een concept is een gemak; lukt het niet, dan gewoon niet.
        }
    }

    private void refreshWhen() {
        LocalDateTime now = LocalDateTime.now();
        LocalDateTime t = QuickAddPlan.today(now);
        today.setVisibility(t == null ? View.GONE : View.VISIBLE);
        boolean onToday = remindAt != null && remindAt.equals(t);
        boolean onTomorrow = remindAt != null && remindAt.equals(QuickAddPlan.tomorrow(now));
        boolean onWeek = remindAt != null && remindAt.equals(QuickAddPlan.nextWeek(now, firstDayOfWeek()));
        boolean custom = remindAt != null && !onToday && !onTomorrow && !onWeek;
        today.setSelected(onToday);
        tomorrow.setSelected(onTomorrow);
        week.setSelected(onWeek);
        pick.setSelected(custom);
        // De gekozen knop toont ook de tijd, zodat je ziet wanneer de herinnering komt.
        today.setText(withTime(R.string.quick_today, onToday));
        tomorrow.setText(withTime(R.string.quick_tomorrow, onTomorrow));
        week.setText(withTime(R.string.quick_next_week, onWeek));
        pick.setText(custom ? SHOWN.format(remindAt) : getString(R.string.quick_pick));
        refreshRepeat(); // wekelijks en maandelijks noemen de dag van de herinnering
        refreshRemindLine();
    }

    private String withTime(int label, boolean on) {
        return on ? getString(label) + " · " + TIME.format(remindAt) : getString(label);
    }

    private DayOfWeek firstDayOfWeek() {
        return WeekFields.of(Locale.getDefault()).getFirstDayOfWeek();
    }

    /** Eerst de datum, dan de tijd. Standaard: morgen 09:00 (of de eerder gekozen waarde). */
    private void pickDateTime() {
        LocalDateTime start = remindAt != null ? remindAt : QuickAddPlan.tomorrow(LocalDateTime.now());
        DatePickerDialog d = new DatePickerDialog(this, (dv, y, m, day) ->
                new TimePickerDialog(this, (tv, h, min) -> {
                    remindAt = LocalDateTime.of(y, m + 1, day, h, min);
                    remindChanged = true;
                    refreshWhen();
                }, start.getHour(), start.getMinute(), DateFormat.is24HourFormat(this)).show(),
                start.getYear(), start.getMonthValue() - 1, start.getDayOfMonth());
        d.getDatePicker().setFirstDayOfWeek(firstDayOfWeek().getValue() % 7 + 1); // Calendar: zondag = 1
        d.show();
    }

    /** De dag waar een ritme op begint: die van de herinnering, of vandaag. */
    private LocalDate repeatStart() {
        return remindAt != null ? remindAt.toLocalDate() : LocalDate.now();
    }

    private String repeatLabel(QuickAddPlan.Repeat r) {
        LocalDate d = repeatStart();
        String day = d.getDayOfWeek().getDisplayName(TextStyle.FULL, Locale.getDefault());
        switch (r) {
            case DAILY: return getString(R.string.quick_repeat_daily);
            case WEEKLY: return getString(R.string.quick_repeat_weekly, day);
            case BIWEEKLY: return getString(R.string.quick_repeat_biweekly, day);
            case MONTHLY: return getString(R.string.quick_repeat_monthly, d.getDayOfMonth());
            case YEARLY: return getString(R.string.quick_repeat_yearly,
                    d.format(DateTimeFormatter.ofPattern("d MMMM", Locale.getDefault())));
            default: return getString(R.string.quick_repeat_none);
        }
    }

    private void pickRepeat() {
        QuickAddPlan.Repeat[] all = QuickAddPlan.Repeat.values();
        String[] labels = new String[all.length];
        for (int i = 0; i < all.length; i++) labels[i] = repeatLabel(all[i]);
        new AlertDialog.Builder(this)
                .setTitle(R.string.quick_repeat)
                .setSingleChoiceItems(labels, repeat.ordinal(), (dlg, i) -> {
                    repeat = all[i];
                    refreshRepeat();
                    dlg.dismiss();
                })
                .show();
    }

    private void refreshRepeat() {
        boolean on = repeat != QuickAddPlan.Repeat.NONE;
        repeatChip.setSelected(on);
        repeatChip.setText(on ? repeatLabel(repeat) : getString(R.string.quick_repeat));
        refreshMoreToggle();
    }

    private void pickList() {
        List<String> names = new ArrayList<>(lists);
        // Inbox bovenaan, net als in de zijbalk van de webapp.
        names.remove(WidgetFilter.INBOX);
        names.add(0, WidgetFilter.INBOX);
        new AlertDialog.Builder(this)
                .setTitle(R.string.quick_list)
                .setSingleChoiceItems(names.toArray(new String[0]), names.indexOf(list), (dlg, i) -> {
                    list = names.get(i);
                    refreshList();
                    dlg.dismiss();
                })
                .show();
    }

    /** De lijstknop: naam en bolletje in de lijstkleur (Inbox grijs), net als de pil in de widget. */
    private void refreshList() {
        listChip.setText(list);
        String hex = WidgetFilter.listColor(list, lists, Locale.getDefault());
        boolean dark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        int color = hex == null ? getColor(R.color.widget_muted)
                : WidgetFilter.readable(Color.parseColor(hex), getColor(R.color.widget_pill) & 0xFFFFFF, dark);
        Drawable[] d = listChip.getCompoundDrawablesRelative();
        GradientDrawable dot = new GradientDrawable();
        dot.setShape(GradientDrawable.OVAL);
        dot.setColor(color);
        int size = Math.round(10 * getResources().getDisplayMetrics().density);
        dot.setSize(size, size);
        listChip.setCompoundDrawablesRelativeWithIntrinsicBounds(dot, d[1], d[2], d[3]);
        listChip.setTextColor(color);
    }

    /** Alle lijsten ophalen, ook lege en gedeelde die niet in de widgetcache staan. Mislukt het, dan blijft de cache. */
    private void loadLists() {
        new Thread(() -> {
            try {
                JSONArray arr = new JSONArray(Api.call(this, "GET", "/api/lists", null));
                Collection<String> names = new ArrayList<>();
                for (int i = 0; i < arr.length(); i++) names.add(WidgetFilter.normName(arr.getJSONObject(i).optString("name")));
                runOnUiThread(() -> {
                    lists.addAll(names);
                    refreshList(); // de kleur hangt af van alle namen
                });
            } catch (Exception ignored) {
                // Offline: de kiezer heeft dan de lijsten uit de cache.
            }
        }).start();
    }

    /** Favoriete plekken ophalen voor de plekkiezer. Mislukt het, dan biedt hij de rest nog aan. */
    private void loadFavorites() {
        new Thread(() -> {
            try {
                JSONArray arr = new JSONArray(Api.call(this, "GET", "/api/places", null));
                List<JSONObject> found = new ArrayList<>();
                for (int i = 0; i < arr.length(); i++) found.add(arr.getJSONObject(i));
                runOnUiThread(() -> favorites = found);
            } catch (Exception ignored) {
                // Offline: dan alleen recente plekken, je locatie en zoeken.
            }
        }).start();
    }

    /** Favorieten, recent gebruikte plekken, je huidige locatie of een adres zoeken; met een plek ook "weghalen". */
    private void pickPlace() {
        List<String> labels = new ArrayList<>();
        List<Runnable> actions = new ArrayList<>();
        List<String> favNames = new ArrayList<>();
        for (JSONObject f : favorites) {
            String name = f.optString("name");
            favNames.add(name);
            labels.add("★  " + name);
            actions.add(() -> setPlace(new QuickAddPlan.Place(name, f.optDouble("lat"), f.optDouble("lng"),
                    f.has("radius") ? f.optInt("radius") : null), placeOnExit));
        }
        List<JSONObject> recent = Collections.emptyList();
        try {
            recent = QuickAddPlan.recentPlaces(new JSONArray(Prefs.cache(this)), favNames, 5);
        } catch (Exception ignored) {
            // Geen cache: dan geen recente plekken.
        }
        for (JSONObject loc : recent) {
            String name = loc.optString("name");
            labels.add("↺  " + name);
            // Met de straal en trigger van toen.
            actions.add(() -> setPlace(new QuickAddPlan.Place(name, loc.optDouble("lat"), loc.optDouble("lng"),
                    loc.has("radius") ? loc.optInt("radius") : null), "exit".equals(loc.optString("trigger"))));
        }
        labels.add("◎  " + getString(R.string.quick_place_here));
        actions.add(this::useCurrentLocation);
        labels.add("⌕  " + getString(R.string.quick_place_search));
        actions.add(this::searchAddress);
        if (place != null) {
            labels.add("✕  " + getString(R.string.quick_place_clear));
            actions.add(() -> setPlace(null, false));
        }
        new AlertDialog.Builder(this)
                .setTitle(R.string.quick_place)
                .setItems(labels.toArray(new String[0]), (dlg, i) -> actions.get(i).run())
                .show();
    }

    private void setPlace(QuickAddPlan.Place p, boolean onExit) {
        place = p;
        placeOnExit = onExit;
        refreshPlace();
        status.setVisibility(View.GONE);
        // Zonder "Altijd toestaan" komt er geen melding: zeg het meteen, niet pas als je bij de winkel staat.
        if (p != null && !Geo.permitted(this)) showStatus(getString(R.string.quick_place_no_permission), R.color.overdue);
    }

    private void refreshPlace() {
        boolean on = place != null;
        placeChip.setSelected(on);
        placeChip.setText(on ? place.name : getString(R.string.quick_place));
        placeRow.setVisibility(on ? View.VISIBLE : View.GONE);
        placeEnter.setSelected(on && !placeOnExit);
        placeExit.setSelected(on && placeOnExit);
        refreshMoreToggle();
    }

    /** Waar je nu bent. Vraagt zo nodig eerst toestemming voor je locatie. */
    private void useCurrentLocation() {
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED
                && checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] {Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOCATION);
            return;
        }
        showStatus(getString(R.string.quick_place_locating), R.color.widget_muted);
        try {
            LocationServices.getFusedLocationProviderClient(this)
                    .getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, null)
                    .addOnSuccessListener(this, loc -> {
                        if (loc == null) {
                            showStatus(getString(R.string.quick_place_no_location), R.color.overdue);
                            return;
                        }
                        String name = getString(R.string.quick_place_here_name,
                                DateTimeFormatter.ofPattern("d MMM HH:mm", Locale.getDefault()).format(LocalDateTime.now()));
                        setPlace(new QuickAddPlan.Place(name, loc.getLatitude(), loc.getLongitude(), null), placeOnExit);
                    })
                    .addOnFailureListener(this, e -> showStatus(getString(R.string.quick_place_no_location), R.color.overdue));
        } catch (SecurityException e) {
            showStatus(getString(R.string.quick_place_no_location), R.color.overdue);
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code != REQ_LOCATION) return;
        boolean granted = false;
        for (int r : results) granted |= r == PackageManager.PERMISSION_GRANTED;
        if (granted) useCurrentLocation();
        else showStatus(getString(R.string.quick_place_no_location), R.color.overdue);
    }

    /** Een adres zoeken via je Tick (GET /api/geocode, Nominatim) en uit de resultaten kiezen. */
    private void searchAddress() {
        EditText query = new EditText(this);
        query.setSingleLine(true);
        query.setHint(R.string.quick_place_search_hint);
        query.setImeOptions(EditorInfo.IME_ACTION_SEARCH);
        int pad = Math.round(20 * getResources().getDisplayMetrics().density);
        FrameLayout box = new FrameLayout(this);
        box.setPadding(pad, pad / 2, pad, 0);
        box.addView(query);
        AlertDialog dlg = new AlertDialog.Builder(this)
                .setTitle(R.string.quick_place_search)
                .setView(box)
                .setPositiveButton(R.string.quick_place_search_go, (d, w) -> geocode(query.getText().toString().trim()))
                .setNegativeButton(android.R.string.cancel, null)
                .create();
        query.setOnEditorActionListener((v, action, e) -> {
            if (action != EditorInfo.IME_ACTION_SEARCH) return false;
            dlg.dismiss();
            geocode(query.getText().toString().trim());
            return true;
        });
        dlg.setOnShowListener(d -> {
            query.requestFocus();
            getSystemService(InputMethodManager.class).showSoftInput(query, InputMethodManager.SHOW_IMPLICIT);
        });
        dlg.show();
    }

    private void geocode(String q) {
        if (q.length() < 2) return;
        showStatus(getString(R.string.quick_place_searching), R.color.widget_muted);
        new Thread(() -> {
            List<JSONObject> found = new ArrayList<>();
            Exception failed = null;
            try {
                JSONArray arr = new JSONArray(Api.call(this, "GET", "/api/geocode?q=" + Uri.encode(q), null));
                for (int i = 0; i < arr.length(); i++) found.add(arr.getJSONObject(i));
            } catch (Exception e) {
                failed = e;
            }
            final Exception error = failed;
            runOnUiThread(() -> {
                if (isFinishing()) return;
                if (error != null) {
                    showStatus(getString(R.string.quick_place_search_failed, why(error)), R.color.overdue);
                    return;
                }
                if (found.isEmpty()) {
                    showStatus(getString(R.string.quick_place_nothing_found, q), R.color.overdue);
                    return;
                }
                status.setVisibility(View.GONE);
                String[] names = new String[found.size()];
                for (int i = 0; i < names.length; i++) names[i] = found.get(i).optString("name");
                new AlertDialog.Builder(this)
                        .setTitle(R.string.quick_place_search)
                        .setItems(names, (d, i) -> setPlace(new QuickAddPlan.Place(QuickAddPlan.shortName(names[i]),
                                found.get(i).optDouble("lat"), found.get(i).optDouble("lng"), null), placeOnExit))
                        .show();
            });
        }).start();
    }

    private void refreshSend() {
        send.setEnabled(!title.getText().toString().trim().isEmpty());
    }

    /**
     * Toevoegen: eerst lokaal (de wachtrij, Outbox, met een eigen id), zodat de taak meteen in de widget staat, ook
     * zonder verbinding; daarna op de achtergrond naar de server. Dat id blijft: de server neemt het over.
     */
    private void submit() {
        String text = title.getText().toString().trim();
        if (text.isEmpty()) return;
        if (Prefs.token(this).isEmpty()) {
            // Zonder sleutel kan het nooit aankomen: zeggen, en de tekst laten staan.
            showStatus(getString(R.string.quick_failed, getString(R.string.error_no_key)), R.color.overdue);
            return;
        }
        status.setVisibility(View.GONE);
        final String description = notes.getText().toString().trim();
        final LocalDateTime when = remindAt;
        final String rule = QuickAddPlan.rule(repeat, repeatStart());
        final String inList = WidgetFilter.INBOX.equals(list) ? null : list;
        try {
            String id = UUID.randomUUID().toString();
            JSONObject body = new JSONObject().put("id", id).put("title", text);
            if (!description.isEmpty()) body.put("description", description);
            if (inList != null) body.put("list", inList);
            if (when != null) body.put("remind_at", when.atZone(ZoneId.systemDefault()).toInstant().toString());
            if (rule != null) body.put("repeat", rule);
            if (place != null) body.put("location", place.toJson(placeOnExit));
            long now = System.currentTimeMillis();
            JSONObject task = QuickAddPlan.localTask(body, Instant.ofEpochMilli(now).toString());
            Sync.enqueue(this, Outbox.op(Outbox.CREATE, id, body.toString(), now, now, text, task));
            synchronized (Prefs.class) {
                Prefs.setCache(this, Outbox.withLocal(new JSONArray(Prefs.cache(this)), Prefs.outbox(this)).toString());
            }
        } catch (Exception e) {
            showStatus(getString(R.string.quick_failed, why(e)), R.color.overdue);
            return;
        }
        TaskWidgetProvider.updateAll(this);
        // Versturen en verversen buiten de popup om: hij mag meteen dicht. Lukt het niet, dan probeert een job het later.
        final android.content.Context app = getApplicationContext();
        new Thread(() -> Sync.refresh(app, true, true)).start();
        // Toegevoegd: een concept is er dan niet meer.
        Prefs.setQuickDraft(this, null);
        draftRow.setVisibility(View.GONE);
        if (Prefs.quickKeepOpen(this)) {
            // Nog een: de gekozen lijst blijft, de rest begint opnieuw en het toetsenbord blijft open.
            showStatus(getString(R.string.quick_added_named, text), R.color.widget_muted);
            title.setText("");
            notes.setText("");
            repeat = QuickAddPlan.Repeat.NONE;
            place = null;
            placeOnExit = false;
            refreshPlace();
            resetWhen();
            title.requestFocus();
            getSystemService(InputMethodManager.class).showSoftInput(title, InputMethodManager.SHOW_IMPLICIT);
        } else {
            finished = true;
            Toast.makeText(this, R.string.quick_added, Toast.LENGTH_SHORT).show();
            finishAndRemoveTask();
        }
    }

    /** Waarom een verzoek mislukte; zonder sleutel zegt dat meer dan "geen verbinding". */
    private String why(Exception e) {
        return Prefs.token(this).isEmpty() ? getString(R.string.error_no_key) : Sync.errorText(this, e);
    }

    private void showStatus(String text, int color) {
        status.setText(text);
        status.setTextColor(getColor(color));
        status.setVisibility(View.VISIBLE);
    }
}
