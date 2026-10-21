package nl.detussenpartij.tick;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class StartUrlTest {
    @Test public void launchZonderSleutel() { assertEquals("https://t.example/?app=android&pair=1", StartUrl.launch("https://t.example", true)); }
    @Test public void launchMetSleutel() { assertEquals("https://t.example/?app=android", StartUrl.launch("https://t.example", false)); }
    @Test public void taakWordtGecodeerd() { assertEquals("https://t.example/?app=android&task=a%2Fb", StartUrl.task("https://t.example", "a/b", false)); }
    @Test public void lijstWordtGecodeerd() { assertEquals("https://t.example/?app=android&list=Werk+%26+thuis", StartUrl.list("https://t.example", "Werk & thuis", false)); }
    @Test public void lijstZonderSleutel() { assertEquals("https://t.example/?app=android&list=Inbox&pair=1", StartUrl.list("https://t.example", "Inbox", true)); }
    @Test public void taakZonderSleutel() { assertEquals("https://t.example/?app=android&task=x&pair=1", StartUrl.task("https://t.example", "x", true)); }
    @Test public void intentOpDezeTick() {
        assertEquals("https://t.example/?app=android&task=x", StartUrl.fromIntent("https://t.example", "https://t.example/?app=android&task=x", false));
        assertEquals("https://t.example/?task=x&pair=1#a", StartUrl.fromIntent("https://t.example", "https://t.example/?task=x#a", true));
        assertEquals("https://t.example/?pair=1", StartUrl.fromIntent("https://t.example", "https://t.example/?pair=1", true));
        assertEquals("https://t.example/lijst?pair=1", StartUrl.fromIntent("https://t.example", "https://t.example/lijst", true));
    }
    @Test public void intentNaarAndereSiteWordtGewoneStart() {
        assertEquals("https://t.example/?app=android", StartUrl.fromIntent("https://t.example", "https://evil.example/", false));
        assertEquals("https://t.example/?app=android&pair=1", StartUrl.fromIntent("https://t.example", null, true));
    }
}
