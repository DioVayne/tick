package nl.detussenpartij.tick;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

/** Onzichtbare tussenstap voor klikken in de widgetlijst: afvinken, ongedaan maken of de taak in de app (TWA) openen. */
public class WidgetClickActivity extends Activity {
    static final String EXTRA_ACTION = "action";
    static final String ACTION_OPEN = "open";
    static final String ACTION_UNDO = "undo";

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Intent in = getIntent();
        String id = in.getStringExtra(ActionReceiver.EXTRA_ID);
        if (id != null && !id.isEmpty()) {
            String action = in.getStringExtra(EXTRA_ACTION);
            if (ACTION_OPEN.equals(action)) {
                // In de app (TWA), in een eigen taak: deze tussenstap wordt hieronder met zijn taak verwijderd.
                Launch.task(this, id);
            } else {
                // Het bolletje (geen actie) en een tik op een net afgevinkte taak gaan beide naar de ontvanger,
                // die zelf bepaalt of het afvinken of ongedaan maken is.
                sendBroadcast(new Intent(this, ActionReceiver.class)
                        .setAction(ActionReceiver.ACTION_DONE)
                        .putExtra(ActionReceiver.EXTRA_ID, id));
            }
        }
        finishAndRemoveTask();
    }
}
