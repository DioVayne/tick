package nl.detussenpartij.tick;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/** Welke taken een geofence krijgen. Puur Java, zodat het zonder toestel te testen is. */
final class GeoPlan {
    /** Android staat maximaal 100 geofences per app toe. */
    static final int MAX = 100;

    static final class Fence {
        final String id, title, name, key;
        final double lat, lng;
        final float radius;
        final boolean exit;

        Fence(String id, String title, String name, String key, double lat, double lng, float radius, boolean exit) {
            this.id = id;
            this.key = key;
            this.title = title;
            this.name = name;
            this.lat = lat;
            this.lng = lng;
            this.radius = radius;
            this.exit = exit;
        }
    }

    /** Herkent een plek: verandert hij, dan mag dezelfde taak opnieuw een melding geven. */
    static String key(JSONObject location) {
        return location.optDouble("lat") + "|" + location.optDouble("lng") + "|"
                + location.optDouble("radius") + "|" + trigger(location);
    }

    static boolean isExit(JSONObject location) {
        return "exit".equals(trigger(location));
    }

    private static String trigger(JSONObject location) {
        return "exit".equals(location.optString("trigger")) ? "exit" : "enter";
    }

    /**
     * Open taken met een plek waarvoor nog geen melding is geweest, in lijstvolgorde en hooguit max stuks.
     * fired: taak-id -> key van de plek die al afging (lokaal, nog niet per se op de server bekend).
     */
    static List<Fence> select(JSONArray tasks, JSONObject fired, int max) {
        List<Fence> out = new ArrayList<>();
        for (int i = 0; i < tasks.length() && out.size() < max; i++) {
            JSONObject t = tasks.optJSONObject(i);
            if (t == null || t.optBoolean("done") || t.optBoolean("location_notified")) continue;
            JSONObject loc = t.optJSONObject("location");
            if (loc == null) continue;
            String id = t.optString("id");
            if (id.isEmpty() || key(loc).equals(fired.optString(id, null))) continue;
            out.add(new Fence(id, t.optString("title"), loc.optString("name"), key(loc), loc.optDouble("lat"),
                    loc.optDouble("lng"), (float) loc.optDouble("radius"), isExit(loc)));
        }
        return out;
    }

    /** Gelijk voor dezelfde set geofences, ongeacht de volgorde; anders moet er opnieuw geregistreerd worden. */
    static String signature(List<Fence> fences) {
        TreeMap<String, String> sorted = new TreeMap<>();
        for (Fence f : fences) sorted.put(f.id, f.lat + "|" + f.lng + "|" + f.radius + "|" + (f.exit ? "exit" : "enter"));
        StringBuilder sb = new StringBuilder();
        for (Map.Entry<String, String> e : sorted.entrySet()) sb.append(e.getKey()).append('=').append(e.getValue()).append(';');
        return sb.toString();
    }

    /**
     * Request-id van de geofence: taak-id plus de key van de plek. Zo weet de GeofenceReceiver bij welke plek de
     * geofence hoorde, ook als de taak intussen een andere plek heeft. Max. 100 tekens (Play-diensten); een UUID
     * plus key past ruim.
     */
    static String requestId(Fence f) {
        return f.id + "#" + f.key;
    }

    /** Taak-id uit een request-id; een geofence van een oudere versie heeft alleen het taak-id. */
    static String taskId(String requestId) {
        int i = requestId.lastIndexOf('#');
        return i < 0 ? requestId : requestId.substring(0, i);
    }

    /** Key van de plek uit een request-id, of null als die er niet in staat. Een key bevat zelf nooit '#'. */
    static String fenceKey(String requestId) {
        int i = requestId.lastIndexOf('#');
        return i < 0 ? null : requestId.substring(i + 1);
    }

    /** Signature na het weghalen van de geofences van deze taken, zonder de rest opnieuw te registreren. */
    static String signatureWithout(String signature, Collection<String> taskIds) {
        StringBuilder sb = new StringBuilder();
        for (String part : signature.split(";")) {
            if (part.isEmpty()) continue;
            int eq = part.lastIndexOf('=');
            if (eq >= 0 && taskIds.contains(part.substring(0, eq))) continue;
            sb.append(part).append(';');
        }
        return sb.toString();
    }

    private GeoPlan() {}
}
