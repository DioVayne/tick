package nl.detussenpartij.tick;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.text.InputType;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/**
 * Het adres van je Tick: bij de eerste start van de algemene app (nog geen adres), en via "Adres wijzigen" in
 * "Tick op deze telefoon". Controleert met /api/hello dat er echt een Tick zit en opent hem daarna.
 */
public class SetupActivity extends Activity {
    private EditText address;
    private Button next;
    private TextView status;

    /**
     * Neemt een ander adres in gebruik. Bij een andere Tick vergeet de app eerst sleutel, gebruiker en hun gegevens:
     * die horen bij de vorige server. Blokkeert kort (geofences weghalen): bij voorkeur niet op de hoofdthread.
     */
    static void useAddress(Context c, String base) {
        if (TickAddress.sameOrigin(Prefs.base(c), base)) return;
        if (!Prefs.base(c).isEmpty()) Api.forgetAccount(c);
        Prefs.setBase(c, base);
        Prefs.setDeviceStatus(c, "", 0);
        Prefs.setSyncError(c, null);
        TaskWidgetProvider.updateAll(c);
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        float d = getResources().getDisplayMetrics().density;
        int pad = (int) (20 * d);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, pad);

        TextView title = new TextView(this);
        title.setText(R.string.setup_title);
        title.setTextSize(26);
        root.addView(title);
        setTitle(R.string.setup_title);

        TextView help = new TextView(this);
        help.setText(R.string.setup_help);
        help.setPadding(0, (int) (8 * d), 0, (int) (12 * d));
        root.addView(help);

        address = new EditText(this);
        address.setHint(R.string.setup_hint);
        address.setSingleLine(true);
        address.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        address.setImeOptions(EditorInfo.IME_ACTION_GO);
        address.setText(Prefs.base(this));
        address.setOnEditorActionListener((v, action, e) -> {
            if (action != EditorInfo.IME_ACTION_GO) return false;
            check();
            return true;
        });
        root.addView(address);

        next = new Button(this);
        next.setText(R.string.setup_next);
        next.setOnClickListener(v -> check());
        root.addView(next);

        status = new TextView(this);
        status.setPadding(0, (int) (12 * d), 0, 0);
        root.addView(status);

        TextView other = new TextView(this);
        other.setText(R.string.setup_other_way);
        other.setPadding(0, (int) (16 * d), 0, 0);
        root.addView(other);

        ScrollView scroll = new ScrollView(this);
        scroll.addView(root);
        scroll.setFitsSystemWindows(true); // edge-to-edge vanaf targetSdk 35
        setContentView(scroll);
    }

    private void check() {
        String base = TickAddress.normalize(address.getText().toString());
        if (base == null) {
            status.setText(R.string.setup_invalid);
            return;
        }
        next.setEnabled(false);
        status.setText(R.string.setup_checking);
        final Context app = getApplicationContext();
        new Thread(() -> {
            String error;
            try {
                error = Api.isTick(base) ? null : app.getString(R.string.setup_not_tick, TickAddress.host(base));
                if (error == null) useAddress(app, base);
            } catch (Exception e) {
                error = app.getString(R.string.setup_unreachable, TickAddress.host(base));
            }
            final String shown = error;
            runOnUiThread(() -> {
                if (isFinishing() || isDestroyed()) return;
                next.setEnabled(true);
                if (shown != null) {
                    status.setText(shown);
                    return;
                }
                // Opent Tick; zonder sleutel met pair=1, dus na het inloggen koppelt de app zichzelf.
                startActivity(new Intent(this, TickLauncherActivity.class));
                finish();
            });
        }).start();
    }
}
