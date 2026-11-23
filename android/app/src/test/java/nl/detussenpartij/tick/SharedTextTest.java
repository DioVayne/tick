package nl.detussenpartij.tick;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class SharedTextTest {
    @Test public void nothing() {
        assertNull(SharedText.of(null, null));
        assertNull(SharedText.of(" ", ""));
    }

    @Test public void chromePage() {
        SharedText s = SharedText.of("Recept: pompoensoep", "https://example.com/soep");
        assertEquals("Recept: pompoensoep", s.title);
        assertEquals("https://example.com/soep", s.description);
    }

    @Test public void textWithLink() {
        SharedText s = SharedText.of(null, "Kijk dit artikel eens https://example.com/a.");
        assertEquals("Kijk dit artikel eens", s.title);
        assertEquals("https://example.com/a", s.description);
    }

    @Test public void plainTextStaysTitle() {
        SharedText s = SharedText.of(null, "Melk halen");
        assertEquals("Melk halen", s.title);
        assertEquals("", s.description);
    }

    @Test public void multipleLines() {
        SharedText s = SharedText.of(null, "Boodschappen\nmelk\nbrood");
        assertEquals("Boodschappen", s.title);
        assertEquals("melk\nbrood", s.description);
    }

    @Test public void onlyLink() {
        SharedText s = SharedText.of(null, "https://example.com/x");
        assertEquals("https://example.com/x", s.title);
        assertEquals("https://example.com/x", s.description);
    }

    @Test public void linkAsSubject() {
        SharedText s = SharedText.of("https://example.com/x", "https://example.com/x");
        assertEquals("https://example.com/x", s.title);
        assertEquals("https://example.com/x", s.description);
    }

    @Test public void subjectRepeatedInText() {
        SharedText s = SharedText.of("Soep", "Soep https://example.com/soep");
        assertEquals("Soep", s.title);
        assertEquals("https://example.com/soep", s.description);
    }

    @Test public void longTitle() {
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < 60; i++) b.append(i == 0 ? "" : " ").append("woord");
        SharedText s = SharedText.of(null, b.toString());
        assertTrue(s.title.length() <= SharedText.MAX_TITLE);
        assertTrue(s.title.endsWith("…"));
        assertEquals(b.toString(), s.description);
    }
}
