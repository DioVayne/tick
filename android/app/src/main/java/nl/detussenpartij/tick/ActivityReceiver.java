package nl.detussenpartij.tick;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;

import com.google.android.gms.location.ActivityTransition;
import com.google.android.gms.location.ActivityTransitionEvent;
import com.google.android.gms.location.ActivityTransitionResult;

import java.util.ArrayList;
import java.util.List;

/** Android meldt begin of einde van rijden of fietsen: cirkels groter of weer normaal (Road). */
public class ActivityReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!ActivityTransitionResult.hasResult(intent)) return;
        ActivityTransitionResult result = ActivityTransitionResult.extractResult(intent);
        if (result == null) return;
        final Context app = context.getApplicationContext();
        if (!Road.on(app)) return;
        final List<ActivityTransitionEvent> events = new ArrayList<>(result.getTransitionEvents());
        if (events.isEmpty()) return;

        // Op de achtergrond: bij het begin wacht Road.enter op een verse locatie.
        final PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                long now = System.currentTimeMillis();
                long nowNanos = SystemClock.elapsedRealtimeNanos();
                for (ActivityTransitionEvent e : events) {
                    String mode = RoadPlan.modeFor(e.getActivityType());
                    if (mode.isEmpty()) continue;
                    long startedAt = now - (nowNanos - e.getElapsedRealTimeNanos()) / 1_000_000;
                    if (e.getTransitionType() == ActivityTransition.ACTIVITY_TRANSITION_ENTER) {
                        // Een stand die al langer dan de bovengrens loopt (bijv. opnieuw afgeleverd na abonneren) niet.
                        if (RoadPlan.isActive(mode, startedAt, now)) Road.enter(app, mode, startedAt);
                    } else {
                        Road.exit(app, mode);
                    }
                }
            } finally {
                pending.finish();
            }
        }).start();
    }
}
