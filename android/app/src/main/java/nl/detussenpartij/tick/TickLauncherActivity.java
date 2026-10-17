package nl.detussenpartij.tick;

import android.net.Uri;
import android.os.Bundle;

import com.google.androidbrowserhelper.trusted.LauncherActivity;

/**
 * Het app-icoon: opent de PWA schermvullend als Trusted Web Activity (Android Browser Helper).
 * Zonder API-sleutel krijgt de start-URL pair=1, zodat de PWA de app koppelt.
 */
public class TickLauncherActivity extends LauncherActivity {
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        // Het icoon is de gewone ingang (MainActivity zie je alleen via de instellingen): hier ook alles klaarzetten.
        MainActivity.setUp(this);
    }

    @Override
    protected Uri getLaunchingUrl() {
        boolean needsPair = Prefs.token(this).isEmpty();
        if (getIntent() == null || getIntent().getData() == null) {
            return Uri.parse(StartUrl.launch(Api.BASE, needsPair));
        }
        // Adres uit het intent (Launch.task). Browser Helper 2.7.4 gebruikt een https-adres met dezelfde oorsprong als
        // DEFAULT_URL (dus alles op Api.BASE); een ander https-adres vervangt hij door DEFAULT_URL (in een debug-build
        // gooit hij dan een SecurityException), en een ander schema (zoals http) zonder protocol-handler ook.
        Uri url = super.getLaunchingUrl();
        if (needsPair && url.getQueryParameter("pair") == null) {
            url = url.buildUpon().appendQueryParameter("pair", "1").build();
        }
        return url;
    }
}
