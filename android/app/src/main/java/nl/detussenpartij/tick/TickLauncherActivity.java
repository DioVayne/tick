package nl.detussenpartij.tick;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

import com.google.androidbrowserhelper.trusted.LauncherActivity;

/**
 * Het app-icoon: opent de PWA schermvullend als Trusted Web Activity (Android Browser Helper), op het adres van deze
 * telefoon (Prefs.base). Zonder adres eerst SetupActivity; zonder API-sleutel krijgt de start-URL pair=1, zodat de PWA
 * de app koppelt. Chrome controleert de oorsprong van dat adres via /.well-known/assetlinks.json; klopt die niet, dan
 * opent Tick met een adresbalk.
 */
public class TickLauncherActivity extends LauncherActivity {
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        // Het icoon is de gewone ingang (MainActivity zie je alleen via de instellingen): hier ook alles klaarzetten.
        MainActivity.setUp(this);
        if (Prefs.base(this).isEmpty()) {
            startActivity(new Intent(this, SetupActivity.class));
            finish();
        }
    }

    @Override
    protected boolean shouldLaunchImmediately() {
        return !Prefs.base(this).isEmpty();
    }

    /**
     * Het adres uit het intent (Launch.task, of een link naar je Tick) als het op Prefs.base ligt, anders de gewone
     * start. Helemaal zelf: de standaard van Browser Helper vergelijkt met DEFAULT_URL, en die ligt niet vast.
     */
    @Override
    protected Uri getLaunchingUrl() {
        boolean needsPair = Prefs.token(this).isEmpty();
        String data = getIntent() == null ? null : getIntent().getDataString();
        return Uri.parse(StartUrl.fromIntent(Prefs.base(this), data, needsPair));
    }
}
