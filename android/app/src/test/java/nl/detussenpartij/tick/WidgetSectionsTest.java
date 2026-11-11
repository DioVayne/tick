package nl.detussenpartij.tick;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public class WidgetSectionsTest {
    private static final Instant NU = Instant.parse("2026-11-11T12:00:00Z");

    private static JSONObject task(String id, String remindAt, boolean pinned) throws Exception {
        return new JSONObject().put("id", id).put("title", id)
                .put("remind_at", remindAt == null ? JSONObject.NULL : remindAt).put("pinned", pinned);
    }

    /** Korte schrijfwijze: H2 = kopje groep 2, T0 = taak 0, T0+ = taak 0 met extra ruimte erna. */
    private static String shape(List<WidgetSections.Entry> entries) {
        List<String> s = new ArrayList<>();
        for (WidgetSections.Entry e : entries) {
            s.add(e.header ? "H" + e.section : "T" + e.task + (e.groupEnd ? "+" : ""));
        }
        return String.join(" ", s);
    }

    @Test
    public void vandaagEerstTeLaatDanVandaag() throws Exception {
        List<JSONObject> tasks = Arrays.asList(
                task("a", "2026-11-10T09:00:00Z", false),
                task("b", "2026-11-11T11:59:00Z", false),
                task("c", "2026-11-11T15:00:00Z", false));
        assertEquals("H0 T0 T1 H1 T2", shape(WidgetSections.plan(tasks, WidgetFilter.TODAY, NU, true)));
    }

    @Test
    public void eenGroepGeeftGeenKopje() throws Exception {
        List<JSONObject> tasks = Arrays.asList(
                task("a", "2026-11-11T15:00:00Z", false),
                task("b", "2026-11-11T16:00:00Z", false));
        assertEquals("T0 T1", shape(WidgetSections.plan(tasks, WidgetFilter.TODAY, NU, true)));
        List<JSONObject> late = Arrays.asList(task("a", "2026-11-10T09:00:00Z", false));
        assertEquals("T0", shape(WidgetSections.plan(late, WidgetFilter.TODAY, NU, true)));
    }

    @Test
    public void compactHeeftGeenKopjes() throws Exception {
        List<JSONObject> tasks = Arrays.asList(
                task("a", "2026-11-10T09:00:00Z", false),
                task("b", "2026-11-11T15:00:00Z", false));
        assertEquals("T0 T1", shape(WidgetSections.plan(tasks, WidgetFilter.TODAY, NU, false)));
    }

    @Test
    public void vastgezetEnOverigeInEenLijst() throws Exception {
        List<JSONObject> tasks = Arrays.asList(task("a", null, true), task("b", null, true), task("c", null, false));
        assertEquals("H2 T0 T1 H3 T2", shape(WidgetSections.plan(tasks, "Werk", NU, true)));
        assertEquals("H2 T0 T1 H3 T2", shape(WidgetSections.plan(tasks, "", NU, true)));
    }

    @Test
    public void zonderKopjesExtraRuimteNaVastgezet() throws Exception {
        List<JSONObject> tasks = Arrays.asList(task("a", null, true), task("b", null, false), task("c", null, false));
        assertEquals("T0+ T1 T2", shape(WidgetSections.plan(tasks, "", NU, false)));
        // Alleen vastgezette taken: geen ruimte na de laatste.
        List<JSONObject> pinned = Arrays.asList(task("a", null, true), task("b", null, true));
        assertEquals("T0 T1", shape(WidgetSections.plan(pinned, "", NU, true)));
    }

    @Test
    public void vandaagNegeertVastgezet() throws Exception {
        List<JSONObject> tasks = Arrays.asList(
                task("a", "2026-11-11T13:00:00Z", true),
                task("b", "2026-11-11T14:00:00Z", false));
        assertEquals("T0 T1", shape(WidgetSections.plan(tasks, WidgetFilter.TODAY, NU, false)));
    }

    @Test
    public void groepenDoorElkaarGeenKopjes() throws Exception {
        // Een vastgezette taak na een gewone (hoort niet, maar mag niet tot twee keer hetzelfde kopje leiden).
        List<JSONObject> tasks = Arrays.asList(task("a", null, true), task("b", null, false), task("c", null, true));
        List<WidgetSections.Entry> e = WidgetSections.plan(tasks, "", NU, true);
        for (WidgetSections.Entry x : e) assertFalse(x.header);
        assertEquals(3, e.size());
    }

    @Test
    public void legeLijstGeeftNiets() {
        assertTrue(WidgetSections.plan(new ArrayList<>(), "", NU, true).isEmpty());
    }

    @Test
    public void kapotteTijdTeltAlsVandaag() throws Exception {
        assertEquals(WidgetSections.TODAY, WidgetSections.sectionOf(task("a", "gisteren", false), WidgetFilter.TODAY, NU));
        assertEquals(WidgetSections.TODAY, WidgetSections.sectionOf(task("a", null, false), WidgetFilter.TODAY, NU));
    }
}
