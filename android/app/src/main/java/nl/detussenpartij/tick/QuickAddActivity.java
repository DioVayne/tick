package nl.detussenpartij.tick;

import android.app.Activity;
import android.app.DatePickerDialog;
import android.app.TimePickerDialog;
import android.content.Intent;
import android.os.Bundle;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.Toast;

import org.json.JSONObject;

import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Locale;

public class QuickAddActivity extends Activity {
    private static final DateTimeFormatter SHOWN =
            DateTimeFormatter.ofPattern("EEE d MMM HH:mm", Locale.getDefault());

    private LocalDateTime remindAt;
    private Button remindButton;
    private Button clearButton;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        float d = getResources().getDisplayMetrics().density;
        int pad = (int) (20 * d);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, pad);

        EditText title = new EditText(this);
        title.setHint(R.string.quick_hint);
        title.setMinWidth((int) (280 * d));
        String shared = getIntent().getStringExtra(Intent.EXTRA_TEXT);
        if (shared != null) title.setText(shared.trim());
        root.addView(title);

        LinearLayout remindRow = new LinearLayout(this);
        remindRow.setOrientation(LinearLayout.HORIZONTAL);
        remindButton = new Button(this);
        remindButton.setAllCaps(false);
        remindButton.setOnClickListener(v -> pickDateTime());
        remindRow.addView(remindButton, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        clearButton = new Button(this);
        clearButton.setText("✕");
        clearButton.setContentDescription(getString(R.string.quick_clear_reminder));
        clearButton.setOnClickListener(v -> { remindAt = null; refreshRemind(); });
        remindRow.addView(clearButton, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        root.addView(remindRow);
        refreshRemind();

        Button add = new Button(this);
        add.setText(R.string.quick_add);
        add.setOnClickListener(v -> {
            String text = title.getText().toString().trim();
            if (text.isEmpty()) return;
            add.setEnabled(false);
            send(text, add);
        });
        root.addView(add);

        setContentView(root);
        title.requestFocus();
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE);
    }

    private void refreshRemind() {
        remindButton.setText(remindAt == null ? getString(R.string.quick_set_reminder) : "🔔 " + SHOWN.format(remindAt));
        clearButton.setVisibility(remindAt == null ? android.view.View.GONE : android.view.View.VISIBLE);
    }

    /** Eerst de datum, dan de tijd. Standaard: morgen 09:00 (of de eerder gekozen waarde). */
    private void pickDateTime() {
        LocalDateTime start = remindAt != null ? remindAt : LocalDateTime.now().plusDays(1).withHour(9).withMinute(0);
        new DatePickerDialog(this, (dv, y, m, day) ->
                new TimePickerDialog(this, (tv, h, min) -> {
                    remindAt = LocalDateTime.of(y, m + 1, day, h, min);
                    refreshRemind();
                }, start.getHour(), start.getMinute(), true).show(),
                start.getYear(), start.getMonthValue() - 1, start.getDayOfMonth()).show();
    }

    private void send(String text, Button button) {
        final LocalDateTime when = remindAt;
        new Thread(() -> {
            String msg;
            boolean added = false;
            try {
                JSONObject body = new JSONObject().put("title", text);
                if (when != null) body.put("remind_at", when.atZone(ZoneId.systemDefault()).toInstant().toString());
                Api.call(this, "POST", "/api/tasks", body.toString());
                msg = getString(R.string.quick_added);
                added = true;
                Sync.refresh(this);
            } catch (Exception e) {
                msg = getString(R.string.failed, e.getMessage());
            }
            final String shown = msg;
            final boolean ok = added;
            runOnUiThread(() -> {
                Toast.makeText(this, shown, Toast.LENGTH_SHORT).show();
                if (ok) finishAndRemoveTask();
                else button.setEnabled(true);
            });
        }).start();
    }
}
