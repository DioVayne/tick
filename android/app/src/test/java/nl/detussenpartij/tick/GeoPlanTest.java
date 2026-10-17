package nl.detussenpartij.tick;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.util.Collections;
import java.util.List;

public class GeoPlanTest {
    private static JSONObject plek(double lat, double lng, int radius, String trigger) throws Exception {
        return new JSONObject().put("name", "Test").put("lat", lat).put("lng", lng).put("radius", radius).put("trigger", trigger);
    }

    private static JSONObject taak(String id, Object location, boolean notified, boolean done) throws Exception {
        return new JSONObject().put("id", id).put("title", "Taak " + id).put("done", done)
                .put("location", location).put("location_notified", notified);
    }

    @Test
    public void selecteertAlleenActieveLocaties() throws Exception {
        JSONArray tasks = new JSONArray()
                .put(taak("geen", JSONObject.NULL, false, false))
                .put(taak("gemeld", plek(51.0, 6.0, 300, "enter"), true, false))
                .put(taak("klaar", plek(51.0, 6.0, 300, "enter"), false, true))
                .put(taak("goed", plek(51.6415, 6.0462, 500, "enter"), false, false));

        List<GeoPlan.Fence> fences = GeoPlan.select(tasks, new JSONObject(), GeoPlan.MAX);

        assertEquals(1, fences.size());
        GeoPlan.Fence f = fences.get(0);
        assertEquals("goed", f.id);
        assertEquals("Taak goed", f.title);
        assertEquals("Test", f.name);
        assertEquals(51.6415, f.lat, 1e-9);
        assertEquals(6.0462, f.lng, 1e-9);
        assertEquals(500f, f.radius, 1e-6);
        assertFalse(f.exit);
    }

    @Test
    public void exitTrigger() throws Exception {
        JSONArray tasks = new JSONArray().put(taak("a", plek(51.0, 6.0, 200, "exit"), false, false));
        assertTrue(GeoPlan.select(tasks, new JSONObject(), GeoPlan.MAX).get(0).exit);
    }

    @Test
    public void slaatAlAfgeganeOver() throws Exception {
        JSONObject loc = plek(51.0, 6.0, 200, "enter");
        JSONArray tasks = new JSONArray().put(taak("a", loc, false, false));

        assertEquals(0, GeoPlan.select(tasks, new JSONObject().put("a", GeoPlan.key(loc)), GeoPlan.MAX).size());
        // De plek is daarna gewijzigd: dan telt hij weer mee.
        assertEquals(1, GeoPlan.select(tasks, new JSONObject().put("a", "andere-key"), GeoPlan.MAX).size());
    }

    @Test
    public void maximaal100InLijstvolgorde() throws Exception {
        JSONArray tasks = new JSONArray();
        for (int i = 0; i < 150; i++) tasks.put(taak("t" + i, plek(51.0, 6.0, 200, "enter"), false, false));

        List<GeoPlan.Fence> fences = GeoPlan.select(tasks, new JSONObject(), GeoPlan.MAX);

        assertEquals(100, fences.size());
        assertEquals("t0", fences.get(0).id);
        assertEquals("t99", fences.get(99).id);
    }

    @Test
    public void signatureStabielEnGevoelig() throws Exception {
        JSONArray a = new JSONArray().put(taak("a", plek(51.0, 6.0, 200, "enter"), false, false))
                .put(taak("b", plek(52.0, 5.0, 300, "exit"), false, false));
        JSONArray b = new JSONArray().put(taak("a", plek(51.0, 6.0, 250, "enter"), false, false))
                .put(taak("b", plek(52.0, 5.0, 300, "exit"), false, false));

        String sig = GeoPlan.signature(GeoPlan.select(a, new JSONObject(), GeoPlan.MAX));
        assertEquals(sig, GeoPlan.signature(GeoPlan.select(a, new JSONObject(), GeoPlan.MAX)));
        assertNotEquals(sig, GeoPlan.signature(GeoPlan.select(b, new JSONObject(), GeoPlan.MAX)));
    }

    @Test
    public void signatureOnafhankelijkVanVolgorde() throws Exception {
        JSONObject a = taak("a", plek(51.0, 6.0, 200, "enter"), false, false);
        JSONObject b = taak("b", plek(52.0, 5.0, 300, "exit"), false, false);

        String ab = GeoPlan.signature(GeoPlan.select(new JSONArray().put(a).put(b), new JSONObject(), GeoPlan.MAX));
        String ba = GeoPlan.signature(GeoPlan.select(new JSONArray().put(b).put(a), new JSONObject(), GeoPlan.MAX));
        assertEquals(ab, ba);
    }

    @Test
    public void zonderTriggerIsAankomst() throws Exception {
        JSONObject loc = new JSONObject().put("name", "Test").put("lat", 51.0).put("lng", 6.0).put("radius", 200);
        JSONArray tasks = new JSONArray().put(taak("a", loc, false, false));

        assertFalse(GeoPlan.select(tasks, new JSONObject(), GeoPlan.MAX).get(0).exit);
        assertEquals(GeoPlan.key(plek(51.0, 6.0, 200, "enter")), GeoPlan.key(loc));
    }

    @Test
    public void requestIdBevatTaakEnPlek() throws Exception {
        JSONObject loc = plek(51.0, 6.0, 200, "exit");
        GeoPlan.Fence f = GeoPlan.select(new JSONArray().put(taak("a#1", loc, false, false)), new JSONObject(), GeoPlan.MAX).get(0);

        String rid = GeoPlan.requestId(f);
        assertEquals("a#1", GeoPlan.taskId(rid));
        assertEquals(GeoPlan.key(loc), GeoPlan.fenceKey(rid));
        // Geofence van een oudere versie: alleen het taak-id, plek onbekend.
        assertEquals("abc", GeoPlan.taskId("abc"));
        assertNull(GeoPlan.fenceKey("abc"));
    }

    @Test
    public void signatureZonderAfgegane() throws Exception {
        JSONObject a = taak("a", plek(51.0, 6.0, 200, "enter"), false, false);
        JSONObject b = taak("b", plek(52.0, 5.0, 300, "exit"), false, false);
        JSONObject c = taak("c", plek(53.0, 4.0, 400, "enter"), false, false);
        String alle = GeoPlan.signature(GeoPlan.select(new JSONArray().put(a).put(b).put(c), new JSONObject(), GeoPlan.MAX));
        String zonderB = GeoPlan.signature(GeoPlan.select(new JSONArray().put(a).put(c), new JSONObject(), GeoPlan.MAX));

        // Na een melding voor b: gelijk aan wat de volgende refresh berekent, dus geen nieuwe registratie.
        assertEquals(zonderB, GeoPlan.signatureWithout(alle, Collections.singleton("b")));
        assertEquals(alle, GeoPlan.signatureWithout(alle, Collections.singleton("x")));
        assertEquals("", GeoPlan.signatureWithout("", Collections.singleton("a")));
    }

    @Test
    public void taakZonderIdWordtOvergeslagen() throws Exception {
        JSONObject zonderId = taak("x", plek(51.0, 6.0, 200, "enter"), false, false);
        zonderId.remove("id");
        JSONArray tasks = new JSONArray().put(zonderId).put(taak("b", plek(51.0, 6.0, 200, "enter"), false, false));

        List<GeoPlan.Fence> fences = GeoPlan.select(tasks, new JSONObject(), GeoPlan.MAX);
        assertEquals(1, fences.size());
        assertEquals("b", fences.get(0).id);
    }
}
