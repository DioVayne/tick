package nl.detussenpartij.tick;

import android.app.Activity;
import android.net.Uri;
import android.os.Bundle;

/**
 * Onzichtbaar doel van tick://sync?task=...&since=..., de link die de PWA opent na een nieuwe of gewiste plek.
 * Plant direct een refresh en sluit meteen; de browser blijft staan.
 */
public class SyncActivity extends Activity {
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Uri data = getIntent().getData();
        String task = data == null ? null : data.getQueryParameter("task");
        String since = data == null ? null : data.getQueryParameter("since");
        if (task == null || task.isEmpty()) SyncJob.syncSoon(this, null, null, 0);
        else SyncJob.syncSoon(this, task, since, 0);
        finishAndRemoveTask();
    }
}
