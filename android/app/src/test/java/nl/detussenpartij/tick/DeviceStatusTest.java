package nl.detussenpartij.tick;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class DeviceStatusTest {
    private static final String JSON = DeviceStatus.json("Google Pixel 8", true, "always", "1.2");
    private static final long SIX_HOURS = 6L * 60 * 60 * 1000;

    @Test
    public void zelfdeStatusBinnenZesUurWordtNietOpnieuwGestuurd() {
        assertFalse(DeviceStatus.shouldSend(JSON, 1000, JSON, 1000 + SIX_HOURS));
    }

    @Test
    public void zelfdeStatusNaZesUurWordtWelGestuurd() {
        assertTrue(DeviceStatus.shouldSend(JSON, 1000, JSON, 1000 + SIX_HOURS + 1));
    }

    @Test
    public void andereStatusWordtDirectGestuurd() {
        String other = DeviceStatus.json("Google Pixel 8", false, "always", "1.2");
        assertTrue(DeviceStatus.shouldSend(JSON, 1000, other, 2000));
    }

    @Test
    public void naamKapIntOpHonderdTekensZonderSurrogaatTeSplitsen() {
        String emoji = new String(Character.toChars(0x1F600));
        StringBuilder sb = new StringBuilder("xx"); // zo valt een emoji precies over de grens van 100 chars
        for (int i = 0; i < 80; i++) sb.append(emoji);
        String name = DeviceStatus.deviceName("Acme", sb.toString());
        assertTrue(name.length() <= 100);
        assertFalse(Character.isHighSurrogate(name.charAt(name.length() - 1)));
        String plain = DeviceStatus.deviceName("Acme", "m".repeat(150));
        assertEquals(100, plain.length());
    }

    @Test
    public void naamZonderGegevensIsAndroid() {
        assertEquals("Android", DeviceStatus.deviceName(null, null));
        assertEquals("Android", DeviceStatus.deviceName("  ", ""));
    }

    @Test
    public void naamDubbeltDeFabrikantNiet() {
        assertEquals("Google Pixel 8", DeviceStatus.deviceName("Google", "Google Pixel 8"));
        assertEquals("samsung SM-S918B", DeviceStatus.deviceName("samsung", "SM-S918B"));
        assertEquals("Pixel", DeviceStatus.deviceName(null, " Pixel "));
    }

    @Test
    public void nooitGestuurdWordtGestuurd() {
        assertTrue(DeviceStatus.shouldSend("", 0, JSON, 2000));
    }

    @Test
    public void jsonHeeftDeVerwachteVorm() {
        assertEquals("{\"name\":\"Google Pixel 8\",\"notifications\":true,\"location\":\"always\",\"app_version\":\"1.2\"}", JSON);
    }

    @Test
    public void jsonEscapetAanhalingstekensBackslashesEnControletekens() {
        String j = DeviceStatus.json("Jan \"de\" telefoon\\x\n\t\u0001", false, "off", "1.2");
        assertTrue(j, j.contains("\"name\":\"Jan \\\"de\\\" telefoon\\\\x\\n\\t\\u0001\""));
    }
}
