package nl.detussenpartij.tick;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;

/** Opent Tick (de PWA in de app) op een bepaalde plek. */
final class Launch {
    private Launch() {}

    /**
     * Opent een taak in de TWA. Het adres ligt op Prefs.base, dus TickLauncherActivity neemt het over
     * (StartUrl.fromIntent). Zonder sleutel komt er pair=1 bij; zonder adres vraagt TickLauncherActivity er eerst om.
     */
    static void task(Context c, String taskId) {
        c.startActivity(new Intent(c, TickLauncherActivity.class)
                .setAction(Intent.ACTION_VIEW)
                .setData(Uri.parse(StartUrl.task(Prefs.base(c), taskId, Prefs.token(c).isEmpty())))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    }
}
