package nl.detussenpartij.tick;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class TickAddressTest {
    @Test public void zonderSchemaWordtHttps() { assertEquals("https://tick.example.com", TickAddress.normalize(" tick.example.com/ ")); }
    @Test public void padEnQueryVallenWeg() { assertEquals("https://t.example", TickAddress.normalize("https://T.Example/login?x=1#y")); }
    @Test public void poortBlijftStandaardpoortNiet() {
        assertEquals("https://t.example:8443", TickAddress.normalize("https://t.example:8443/"));
        assertEquals("https://t.example", TickAddress.normalize("https://t.example:443"));
    }
    @Test public void httpAlleenNaarLocalhost() {
        assertEquals("http://localhost:8787", TickAddress.normalize("http://localhost:8787"));
        assertNull(TickAddress.normalize("http://t.example"));
    }
    @Test public void onzinIsNull() {
        assertNull(TickAddress.normalize(null));
        assertNull(TickAddress.normalize("   "));
        assertNull(TickAddress.normalize("ftp://t.example"));
        assertNull(TickAddress.normalize("javascript:alert(1)"));
        assertNull(TickAddress.normalize("https://user@t.example"));
        assertNull(TickAddress.normalize("https://exa mple.com"));
    }
    @Test public void zelfdeOorsprong() {
        assertTrue(TickAddress.sameOrigin("https://t.example", "https://t.example/?task=1"));
        assertFalse(TickAddress.sameOrigin("https://t.example", "https://t.example.evil.com/"));
        assertFalse(TickAddress.sameOrigin("https://t.example", "https://t.example:8443/"));
        assertFalse(TickAddress.sameOrigin("", "https://t.example/"));
        assertFalse(TickAddress.sameOrigin("https://t.example", "t.example"));
    }
    @Test public void hostOmTeTonen() { assertEquals("t.example", TickAddress.host("https://t.example")); }
}
