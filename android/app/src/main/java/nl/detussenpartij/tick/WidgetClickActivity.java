package nl.detussenpartij.tick;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

/**
 * Onzichtbare tussenstap voor klikken in de widgetlijst: afvinken (bolletje, geen actie), ongedaan maken (knop in een
 * net afgevinkte rij), de taak in de app (TWA) openen (titel), of niets (titel van een net afgevinkte rij).
 */
public class WidgetClickActivity extends Activity {
    static final String EXTRA_ACTION = "action";
    static final String ACTION_OPEN = "open";
    static final String ACTION_UNDO = "undo";
    static final String ACTION_NONE = "none";

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
            } else if (ACTION_UNDO.equals(action)) {
                sendBroadcast(new Intent(this, ActionReceiver.class)
                        .setAction(ActionReceiver.ACTION_UNDO)
                        .putExtra(ActionReceiver.EXTRA_ID, id)
                        .putExtra(ActionReceiver.EXTRA_TICKED_AT, in.getLongExtra(ActionReceiver.EXTRA_TICKED_AT, 0)));
            } else if (!ACTION_NONE.equals(action)) {
                // Het bolletje: afvinken. Een tweede tik op een net afgevinkte taak negeert de ontvanger.
                sendBroadcast(new Intent(this, ActionReceiver.class)
                        .setAction(ActionReceiver.ACTION_DONE)
                        .putExtra(ActionReceiver.EXTRA_ID, id));
            }
        }
        finishAndRemoveTask();
    }
}
