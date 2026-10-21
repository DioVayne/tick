package nl.detussenpartij.tick;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public class WidgetFilterTest {
    private static final ZoneId AMS = ZoneId.of("Europe/Amsterdam");
    /** Woensdag 21 oktober 2026, 14:00 in Amsterdam (12:00 UTC). */
    private static final ZonedDateTime NU = ZonedDateTime.of(2026, 10, 21, 14, 0, 0, 0, AMS);

    private static JSONObject task(String id, String list, String remindAt, String parent) throws Exception {
        JSONObject o = new JSONObject().put("id", id).put("title", id).put("list", list);
        o.put("remind_at", remindAt == null ? JSONObject.NULL : remindAt);
        o.put("parent_id", parent == null ? JSONObject.NULL : parent);
        return o;
    }

    /** Zoals de server ze geeft: vastgezet, dan positie. */
    private static JSONArray voorbeeld() throws Exception {
        return new JSONArray()
                .put(task("a", "Inbox", null, null))
                .put(task("b", "Werk", "2026-10-21T21:30:00Z", null)) // 23:30 vanavond
                .put(task("b1", "Werk", null, "b"))
                .put(task("b2", "Werk", null, "b"))
                .put(task("c", "Thuis", "2026-10-19T07:00:00Z", null)) // te laat
                .put(task("d", "Werk", "2026-10-21T22:30:00Z", null)) // 00:30 morgen
                .put(task("e", "Inbox", "2026-10-21T10:00:00Z", null)); // vanochtend
    }

    private static List<String> ids(List<JSONObject> tasks) {
        List<String> out = new ArrayList<>();
        for (JSONObject t : tasks) out.add(t.optString("id"));
        return out;
    }

    @Test
    public void allesToontHoofdtakenInServervolgorde() throws Exception {
        assertEquals(Arrays.asList("a", "b", "c", "d", "e"), ids(WidgetFilter.select(voorbeeld(), "", NU)));
    }

    @Test
    public void eenLijst() throws Exception {
        assertEquals(Arrays.asList("b", "d"), ids(WidgetFilter.select(voorbeeld(), "Werk", NU)));
        assertEquals(Arrays.asList("a", "e"), ids(WidgetFilter.select(voorbeeld(), "Inbox", NU)));
    }

    @Test
    public void lijstnaamZonderHoofdlettersEnSpatiesTelt() throws Exception {
        assertEquals(Arrays.asList("b", "d"), ids(WidgetFilter.select(voorbeeld(), " werk ", NU)));
    }

    @Test
    public void legeLijstnaamIsInbox() throws Exception {
        JSONArray arr = new JSONArray().put(task("x", "", null, null)).put(task("y", null, null, null));
        assertEquals(Arrays.asList("x", "y"), ids(WidgetFilter.select(arr, "Inbox", NU)));
    }

    @Test
    public void vandaagTotMiddernachtTeLaatBovenaan() throws Exception {
        assertEquals(Arrays.asList("c", "e", "b"), ids(WidgetFilter.select(voorbeeld(), WidgetFilter.TODAY, NU)));
    }

    @Test
    public void subtakenTellen() throws Exception {
        Map<String, Integer> n = WidgetFilter.openSubtasks(voorbeeld());
        assertEquals(Integer.valueOf(2), n.get("b"));
        assertNull(n.get("a"));
    }

    @Test
    public void lijstkleurenGelijkAanHetWeb() {
        // Referentie: listColor uit public/lists.js voor dezelfde namen.
        List<String> names = Arrays.asList("Inbox", "Werk", "Boodschappen", "Thuis", "Privé", "Één lijst", "werk 2");
        Locale nl = Locale.forLanguageTag("nl");
        assertNull(WidgetFilter.listColor("Inbox", names, nl));
        assertEquals("#00b8d9", WidgetFilter.listColor("Werk", names, nl));
        assertEquals("#e5484d", WidgetFilter.listColor("Boodschappen", names, nl));
        assertEquals("#5b5bd6", WidgetFilter.listColor("Thuis", names, nl));
        assertEquals("#8bc34a", WidgetFilter.listColor("Privé", names, nl));
        assertEquals("#f49ac1", WidgetFilter.listColor("Één lijst", names, nl));
        assertEquals("#a1745a", WidgetFilter.listColor("werk 2", names, nl));
        assertEquals("#00b8d9", WidgetFilter.listColor("Werk", Arrays.asList("Werk"), nl));
    }

    @Test
    public void lijstkleurenLeesbaarOpDePil() {
        String[] kleuren = {"#e5484d", "#f76b15", "#e8a317", "#d9c62b", "#8bc34a", "#2e9d4f", "#12a594",
                "#00b8d9", "#378add", "#5b5bd6", "#a36bf0", "#d6409f", "#f49ac1", "#a1745a"};
        int donker = 0x0E1014, licht = 0xE3E7EC; // widget_pill in values-night en values
        for (String k : kleuren) {
            int c = Integer.parseInt(k.substring(1), 16);
            assertTrue(k + " donker", WidgetFilter.contrast(WidgetFilter.readable(c, donker, true) & 0xFFFFFF, donker) >= 4.5);
            assertTrue(k + " licht", WidgetFilter.contrast(WidgetFilter.readable(c, licht, false) & 0xFFFFFF, licht) >= 4.5);
        }
        // Wat al leesbaar is, blijft precies dezelfde kleur.
        assertEquals(0xFFD9C62B, WidgetFilter.readable(0xD9C62B, donker, true));
    }
}
