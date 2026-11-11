package nl.detussenpartij.tick;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

public class OutboxTest {
    private static final long T = 1_700_000_000_000L;

    private static JSONObject done(String id, long at) {
        return Outbox.op(Outbox.DONE, id, TickBody.done(null, at), at, at, "Taak " + id, null);
    }

    private static JSONObject create(String id, long at) throws Exception {
        JSONObject body = new JSONObject().put("id", id).put("title", "Nieuw " + id);
        return Outbox.op(Outbox.CREATE, id, body.toString(), at, at, "Nieuw " + id, QuickAddPlan.localTask(body, "2026-11-11T10:00:00Z"));
    }

    private static String kinds(JSONArray ops) {
        StringBuilder s = new StringBuilder();
        for (int i = 0; i < ops.length(); i++) {
            JSONObject o = ops.optJSONObject(i);
            if (s.length() > 0) s.append(',');
            s.append(o.optString("op")).append(':').append(o.optString("id"));
        }
        return s.toString();
    }

    private static String ids(JSONArray tasks) {
        StringBuilder s = new StringBuilder();
        for (int i = 0; i < tasks.length(); i++) s.append(tasks.optJSONObject(i).optString("id"));
        return s.toString();
    }

    private static final Set<String> NONE = Collections.emptySet();

    @Test
    public void ongedaanVoorVersturenHaaltHetAfvinkenWeg() {
        JSONArray ops = new JSONArray();
        Outbox.add(ops, done("a", T));
        assertTrue(Outbox.cancelDone(ops, "a", T));
        assertEquals(0, ops.length());
    }

    @Test
    public void ongedaanTerwijlHetOnderwegIsLaatHetStaan() {
        JSONArray ops = new JSONArray();
        JSONObject op = done("a", T);
        Outbox.add(ops, op);
        Outbox.markSending(ops, op.optString("k"), true);
        assertFalse(Outbox.cancelDone(ops, "a", T)); // dan moet er een reopen achteraan
        assertEquals(1, ops.length());
    }

    @Test
    public void ongedaanVanEenAndereTikHaaltNietsWeg() {
        JSONArray ops = new JSONArray();
        Outbox.add(ops, done("a", T));
        assertFalse(Outbox.cancelDone(ops, "a", T + 1));
        assertFalse(Outbox.cancelDone(ops, "b", T));
        assertEquals(1, ops.length());
    }

    @Test
    public void volgendeHoudtDeVolgordePerTaak() throws Exception {
        JSONArray ops = new JSONArray();
        Outbox.add(ops, create("n", T));
        Outbox.add(ops, done("n", T + 1));
        Outbox.add(ops, done("b", T + 2));
        assertEquals(Outbox.CREATE, Outbox.next(ops, T + 5, false, NONE).optString("op"));
        // Het toevoegen mislukte net (serverfout): de afvinktik van dezelfde taak wacht, een andere taak niet.
        Set<String> skip = new HashSet<>();
        skip.add("n");
        assertEquals("b", Outbox.next(ops, T + 5, false, skip).optString("id"));
    }

    @Test
    public void wachttijdSlaatDieTaakOverBehalveMetForce() {
        JSONArray ops = new JSONArray();
        JSONObject a = done("a", T);
        Outbox.add(ops, a);
        Outbox.add(ops, Outbox.op(Outbox.REOPEN, "a", TickBody.reopen(T), T, T, "", null));
        Outbox.settle(ops, a.optString("k"), Outbox.Outcome.RETRY, T);
        assertNull(Outbox.next(ops, T + 1000, false, NONE)); // ook de reopen van a wacht
        assertEquals(Outbox.DONE, Outbox.next(ops, T + 1000, true, NONE).optString("op"));
        assertEquals(Outbox.DONE, Outbox.next(ops, T + Outbox.BACKOFF_MS, false, NONE).optString("op"));
    }

    @Test
    public void uitkomstPerStatus() {
        assertEquals(Outbox.Outcome.SENT, Outbox.outcome(200));
        assertEquals(Outbox.Outcome.SENT, Outbox.outcome(201));
        assertEquals(Outbox.Outcome.OFFLINE, Outbox.outcome(-1));
        assertEquals(Outbox.Outcome.STOP, Outbox.outcome(401));
        assertEquals(Outbox.Outcome.RETRY, Outbox.outcome(500));
        assertEquals(Outbox.Outcome.RETRY, Outbox.outcome(503));
        assertEquals(Outbox.Outcome.RETRY, Outbox.outcome(429));
        assertEquals(Outbox.Outcome.RETRY, Outbox.outcome(408));
        assertEquals(Outbox.Outcome.DROPPED, Outbox.outcome(403)); // niet meer gedeeld
        assertEquals(Outbox.Outcome.DROPPED, Outbox.outcome(404)); // verwijderd
        assertEquals(Outbox.Outcome.DROPPED, Outbox.outcome(409));
        assertEquals(Outbox.Outcome.DROPPED, Outbox.outcome(400));
    }

    @Test
    public void statusUitDeFoutmeldingVanApi() {
        assertEquals(404, Outbox.httpCode("HTTP 404"));
        assertEquals(-1, Outbox.httpCode("Unable to resolve host"));
        assertEquals(-1, Outbox.httpCode(null));
        assertEquals(-1, Outbox.httpCode("HTTP x"));
    }

    @Test
    public void wachttijdLooptOpMetEenGrens() {
        assertEquals(30_000, Outbox.backoff(1, Outbox.Outcome.RETRY));
        assertEquals(60_000, Outbox.backoff(2, Outbox.Outcome.RETRY));
        assertEquals(Outbox.MAX_SERVER_BACKOFF_MS, Outbox.backoff(30, Outbox.Outcome.RETRY));
        assertEquals(Outbox.MAX_OFFLINE_BACKOFF_MS, Outbox.backoff(30, Outbox.Outcome.OFFLINE));
        assertEquals(Outbox.MAX_OFFLINE_BACKOFF_MS, Outbox.backoff(5, Outbox.Outcome.OFFLINE));
    }

    @Test
    public void gelukteGaatWegMisluktePogingTelt() {
        JSONArray ops = new JSONArray();
        JSONObject a = done("a", T);
        Outbox.add(ops, a);
        Outbox.markSending(ops, a.optString("k"), true);
        assertTrue(Outbox.settle(ops, a.optString("k"), Outbox.Outcome.OFFLINE, T).isEmpty());
        JSONObject left = ops.optJSONObject(0);
        assertEquals(1, left.optInt("tries"));
        assertEquals(T + Outbox.BACKOFF_MS, left.optLong("next"));
        assertFalse(left.optBoolean("sending"));
        List<JSONObject> gone = Outbox.settle(ops, a.optString("k"), Outbox.Outcome.SENT, T);
        assertEquals(1, gone.size());
        assertEquals(0, ops.length());
    }

    @Test
    public void afgewezenNeemtDeRestVanDieTaakMee() throws Exception {
        JSONArray ops = new JSONArray();
        JSONObject n = create("n", T);
        Outbox.add(ops, n);
        Outbox.add(ops, done("b", T + 1));
        Outbox.add(ops, done("n", T + 2));
        List<JSONObject> gone = Outbox.settle(ops, n.optString("k"), Outbox.Outcome.DROPPED, T + 3);
        assertEquals(2, gone.size());
        assertEquals(Outbox.CREATE, gone.get(0).optString("op"));
        assertEquals("done:b", kinds(ops));
    }

    @Test
    public void wachtendAlleenAlsHetLangerDuurt() {
        JSONArray ops = new JSONArray();
        assertEquals(0, Outbox.waiting(ops, T));
        Outbox.add(ops, done("a", T));
        Outbox.add(ops, done("b", T));
        assertEquals(0, Outbox.waiting(ops, T + 1000)); // gaat gewoon even
        assertEquals(2, Outbox.waiting(ops, T + Outbox.QUIET_MS + 1));
        Outbox.settle(ops, ops.optJSONObject(0).optString("k"), Outbox.Outcome.OFFLINE, T + 10);
        assertEquals(2, Outbox.waiting(ops, T + 20)); // al eens mislukt: meteen noemen
    }

    @Test
    public void volgendeKeerIsDeVroegsteVanDeEersteItemsPerTaak() {
        JSONArray ops = new JSONArray();
        assertEquals(-1, Outbox.nextDue(ops));
        JSONObject a = done("a", T);
        Outbox.add(ops, a);
        Outbox.add(ops, Outbox.op(Outbox.REOPEN, "a", TickBody.reopen(T), T, T, "", null)); // next 0, maar wacht op a
        Outbox.settle(ops, a.optString("k"), Outbox.Outcome.RETRY, T);
        assertEquals(T + Outbox.BACKOFF_MS, Outbox.nextDue(ops));
        Outbox.add(ops, done("b", T));
        assertEquals(0, Outbox.nextDue(ops));
    }

    @Test
    public void afvinkenInDeWachtrijHoudtDeTaakVerborgen() throws Exception {
        JSONArray ops = new JSONArray();
        Outbox.add(ops, done("a", T));
        Outbox.add(ops, create("n", T));
        assertEquals(Collections.singleton("a"), Outbox.doneIds(ops));
    }

    @Test
    public void toegevoegdeTakenStaanNaDeVastgezetteNieuwsteEerst() throws Exception {
        JSONArray server = new JSONArray()
                .put(new JSONObject().put("id", "p").put("pinned", true).put("parent_id", JSONObject.NULL))
                .put(new JSONObject().put("id", "x").put("pinned", false).put("parent_id", JSONObject.NULL));
        JSONArray ops = new JSONArray();
        Outbox.add(ops, create("1", T));
        Outbox.add(ops, done("x", T));
        Outbox.add(ops, create("2", T + 1));
        assertEquals("p21x", ids(Outbox.withLocal(server, ops)));
        // Kent de server hem al, dan blijft die van de server staan.
        JSONArray known = new JSONArray().put(new JSONObject().put("id", "1").put("title", "van de server"));
        JSONArray merged = Outbox.withLocal(known, ops);
        assertEquals("21", ids(merged));
        assertEquals("van de server", merged.optJSONObject(1).optString("title"));
    }

    @Test
    public void vervangenEnWeghalen() throws Exception {
        JSONArray list = new JSONArray()
                .put(new JSONObject().put("id", "a").put("title", "lokaal"))
                .put(new JSONObject().put("id", "b"));
        JSONArray r = Outbox.replace(list, new JSONObject().put("id", "a").put("title", "server"));
        assertEquals("server", r.optJSONObject(0).optString("title"));
        assertEquals("b", ids(Outbox.without(list, "a")));
    }

    @Test
    public void padPerSoort() throws Exception {
        assertEquals("/api/tasks/a%20b/done", Outbox.path(done("a b", T), "a%20b"));
        assertEquals("/api/tasks/a/reopen", Outbox.path(Outbox.op(Outbox.REOPEN, "a", "{}", T, T, "", null), "a"));
        assertEquals("/api/tasks", Outbox.path(create("n", T), "n"));
    }

    @Test
    public void afvinkenDraagtHetActieId() throws Exception {
        JSONObject op = done("a", T);
        assertEquals("android-" + T, new JSONObject(op.optString("body")).optString("action"));
    }
}
