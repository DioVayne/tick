package nl.detussenpartij.tick;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class RearmDecisionTest {
    private static JSONObject plek(int radius) throws Exception {
        return new JSONObject().put("name", "Test").put("lat", 51.6415).put("lng", 6.0462).put("radius", radius).put("trigger", "enter");
    }

    private static JSONObject taak(String id, Object location, boolean notified, boolean done) throws Exception {
        return new JSONObject().put("id", id).put("title", "Taak " + id).put("done", done)
                .put("location", location).put("location_notified", notified);
    }

    private static RearmDecision.Result beslis(JSONArray tasks, String key, JSONObject pending) {
        return RearmDecision.decide(tasks, "a", key, pending);
    }

    @Test
    public void openTaakZelfdePlekWordtKlaargezet() throws Exception {
        JSONObject loc = plek(500);
        JSONArray tasks = new JSONArray().put(taak("a", loc, true, false));
        assertEquals(RearmDecision.Result.REARM, beslis(tasks, GeoPlan.key(loc), new JSONObject()));
    }

    @Test
    public void afgevinktNiet() throws Exception {
        JSONObject loc = plek(500);
        String key = GeoPlan.key(loc);
        assertEquals(RearmDecision.Result.AF, beslis(new JSONArray().put(taak("a", loc, true, true)), key, new JSONObject()));
        // Net afgevinkt in de widget of de melding, de server weet het nog niet.
        assertEquals(RearmDecision.Result.AF, beslis(new JSONArray().put(taak("a", loc, true, false)), key,
                new JSONObject().put("a", 123L)));
    }

    @Test
    public void wegGeenActie() throws Exception {
        JSONObject loc = plek(500);
        assertEquals(RearmDecision.Result.GEEN_TAAK, beslis(new JSONArray(), GeoPlan.key(loc), new JSONObject()));
    }

    @Test
    public void plekVeranderdNiet() throws Exception {
        JSONObject oud = plek(500);
        JSONArray tasks = new JSONArray().put(taak("a", plek(800), true, false));
        assertEquals(RearmDecision.Result.ANDERE_PLEK, beslis(tasks, GeoPlan.key(oud), new JSONObject()));
        assertEquals(RearmDecision.Result.ANDERE_PLEK,
                beslis(new JSONArray().put(taak("a", JSONObject.NULL, true, false)), GeoPlan.key(oud), new JSONObject()));
    }

    @Test
    public void cacheZetAlleenDieTaakTerug() throws Exception {
        JSONArray tasks = new JSONArray().put(taak("a", plek(500), true, false)).put(taak("b", plek(500), true, false));
        JSONArray out = new JSONArray(RearmDecision.withNotifiedFalse(tasks.toString(), "a"));
        assertFalse(out.getJSONObject(0).getBoolean("location_notified"));
        assertTrue(out.getJSONObject(1).getBoolean("location_notified"));
        assertEquals("onzin", RearmDecision.withNotifiedFalse("onzin", "a"));
    }
}
