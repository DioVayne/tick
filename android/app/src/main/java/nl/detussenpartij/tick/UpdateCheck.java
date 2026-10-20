package nl.detussenpartij.tick;

/** Is er een nieuwere officiële app op GitHub Releases? Pure Java, zonder Android, voor een gewone JUnit-test. */
final class UpdateCheck {
    /** Eén keer per dag kijken. */
    static final long INTERVAL_MS = 24 * 60 * 60 * 1000L;

    private UpdateCheck() {}

    /** De versie uit een release-tag ("android-v1.5.2" wordt "1.5.2"), of null als het geen app-release is. */
    static String version(String tag) {
        if (tag == null || !tag.startsWith("android-v")) return null;
        String v = tag.substring("android-v".length());
        return v.matches("\\d+(\\.\\d+)*") ? v : null;
    }

    /** Is latest nieuwer dan current? Per getal vergeleken (1.10 is nieuwer dan 1.9); onleesbaar telt als niet nieuwer. */
    static boolean isNewer(String latest, String current) {
        if (latest == null || current == null) return false;
        String[] a = latest.split("\\.");
        String[] b = current.split("\\.");
        try {
            for (int i = 0; i < Math.max(a.length, b.length); i++) {
                int x = i < a.length ? Integer.parseInt(a[i]) : 0;
                int y = i < b.length ? Integer.parseInt(b[i]) : 0;
                if (x != y) return x > y;
            }
        } catch (NumberFormatException e) {
            return false;
        }
        return false;
    }

    /** Is het tijd om weer te kijken? Ook als de klok terug is gezet (last in de toekomst). */
    static boolean due(long lastMs, long nowMs) {
        return nowMs - lastMs >= INTERVAL_MS || lastMs > nowMs;
    }
}
