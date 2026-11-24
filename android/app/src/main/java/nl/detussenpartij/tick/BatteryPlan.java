package nl.detussenpartij.tick;

import java.util.Locale;

/**
 * Batterij zonder Android, zodat JUnit het kan testen: welk merk de telefoon is (voor de uitleg per merk) en wat er na
 * het koppelen gebeurt.
 */
final class BatteryPlan {
    private BatteryPlan() {}

    enum Brand { XIAOMI, SAMSUNG, ONEPLUS, VIVO, HUAWEI, OTHER }

    /** Het merk naar Build.MANUFACTURER (en Build.BRAND, want een Redmi of POCO meldt zich soms als Xiaomi en soms niet). */
    static Brand brand(String manufacturer, String brand) {
        String s = ((manufacturer == null ? "" : manufacturer) + " " + (brand == null ? "" : brand)).toLowerCase(Locale.ROOT);
        if (s.contains("xiaomi") || s.contains("redmi") || s.contains("poco")) return Brand.XIAOMI;
        if (s.contains("samsung")) return Brand.SAMSUNG;
        if (s.contains("oneplus") || s.contains("oppo") || s.contains("realme")) return Brand.ONEPLUS;
        if (s.contains("vivo") || s.contains("iqoo")) return Brand.VIVO;
        if (s.contains("huawei") || s.contains("honor")) return Brand.HUAWEI;
        return Brand.OTHER;
    }

    enum AfterPair { NOTHING, SYSTEM_PROMPT, EXPLAIN }

    /**
     * Na het koppelen: al vrijgesteld, dan niets. Anders de systeemvraag, behalve in de Play-app: die mag de vraag niet
     * stellen (Play-beleid voor REQUEST_IGNORE_BATTERY_OPTIMIZATIONS) en toont uitleg met een knop naar de instellingen.
     */
    static AfterPair afterPair(boolean playStore, boolean unrestricted) {
        if (unrestricted) return AfterPair.NOTHING;
        return playStore ? AfterPair.EXPLAIN : AfterPair.SYSTEM_PROMPT;
    }
}
