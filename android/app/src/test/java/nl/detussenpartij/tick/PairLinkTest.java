package nl.detussenpartij.tick;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class PairLinkTest {
    @Test public void leestCode() { assertEquals("abc", PairLink.code("tick://pair?code=abc")); }
    @Test public void gecodeerdeCode() { assertEquals("a+b", PairLink.code("tick://pair?code=a%2Bb")); }
    @Test public void anderSchemaOfLeeg() {
        assertNull(PairLink.code("https://pair?code=abc"));
        assertNull(PairLink.code("tick://sync?code=abc"));
        assertNull(PairLink.code("tick://pair"));
    }
    @Test public void leestAdres() {
        assertEquals("https://t.example", PairLink.base("tick://pair?code=abc&base=https%3A%2F%2Ft.example%2F"));
        assertEquals("abc", PairLink.code("tick://pair?code=abc&base=https%3A%2F%2Ft.example"));
    }
    @Test public void zonderOfOngeldigAdres() {
        assertNull(PairLink.base("tick://pair?code=abc"));
        assertNull(PairLink.base("tick://pair?code=abc&base=http%3A%2F%2Ft.example"));
        assertNull(PairLink.base("tick://sync?base=https%3A%2F%2Ft.example"));
    }
}
