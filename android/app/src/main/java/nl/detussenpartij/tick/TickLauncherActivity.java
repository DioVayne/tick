package nl.detussenpartij.tick;

import android.net.Uri;

import com.google.androidbrowserhelper.trusted.LauncherActivity;

/**
 * Het app-icoon: opent de PWA schermvullend als Trusted Web Activity (Android Browser Helper).
 * Zonder API-sleutel krijgt de start-URL pair=1, zodat de PWA de app koppelt.
 */
public class TickLauncherActivity extends LauncherActivity {
    @Override
    protected Uri getLaunchingUrl() {
        boolean needsPair = Prefs.token(this).isEmpty();
        if (getIntent() == null || getIntent().getData() == null) {
            return Uri.parse(StartUrl.launch(Api.BASE, needsPair));
        }
        // Adres uit het intent (taak openen e.d.); de bibliotheek valt terug op DEFAULT_URL als het niet vertrouwd is.
        Uri url = super.getLaunchingUrl();
        if (needsPair && url.getQueryParameter("pair") == null) {
            url = url.buildUpon().appendQueryParameter("pair", "1").build();
        }
        return url;
    }
}
