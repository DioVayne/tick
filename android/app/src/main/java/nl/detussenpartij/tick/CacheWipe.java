package nl.detussenpartij.tick;

/** Wanneer de lokale gegevens (cache, geofences, wachtrijen) van een gebruiker weg moeten. Pure Java, zonder Android. */
final class CacheWipe {
    enum Reason { REDEEM, UNAUTHORIZED }

    /**
     * Na een 401 altijd. Bij koppelen alleen als de oude en de nieuwe user_id beide bekend zijn en verschillen: een
     * lege oude user_id (sleutel van vóór de update) of lege nieuwe telt als dezelfde persoon.
     */
    static boolean shouldWipe(String oldUserId, String newUserId, Reason reason) {
        if (reason == Reason.UNAUTHORIZED) return true;
        String a = oldUserId == null ? "" : oldUserId;
        String b = newUserId == null ? "" : newUserId;
        return !a.isEmpty() && !b.isEmpty() && !a.equals(b);
    }

    private CacheWipe() {}
}
