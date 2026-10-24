package nl.detussenpartij.tick;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Onderweg (auto of fiets) de aankomstcirkels groter maken: hoeveel, en hoe groot per plek. Android meldt plekken een
 * paar minuten te laat; de marge leert Tick uit eerdere metingen (ArrivalStats). Puur Java, zodat het zonder toestel
 * te testen is.
 */
final class RoadPlan {
    static final double CAR_START = 1000, CAR_MIN = 200, CAR_MAX = 3000;
    static final double BIKE_START = 300, BIKE_MIN = 50, BIKE_MAX = 1000;

    /** Zoveel recente metingen van een soort tellen mee voor de marge. */
    static final int LEARN_FROM = 10;
    /** Metingen met een onnauwkeurigere locatie (m) tellen niet mee. */
    static final double MAX_ACCURACY = 100;
    /** Zoveel ruimte (m) blijft er tussen jou en de rand van de vergrote cirkel als je vertrekt. */
    static final double GAP = 50;
    /** Een stand zonder einde (gemiste EXIT) geldt zo lang (ms). */
    static final long MAX_AGE_MS = 3L * 60 * 60 * 1000;

    /** DetectedActivity.IN_VEHICLE en ON_BICYCLE; hier als getal, zodat het zonder Play-diensten te testen is. */
    private static final int IN_VEHICLE = 0, ON_BICYCLE = 1;

    /**
     * Extra straal (m) voor deze soort ("car" of "bike"). Per meting is de goede marge: gebruikte straal min de afstand
     * waarop hij afging (dan was hij precies op de ingestelde rand gekomen). De mediaan van de laatste LEARN_FROM
     * nauwkeurige aankomsten van die soort, binnen de grenzen; zonder metingen de startwaarde.
     */
    static double margin(String arrivalsJson, String mode) {
        boolean bike = "bike".equals(mode);
        double start = bike ? BIKE_START : CAR_START, min = bike ? BIKE_MIN : CAR_MIN, max = bike ? BIKE_MAX : CAR_MAX;
        JSONArray arr;
        try {
            arr = new JSONArray(arrivalsJson);
        } catch (Exception e) {
            return start;
        }
        List<Double> good = new ArrayList<>();
        for (int i = arr.length() - 1; i >= 0 && good.size() < LEARN_FROM; i--) {
            JSONObject m = arr.optJSONObject(i);
            if (m == null || m.optBoolean("exit") || !mode.equals(m.optString("mode"))) continue;
            if (!m.has("acc") || m.optDouble("acc") >= MAX_ACCURACY) continue;
            double g = m.optDouble("used") - m.optDouble("dist");
            if (!Double.isNaN(g)) good.add(g);
        }
        if (good.isEmpty()) return start;
        Collections.sort(good);
        int n = good.size();
        double median = n % 2 == 1 ? good.get(n / 2) : (good.get(n / 2 - 1) + good.get(n / 2)) / 2;
        return Math.max(min, Math.min(max, median));
    }

    /**
     * Straal van een aankomstcirkel onderweg: r + marge, maar nooit zo groot dat je er nu al in staat (anders gaat hij
     * niet af), en nooit kleiner dan r. Onbekende afstand, of je bent er al: gewoon r.
     */
    static float roadRadius(double radius, double margin, Double distanceToCenter) {
        if (distanceToCenter == null || distanceToCenter <= radius) return (float) radius;
        return (float) Math.max(radius, Math.min(radius + margin, distanceToCenter - GAP));
    }

    /** "car", "bike" of "" voor een DetectedActivity-type. */
    static String modeFor(int activityType) {
        if (activityType == IN_VEHICLE) return "car";
        if (activityType == ON_BICYCLE) return "bike";
        return "";
    }

    /** Of de stand (auto of fiets, begonnen op modeAt) nu nog geldt. */
    static boolean isActive(String mode, long modeAt, long now) {
        return mode != null && !mode.isEmpty() && now - modeAt <= MAX_AGE_MS;
    }

    private RoadPlan() {}
}
