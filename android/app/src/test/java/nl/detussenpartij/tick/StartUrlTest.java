package nl.detussenpartij.tick;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class StartUrlTest {
    @Test public void launchZonderSleutel() { assertEquals("https://t.example/?app=android&pair=1", StartUrl.launch("https://t.example", true)); }
    @Test public void launchMetSleutel() { assertEquals("https://t.example/?app=android", StartUrl.launch("https://t.example", false)); }
    @Test public void taakWordtGecodeerd() { assertEquals("https://t.example/?app=android&task=a%2Fb", StartUrl.task("https://t.example", "a/b", false)); }
    @Test public void taakZonderSleutel() { assertEquals("https://t.example/?app=android&task=x&pair=1", StartUrl.task("https://t.example", "x", true)); }
}
