package nl.detussenpartij.tick;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.Collections;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

public class WidgetLookTest {
    @Test
    public void automatischNaarDeGrootte() {
        // 4 x 3 (standaard) is Ruim; 2 x 2, 3 kolommen of 2 rijen hoog is Compact.
        assertTrue(WidgetLook.isRoomy(WidgetLook.AUTO, 276, 203));
        assertFalse(WidgetLook.isRoomy(WidgetLook.AUTO, 130, 130));
        assertFalse(WidgetLook.isRoomy(WidgetLook.AUTO, 203, 203));
        assertFalse(WidgetLook.isRoomy(WidgetLook.AUTO, 276, 130));
        // Precies op de grens telt als Ruim.
        assertTrue(WidgetLook.isRoomy(WidgetLook.AUTO, WidgetLook.ROOMY_MIN_WIDTH_DP, WidgetLook.ROOMY_MIN_HEIGHT_DP));
        assertFalse(WidgetLook.isRoomy(WidgetLook.AUTO, WidgetLook.ROOMY_MIN_WIDTH_DP - 1, 400));
        assertFalse(WidgetLook.isRoomy(WidgetLook.AUTO, 400, WidgetLook.ROOMY_MIN_HEIGHT_DP - 1));
    }

    @Test
    public void onbekendeMaatIsDeStandaardmaatDusRuim() {
        assertTrue(WidgetLook.isRoomy(WidgetLook.AUTO, 0, 0));
        assertFalse(WidgetLook.isRoomy(WidgetLook.AUTO, 0, 100));
        assertFalse(WidgetLook.isRoomy(WidgetLook.AUTO, 150, 0));
    }

    @Test
    public void vastgezetteWeergaveWintVanDeGrootte() {
        assertFalse(WidgetLook.isRoomy(WidgetLook.COMPACT, 500, 500));
        assertTrue(WidgetLook.isRoomy(WidgetLook.ROOMY, 100, 100));
    }

    @Test
    public void onbekendeOpgeslagenWeergaveIsAutomatisch() {
        assertEquals(WidgetLook.AUTO, WidgetLook.mode(7));
        assertEquals(WidgetLook.AUTO, WidgetLook.mode(-1));
        assertEquals(WidgetLook.COMPACT, WidgetLook.mode(WidgetLook.COMPACT));
        assertEquals(WidgetLook.ROOMY, WidgetLook.mode(WidgetLook.ROOMY));
    }

    @Test
    public void tikvlakkenMinstens48dpInElkeWeergave() {
        for (int font = WidgetLook.FONT_MIN; font <= WidgetLook.FONT_MAX; font++) {
            for (boolean roomy : new boolean[] {false, true}) {
                WidgetLook l = new WidgetLook(font, 0, roomy);
                assertTrue(l.touchDp() >= 48f);
                // Het zichtbare bolletje past in het tikvlak.
                assertTrue(l.checkPadDp() >= 0f);
                assertEquals(l.touchDp(), (l.checkDp() - 10f) + 2 * l.checkPadDp(), 0.001f);
            }
        }
    }

    @Test
    public void compactIsKaalRuimHeeftMeer() {
        WidgetLook compact = new WidgetLook(15, 0, false);
        WidgetLook roomy = new WidgetLook(15, 0, true);
        assertEquals(1, compact.titleLines());
        assertEquals(2, roomy.titleLines());
        assertFalse(compact.tiles());
        assertFalse(compact.extraIcons());
        assertFalse(compact.sections());
        assertTrue(roomy.tiles());
        assertTrue(roomy.extraIcons());
        assertTrue(roomy.sections());
        assertTrue(roomy.textPadDp() > compact.textPadDp());
        assertTrue(roomy.gapDp() > compact.gapDp());
        assertTrue(roomy.headerSp() > compact.headerSp());
    }

    @Test
    public void regelafstandKomtErBij() {
        assertEquals(new WidgetLook(15, 0, true).textPadDp() + 6, new WidgetLook(15, 6, true).textPadDp(), 0.001f);
        assertEquals(new WidgetLook(15, 0, false).textPadDp() + 6, new WidgetLook(15, 6, false).textPadDp(), 0.001f);
    }

    @Test
    public void waardenBinnenDeGrenzen() {
        WidgetLook l = new WidgetLook(99, -5, true);
        assertEquals(WidgetLook.FONT_MAX, l.font);
        assertEquals(WidgetLook.SPACING_MIN, l.spacing);
        assertEquals(10, new WidgetLook(12, 0, true).smallSp());
        assertEquals(9, new WidgetLook(12, 0, true).pillSp());
    }

    @Test
    public void overstapGeeftBestaandeWidgetsDeOudeWaarden() {
        Map<String, Integer> put = WidgetLook.migrate(18, 4, new int[] {7, 9}, Collections.emptySet());
        assertEquals(4, put.size());
        assertEquals(Integer.valueOf(18), put.get("widget_7_font"));
        assertEquals(Integer.valueOf(4), put.get("widget_7_spacing"));
        assertEquals(Integer.valueOf(18), put.get("widget_9_font"));
        assertEquals(Integer.valueOf(4), put.get("widget_9_spacing"));
    }

    @Test
    public void overstapLaatEigenWaardenStaan() {
        Set<String> existing = new HashSet<>();
        existing.add("widget_7_font");
        Map<String, Integer> put = WidgetLook.migrate(18, 4, new int[] {7}, existing);
        assertEquals(1, put.size());
        assertEquals(Integer.valueOf(4), put.get("widget_7_spacing"));
    }

    @Test
    public void overstapZonderOudeWaardenOfWidgetsDoetNiets() {
        assertTrue(WidgetLook.migrate(null, null, new int[] {7}, Collections.emptySet()).isEmpty());
        assertTrue(WidgetLook.migrate(18, 4, new int[0], Collections.emptySet()).isEmpty());
        assertTrue(WidgetLook.migrate(18, 4, null, Collections.emptySet()).isEmpty());
        // Alleen tekstgrootte gezet: alleen die gaat mee.
        Map<String, Integer> put = WidgetLook.migrate(20, null, new int[] {3}, Collections.emptySet());
        assertEquals(1, put.size());
        assertEquals(Integer.valueOf(20), put.get("widget_3_font"));
    }

    @Test
    public void overstapHoudtWaardenBinnenDeGrenzen() {
        Map<String, Integer> put = WidgetLook.migrate(40, 99, new int[] {1}, Collections.emptySet());
        assertEquals(Integer.valueOf(WidgetLook.FONT_MAX), put.get("widget_1_font"));
        assertEquals(Integer.valueOf(WidgetLook.SPACING_MAX), put.get("widget_1_spacing"));
    }
}
