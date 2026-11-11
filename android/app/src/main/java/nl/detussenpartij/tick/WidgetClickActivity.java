package nl.detussenpartij.tick;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

/**
 * Onzichtbare tussenstap voor klikken in de widgetlijst: afvinken (bolletje, geen actie), ongedaan maken (knop in een
 * net afgevinkte rij), de taak in de app (TWA) openen (titel), of niets (titel van een net afgevinkte rij). En de
 * melding bovenaan (WidgetStatus): opnieuw proberen, koppelen of een taak toevoegen. Die staat in de lijst, dus gaat
 * zijn tik ook via het sjabloon van de lijst en deze tussenstap.
 */
public class WidgetClickActivity extends Activity {
    static final String EXTRA_ACTION = "action";
    static final String ACTION_OPEN = "open";
    static final String ACTION_UNDO = "undo";
    static final String ACTION_NONE = "none";
    static final String ACTION_RETRY = "retry";
    static final String ACTION_PAIR = "pair";
    static final String ACTION_ADD = "add";

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Intent in = getIntent();
        String action = in.getStringExtra(EXTRA_ACTION);
        String id = in.getStringExtra(ActionReceiver.EXTRA_ID);
        if (ACTION_RETRY.equals(action)) {
            // Zelfde als de knop Verversen: eerst de wachtrij (ook wat nog even zou wachten), dan de lijst.
            sendBroadcast(TaskWidgetProvider.manualRefresh(this));
        } else if (ACTION_PAIR.equals(action)) {
            // De app opent de PWA met pair=1 (zonder adres eerst SetupActivity); die koppelt de telefoon.
            startActivity(new Intent(this, TickLauncherActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } else if (ACTION_ADD.equals(action)) {
            String view = in.getStringExtra(QuickAddActivity.EXTRA_VIEW);
            startActivity(new Intent(this, QuickAddActivity.class)
                    .putExtra(QuickAddActivity.EXTRA_VIEW, view == null ? "" : view)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } else if (id != null && !id.isEmpty()) {
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
