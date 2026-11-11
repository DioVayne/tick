package nl.detussenpartij.tick;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

public class UndoPlanTest {
    private static JSONObject pending(String id, long at) throws Exception {
        return new JSONObject().put(id, at);
    }

    private static String ids(JSONArray arr) {
        StringBuilder s = new StringBuilder();
        for (int i = 0; i < arr.length(); i++) s.append(arr.optJSONObject(i).optString("id"));
        return s.toString();
    }

    private static JSONArray tasks(String... idsAndRemind) throws Exception {
        JSONArray arr = new JSONArray();
        for (String x : idsAndRemind) {
            String[] p = x.split("@");
            JSONObject t = new JSONObject().put("id", p[0]).put("parent_id", JSONObject.NULL);
            t.put("remind_at", p.length > 1 ? p[1] : JSONObject.NULL);
            arr.put(t);
        }
        return arr;
    }

    private static Set<String> set(String... ids) {
        Set<String> s = new HashSet<>();
        Collections.addAll(s, ids);
        return s;
    }

    @Test
    public void afvinkenAlleenAlsDeTaakNogNietOnderwegIs() throws Exception {
        assertTrue(UndoPlan.tick(new JSONObject(), "a"));
        // Nogmaals op het bolletje (of een oude rij van een trage launcher): niets, en zeker niet stil terugzetten.
        assertFalse(UndoPlan.tick(pending("a", 1000), "a"));
        assertTrue(UndoPlan.tick(pending("b", 1000), "a"));
        assertFalse(UndoPlan.tick(new JSONObject(), ""));
    }

    @Test
    public void ongedaanMakenBinnenHetVenster() throws Exception {
        assertEquals(1000, UndoPlan.undo(pending("a", 1000), "a", 1000, 1000 + UndoPlan.UNDO_WINDOW_MS));
        // Zonder moment uit de rij: dat uit pending.
        assertEquals(1000, UndoPlan.undo(pending("a", 1000), "a", 0, 3000));
    }

    @Test
    public void trageLauncherKrijgtNogEvenRuimte() throws Exception {
        long limit = 1000 + UndoPlan.UNDO_WINDOW_MS + UndoPlan.UNDO_GRACE_MS;
        assertEquals(1000, UndoPlan.undo(pending("a", 1000), "a", 1000, limit));
        assertEquals(0, UndoPlan.undo(pending("a", 1000), "a", 1000, limit + 1));
    }

    @Test
    public void ookAlsSyncDeTaakAlLosliet() {
        // De server gaf de taak niet meer en het venster was om: pending is leeg, maar de knop stond er nog.
        assertEquals(1000, UndoPlan.undo(new JSONObject(), "a", 1000, 1000 + UndoPlan.UNDO_WINDOW_MS + 500));
        assertEquals(0, UndoPlan.undo(new JSONObject(), "a", 0, 2000));
    }

    @Test
    public void eenOudeRijDraaitEenNieuwereTikNietTerug() throws Exception {
        assertEquals(0, UndoPlan.undo(pending("a", 5000), "a", 1000, 5500));
    }

    @Test
    public void vastgehoudenTakenZijnDeTakenInHetVenster() throws Exception {
        JSONObject p = new JSONObject().put("a", 1000).put("b", 1000 + UndoPlan.UNDO_WINDOW_MS).put("c", 0);
        assertEquals(set("a", "b"), UndoPlan.held(p, 1000 + UndoPlan.UNDO_WINDOW_MS));
        assertEquals(set("b"), UndoPlan.held(p, 1001 + UndoPlan.UNDO_WINDOW_MS));
    }

    @Test
    public void afgerondeTaakBlijftOpZijnPlek() throws Exception {
        JSONArray old = tasks("a", "b", "c", "d");
        JSONArray server = tasks("a", "c", "d"); // b is af
        assertEquals("abcd", ids(UndoPlan.merge(old, server, set("b"))));
        // Ook als de eerste taak af is, of meerdere achter elkaar.
        assertEquals("abcd", ids(UndoPlan.merge(old, tasks("c", "d"), set("a", "b"))));
        assertEquals("abcd", ids(UndoPlan.merge(old, tasks("a", "d"), set("b", "c"))));
    }

    @Test
    public void nieuweTakenVanDeServerKomenErGewoonBij() throws Exception {
        assertEquals("xabc", ids(UndoPlan.merge(tasks("a", "b", "c"), tasks("x", "a", "c"), set("b"))));
    }

    @Test
    public void doorgeschovenHerhalingHoudtZijnOudeKeer() throws Exception {
        JSONArray old = tasks("a@2026-11-11T08:00:00Z", "b");
        JSONArray server = tasks("a@2026-11-12T08:00:00Z", "b");
        JSONArray merged = UndoPlan.merge(old, server, set("a"));
        assertEquals("2026-11-11T08:00:00Z", merged.optJSONObject(0).optString("remind_at"));
        // Zonder vasthouden geldt de server.
        assertEquals("2026-11-12T08:00:00Z", UndoPlan.merge(old, server, set()).optJSONObject(0).optString("remind_at"));
    }

    @Test
    public void nietsVastTeHoudenGeeftDeServerlijst() throws Exception {
        JSONArray server = tasks("a");
        assertSame(server, UndoPlan.merge(tasks("a", "b"), server, set()));
        // Een vastgehouden taak die ook in de oude lijst niet stond: niets toe te voegen.
        assertEquals("a", ids(UndoPlan.merge(tasks("a"), server, set("z"))));
    }
}
