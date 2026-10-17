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
}
