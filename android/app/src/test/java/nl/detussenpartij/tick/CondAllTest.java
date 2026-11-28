package nl.detussenpartij.tick;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.time.Instant;
import java.util.Collections;
import java.util.List;

/** Testfeature condall: "Pas als alles klopt" bij tijd + plek (CondAll, en de condall-regels in GeoPlan en NotifyDecision). */
public class CondAllTest {
    private static final long NOW = Instant.parse("2026-11-28T16:00:00Z").toEpochMilli();
    private static final String LATER = "2026-11-28T17:00:00.000Z";
    private static final String EARLIER = "2026-11-28T15:00:00.000Z";

    private static JSONObject plek(String trigger) throws Exception {
        return new JSONObject().put("name", "AH").put("lat", 52.09).put("lng", 5.12).put("radius", 500).put("trigger", trigger);
    }

    private static JSONObject taak(String id, String remindAt, String conditions, String trigger) throws Exception {
        JSONObject t = new JSONObject().put("id", id).put("title", "Taak " + id).put("done", false)
                .put("location", plek(trigger)).put("location_notified", false).put("remind_at", remindAt == null ? JSONObject.NULL : remindAt);
        if (conditions != null) t.put("conditions", conditions);
        return t;
    }

    private static List<GeoPlan.Fence> fences(JSONArray tasks) {
        return GeoPlan.plan(tasks, new JSONObject(), GeoPlan.MAX, Collections.emptyMap(), "", NOW).fences;
    }

    @Test
    public void poortVoorEnNaDeTijd() throws Exception {
        assertTrue(CondAll.waiting(taak("a", LATER, "all", "enter"), NOW));
        assertFalse(CondAll.open(taak("a", LATER, "all", "enter"), NOW));
        assertTrue(CondAll.open(taak("a", EARLIER, "all", "enter"), NOW));
        assertFalse(CondAll.waiting(taak("a", LATER, null, "enter"), NOW)); // "Elke apart": zoals altijd
        assertFalse(CondAll.waiting(taak("a", null, "all", "enter"), NOW));
        assertFalse(CondAll.waiting(taak("a", "onzin", "all", "enter"), NOW));
    }

    @Test
    public void geenGeofenceVoorDeTijd() throws Exception {
        JSONArray tasks = new JSONArray().put(taak("a", LATER, "all", "enter")).put(taak("b", LATER, null, "enter"));
        List<GeoPlan.Fence> f = fences(tasks);
        assertEquals(1, f.size());
        assertEquals("b", f.get(0).id);
        assertFalse(f.get(0).initial);
    }

    @Test
    public void naDeTijdAankomstMetInitialTrigger() throws Exception {
        List<GeoPlan.Fence> f = fences(new JSONArray().put(taak("a", EARLIER, "all", "enter")));
        assertEquals(1, f.size());
        assertTrue(f.get(0).initial);
        GeoPlan.Diff d = GeoPlan.diff(Collections.emptySet(), f);
        assertEquals(1, d.addArrived.size());
        assertEquals(0, d.add.size());
    }

    @Test
    public void naDeTijdVertrekZonderInitialTrigger() throws Exception {
        List<GeoPlan.Fence> f = fences(new JSONArray().put(taak("a", EARLIER, "all", "exit")));
        assertEquals(1, f.size());
        assertFalse(f.get(0).initial); // alleen een echt vertrek na de tijd telt
        GeoPlan.Diff d = GeoPlan.diff(Collections.emptySet(), f);
        assertEquals(1, d.add.size());
    }

    @Test
    public void meldingVoorDeTijdIsTeVroeg() throws Exception {
        JSONObject t = taak("a", LATER, "all", "enter");
        JSONArray tasks = new JSONArray().put(t);
        String key = GeoPlan.key(t.getJSONObject("location"));
        assertEquals(NotifyDecision.Result.TE_VROEG, NotifyDecision.decide(tasks, "a", key, false, new JSONObject(), new JSONObject(), NOW));
        long after = Instant.parse(LATER).toEpochMilli() + 60_000;
        assertEquals(NotifyDecision.Result.MELDEN, NotifyDecision.decide(tasks, "a", key, false, new JSONObject(), new JSONObject(), after));
    }

    @Test
    public void eerstvolgendePoort() throws Exception {
        JSONArray tasks = new JSONArray()
                .put(taak("a", "2026-11-28T18:00:00.000Z", "all", "enter"))
                .put(taak("b", LATER, "all", "exit"))
                .put(taak("c", "2026-11-28T16:30:00.000Z", null, "enter")) // geen "alles": geen poort
                .put(taak("d", EARLIER, "all", "enter")); // al voorbij
        assertEquals(Instant.parse(LATER).toEpochMilli(), CondAll.next(tasks, NOW));
        assertEquals(-1, CondAll.next(new JSONArray().put(taak("c", LATER, null, "enter")), NOW));
    }

    // ---------- plek + trigger (1.15.8): "trigger_at" in de taak ----------

    private static JSONObject metTrigger(String id, String remindAt, String triggerAt, String trigger) throws Exception {
        return taak(id, remindAt, "all", trigger).put("trigger_at", triggerAt == null ? JSONObject.NULL : triggerAt);
    }

    @Test
    public void triggerNogNietAfgegaanHoudtDePoortDicht() throws Exception {
        JSONObject t = metTrigger("a", EARLIER, null, "enter"); // tijd voorbij, trigger nog niet
        assertTrue(CondAll.withTrigger(t));
        assertTrue(CondAll.waiting(t, NOW));
        assertFalse(CondAll.open(t, NOW));
        assertEquals(0, fences(new JSONArray().put(t)).size());
        // Geen wekker op "nooit": de sync brengt de trigger.
        assertEquals(-1, CondAll.next(new JSONArray().put(t), NOW));
        String key = GeoPlan.key(t.getJSONObject("location"));
        assertEquals(NotifyDecision.Result.TE_VROEG, NotifyDecision.decide(new JSONArray().put(t), "a", key, false, new JSONObject(), new JSONObject(), NOW));
    }

    @Test
    public void tijdEnTriggerVoorbijAankomstMetInitialTrigger() throws Exception {
        JSONObject t = metTrigger("a", EARLIER, "2026-11-28T15:30:00.000Z", "enter");
        assertTrue(CondAll.open(t, NOW));
        List<GeoPlan.Fence> f = fences(new JSONArray().put(t));
        assertEquals(1, f.size());
        assertTrue(f.get(0).initial); // al op de plek telt ook
        String key = GeoPlan.key(t.getJSONObject("location"));
        assertEquals(NotifyDecision.Result.MELDEN, NotifyDecision.decide(new JSONArray().put(t), "a", key, false, new JSONObject(), new JSONObject(), NOW));
    }

    @Test
    public void vertrekAlleenNaTijdEnTrigger() throws Exception {
        JSONObject t = metTrigger("a", EARLIER, "2026-11-28T15:30:00.000Z", "exit");
        List<GeoPlan.Fence> f = fences(new JSONArray().put(t));
        assertEquals(1, f.size());
        assertFalse(f.get(0).initial); // alleen een echt vertrek daarna
    }

    @Test
    public void triggerAfgegaanMaarTijdNogNiet() throws Exception {
        JSONObject t = metTrigger("a", LATER, "2026-11-28T15:30:00.000Z", "enter");
        assertTrue(CondAll.waiting(t, NOW));
        assertEquals(0, fences(new JSONArray().put(t)).size());
        // De wekker op de tijd zet de geofence daarna.
        assertEquals(Instant.parse(LATER).toEpochMilli(), CondAll.next(new JSONArray().put(t), NOW));
    }

    @Test
    public void plekEnTriggerZonderTijd() throws Exception {
        JSONObject wacht = metTrigger("a", null, null, "enter");
        assertTrue(CondAll.waiting(wacht, NOW));
        JSONObject klaar = metTrigger("b", null, EARLIER, "enter");
        assertEquals(Instant.parse(EARLIER).toEpochMilli(), CondAll.gate(klaar));
        assertTrue(CondAll.open(klaar, NOW));
        List<GeoPlan.Fence> f = fences(new JSONArray().put(wacht).put(klaar));
        assertEquals(1, f.size());
        assertEquals("b", f.get(0).id);
        assertTrue(f.get(0).initial);
    }

    @Test
    public void zonderTriggerVeldZoalsVoorheen() throws Exception {
        JSONObject t = taak("a", EARLIER, "all", "enter");
        assertFalse(CondAll.withTrigger(t));
        assertEquals(Instant.parse(EARLIER).toEpochMilli(), CondAll.gate(t));
        JSONObject kapot = metTrigger("b", EARLIER, "onzin", "enter");
        assertTrue(CondAll.waiting(kapot, NOW)); // onleesbare trigger: niet melden
    }
}
