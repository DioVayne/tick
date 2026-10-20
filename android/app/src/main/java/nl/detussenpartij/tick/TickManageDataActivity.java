package nl.detussenpartij.tick;

import android.net.Uri;

import com.google.androidbrowserhelper.trusted.ManageDataLauncherActivity;

/**
 * "Site-instellingen" (de snelkoppeling die Browser Helper zet): opent de instellingen van de site op het adres van
 * deze telefoon, in plaats van een vast adres uit het manifest. Browser Helper start ManageDataLauncherActivity bij
 * naam; in het manifest wijst een activity-alias met die naam hierheen.
 */
public class TickManageDataActivity extends ManageDataLauncherActivity {
    @Override
    protected Uri getDefaultUrlForManagingSpace() {
        String base = Prefs.base(this);
        return base.isEmpty() ? null : Uri.parse(base + "/");
    }
}
