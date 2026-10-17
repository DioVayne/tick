package nl.detussenpartij.tick;

import static org.junit.Assert.assertEquals;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class NotifyDecisionTest {
    private static JSONObject plek(double lat, double lng, int radius, String trigger) throws Exception {
        return new JSONObject().put("name", "Test").put("lat", lat).put("lng", lng).put("radius", radius).put("trigger", trigger);
    }

    private static JSONObject taak(String id, Object location, boolean notified, boolean done) throws Exception {
        return new JSONObject().put("id", id).put("title", "Taak " + id).put("done", done)
                .put("location", location).put("location_notified", notified);
    }

    private static final JSONObject AANKOMST;
    private static final String KEY;

    static {
        try {
            AANKOMST = plek(51.6415, 6.0462, 500, "enter");
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
        KEY = GeoPlan.key(AANKOMST);
    }

    private static NotifyDecision.Result beslis(JSONArray tasks, String fenceKey, boolean exit, JSONObject fired, JSONObject pending) {
        return NotifyDecision.decide(tasks, "a", fenceKey, exit, fired, pending);
    }

    private static NotifyDecision.Result beslis(JSONArray tasks) {
        return beslis(tasks, KEY, false, new JSONObject(), new JSONObject());
    }

    @Test
    public void geldigeAankomstGeeftMelding() throws Exception {
        assertEquals(NotifyDecision.Result.MELDEN, beslis(new JSONArray().put(taak("a", AANKOMST, false, false))));
    }

    @Test
    public void geldigVertrekGeeftMelding() throws Exception {
        JSONObject vertrek = plek(51.6415, 6.0462, 500, "exit");
        JSONArray tasks = new JSONArray().put(taak("a", vertrek, false, false));
        assertEquals(NotifyDecision.Result.MELDEN, beslis(tasks, GeoPlan.key(vertrek), true, new JSONObject(), new JSONObject()));
    }

    @Test
    public void taakOntbreekt() throws Exception {
        // Afgerond of verwijderd: GET /api/tasks geeft alleen open taken terug.
        JSONArray tasks = new JSONArray().put(taak("b", AANKOMST, false, false));
        assertEquals(NotifyDecision.Result.GEEN_TAAK, beslis(tasks));
    }

    @Test
    public void taakIsAf() throws Exception {
        assertEquals(NotifyDecision.Result.AF, beslis(new JSONArray().put(taak("a", AANKOMST, false, true))));
    }

    @Test
    public void netAfgevinktInDeWidget() throws Exception {
        JSONArray tasks = new JSONArray().put(taak("a", AANKOMST, false, false));
        assertEquals(NotifyDecision.Result.AF,
                beslis(tasks, KEY, false, new JSONObject(), new JSONObject().put("a", 123L)));
    }

    @Test
    public void alGemeldOpDeServer() throws Exception {
        assertEquals(NotifyDecision.Result.AL_GEMELD, beslis(new JSONArray().put(taak("a", AANKOMST, true, false))));
    }

    @Test
    public void geenPlekMeer() throws Exception {
        assertEquals(NotifyDecision.Result.ANDERE_PLEK, beslis(new JSONArray().put(taak("a", JSONObject.NULL, false, false))));
    }

    @Test
    public void plekIntussenGewijzigd() throws Exception {
        // De geofence hoort bij de oude plek; de taak heeft nu een andere straal.
        JSONArray tasks = new JSONArray().put(taak("a", plek(51.6415, 6.0462, 800, "enter"), false, false));
        assertEquals(NotifyDecision.Result.ANDERE_PLEK, beslis(tasks));
    }

    @Test
    public void onbekendeFenceKeyVertrouwtDeTaak() throws Exception {
        // Geofence van een oudere versie van de app (request-id zonder plek): alleen de taak telt.
        JSONArray tasks = new JSONArray().put(taak("a", AANKOMST, false, false));
        assertEquals(NotifyDecision.Result.MELDEN, beslis(tasks, null, false, new JSONObject(), new JSONObject()));
    }

    @Test
    public void alAfgegaanMetDezelfdePlek() throws Exception {
        JSONArray tasks = new JSONArray().put(taak("a", AANKOMST, false, false));
        assertEquals(NotifyDecision.Result.AL_AFGEGAAN,
                beslis(tasks, KEY, false, new JSONObject().put("a", KEY), new JSONObject()));
        // Eerder afgegaan op een andere plek: deze mag wel.
        assertEquals(NotifyDecision.Result.MELDEN,
                beslis(tasks, KEY, false, new JSONObject().put("a", "oude-key"), new JSONObject()));
    }

    @Test
    public void richtingPastNietBijTrigger() throws Exception {
        JSONArray aankomst = new JSONArray().put(taak("a", AANKOMST, false, false));
        assertEquals(NotifyDecision.Result.ANDERE_RICHTING,
                beslis(aankomst, KEY, true, new JSONObject(), new JSONObject()));

        JSONObject vertrek = plek(51.6415, 6.0462, 500, "exit");
        JSONArray tasks = new JSONArray().put(taak("a", vertrek, false, false));
        assertEquals(NotifyDecision.Result.ANDERE_RICHTING,
                beslis(tasks, GeoPlan.key(vertrek), false, new JSONObject(), new JSONObject()));
    }
}
