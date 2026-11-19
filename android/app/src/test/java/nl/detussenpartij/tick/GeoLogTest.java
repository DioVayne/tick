package nl.detussenpartij.tick;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.util.List;

public class GeoLogTest {
    @Test
    public void houdtDeLaatsteKeep() throws Exception {
        String json = "[]";
        for (int i = 0; i < GeoLog.KEEP + 10; i++) json = GeoLog.add(json, GeoLog.event(i, false, 1));
        JSONArray arr = new JSONArray(json);
        assertEquals(GeoLog.KEEP, arr.length());
        assertEquals(10, arr.getJSONObject(0).getLong("at"));
        assertEquals(GeoLog.KEEP + 9, arr.getJSONObject(arr.length() - 1).getLong("at"));
    }

    @Test
    public void onleesbaarTeltAlsLeeg() throws Exception {
        assertEquals(1, new JSONArray(GeoLog.add("onzin", GeoLog.netNoFix(5))).length());
        assertEquals(1, new JSONArray(GeoLog.add(null, GeoLog.netNoFix(5))).length());
        assertTrue(GeoLog.newestFirst("onzin", 10).isEmpty());
    }

    @Test
    public void nieuwsteEerst() throws Exception {
        String json = GeoLog.add(GeoLog.add(GeoLog.add("[]", GeoLog.event(1, false, 1)), GeoLog.event(2, true, 1)),
                GeoLog.decide(3, "Taak", GeoLog.SHOWN, false));
        List<JSONObject> out = GeoLog.newestFirst(json, 2);
        assertEquals(2, out.size());
        assertEquals(3, out.get(0).getLong("at"));
        assertEquals(2, out.get(1).getLong("at"));
    }

    @Test
    public void rustigVangnetWordtSamengevoegd() throws Exception {
        String json = GeoLog.add("[]", GeoLog.event(1, false, 1));
        json = GeoLog.add(json, GeoLog.net(10, 2, 30, 0));
        json = GeoLog.add(json, GeoLog.net(20, 2, 45, 0));
        json = GeoLog.add(json, GeoLog.net(30, 2, 25, 0));
        JSONArray arr = new JSONArray(json);
        assertEquals(2, arr.length());
        JSONObject last = arr.getJSONObject(1);
        assertEquals(30, last.getLong("at"));
        assertEquals(10, last.getLong("since"));
        assertEquals(3, last.getInt("times"));
        assertEquals(25, last.getInt("acc"));
    }

    @Test
    public void vangnetMetMeldingOfAnderAantalNietSamengevoegd() throws Exception {
        String json = GeoLog.add("[]", GeoLog.net(10, 2, 30, 0));
        json = GeoLog.add(json, GeoLog.net(20, 3, 30, 0)); // een taak erbij
        json = GeoLog.add(json, GeoLog.net(30, 3, 30, 1)); // ving een aankomst
        json = GeoLog.add(json, GeoLog.net(40, 2, 30, 0));
        assertEquals(4, new JSONArray(json).length());
    }

    @Test
    public void andereRegelTussendoorBreektHetSamenvoegen() throws Exception {
        String json = GeoLog.add("[]", GeoLog.net(10, 1, 30, 0));
        json = GeoLog.add(json, GeoLog.reg(15, 1, 0, true, GeoLog.Why.DAILY));
        json = GeoLog.add(json, GeoLog.net(20, 1, 30, 0));
        assertEquals(3, new JSONArray(json).length());
    }

    @Test
    public void geenLocatieWordtSamengevoegd() throws Exception {
        String json = GeoLog.add("[]", GeoLog.netNoFix(10));
        json = GeoLog.add(json, GeoLog.netNoFix(20));
        JSONArray arr = new JSONArray(json);
        assertEquals(1, arr.length());
        assertEquals(2, arr.getJSONObject(0).getInt("times"));
    }

    @Test
    public void regelsHebbenHunVelden() throws Exception {
        JSONObject r = GeoLog.reg(1, 4, 1, false, GeoLog.Why.CHANGED);
        assertEquals(GeoLog.REG, r.getString("kind"));
        assertEquals(4, r.getInt("n"));
        assertEquals(1, r.getInt("added"));
        assertFalse(r.getBoolean("full"));
        JSONObject d = GeoLog.decide(2, "Supplementen", "AL_GEMELD", true);
        assertEquals("AL_GEMELD", d.getString("result"));
        assertTrue(d.getBoolean("net"));
        assertFalse(GeoLog.net(3, 1, Double.NaN, 0).has("acc"));
        assertEquals(1000, GeoLog.eventError(4, 1000).getInt("code"));
        assertEquals("ApiException", GeoLog.regFailed(5, "ApiException").getString("why"));
    }

    @Test
    public void langeTitelIngekort() throws Exception {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 100; i++) sb.append('x');
        String t = GeoLog.title(sb.toString());
        assertEquals(GeoLog.TITLE_MAX, t.length());
        assertTrue(t.endsWith("…"));
        assertEquals("kort", GeoLog.title("  kort "));
        assertEquals("", GeoLog.title(null));
        // Geen half emoji-teken aan het eind.
        StringBuilder e = new StringBuilder();
        for (int i = 0; i < GeoLog.TITLE_MAX - 2; i++) e.append('x');
        e.append("😀😀😀");
        String out = GeoLog.title(e.toString());
        assertFalse(Character.isHighSurrogate(out.charAt(out.length() - 2)));
    }
}
