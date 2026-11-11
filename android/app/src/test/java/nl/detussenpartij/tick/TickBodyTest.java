package nl.detussenpartij.tick;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;

import org.json.JSONObject;
import org.junit.Test;

public class TickBodyTest {
    @Test
    public void herhalendeTaakStuurtDeGetoondeKeerEnEenActieMee() throws Exception {
        JSONObject task = new JSONObject("{\"id\":\"a\",\"parent_id\":null,\"repeat\":{\"rule\":\"FREQ=WEEKLY\",\"start\":\"2026-11-01T09:00:00.000Z\",\"at\":\"2026-11-15T09:00:00.000Z\"}}");
        JSONObject b = new JSONObject(TickBody.done(task, 1234L));
        assertEquals("2026-11-15T09:00:00.000Z", b.getString("occurrence"));
        assertEquals("android-1234", b.getString("action"));
    }

    @Test
    public void gewoneTaakZonderKeer() throws Exception {
        JSONObject b = new JSONObject(TickBody.done(new JSONObject("{\"id\":\"a\",\"repeat\":null}"), 5L));
        assertFalse(b.has("occurrence"));
        assertEquals("android-5", b.getString("action"));
        assertFalse(new JSONObject(TickBody.done(null, 5L)).has("occurrence"));
    }

    @Test
    public void ongedaanMakenNoemtDezelfdeActie() throws Exception {
        assertEquals("android-1234", new JSONObject(TickBody.reopen(1234L)).getString("undo"));
        assertEquals("{}", TickBody.reopen(0L));
    }
}
