package nl.detussenpartij.tick;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/** Welke taken een geofence krijgen. Puur Java, zodat het zonder toestel te testen is. */
final class GeoPlan {
    /** Android staat maximaal 100 geofences per app toe. */
    static final int MAX = 100;

    static final class Fence {
        final String id, title, name, key;
        final double lat, lng;
        /** Straal van de geofence: de ingestelde, of onderweg de vergrote. */
        final float radius;
        final boolean exit;
        /** "car" of "bike" als de cirkel onderweg vergroot is, anders "". */
        final String mode;

        Fence(String id, String title, String name, String key, double lat, double lng, float radius, boolean exit, String mode) {
            this.id = id;
            this.key = key;
            this.title = title;
            this.name = name;
            this.lat = lat;
            this.lng = lng;
            this.radius = radius;
            this.exit = exit;
            this.mode = mode;
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
        return select(tasks, fired, max, Collections.emptyMap(), "");
    }

    /**
     * Zelfde, maar onderweg: roadRadii (taak-id -> straal) vergroot aankomstcirkels (alleen als groter dan ingesteld),
     * met mode "car" of "bike". Vertrekcirkels blijven altijd zoals ingesteld.
     */
    static List<Fence> select(JSONArray tasks, JSONObject fired, int max, Map<String, Float> roadRadii, String mode) {
        List<Fence> out = new ArrayList<>();
        for (int i = 0; i < tasks.length() && out.size() < max; i++) {
            JSONObject t = tasks.optJSONObject(i);
            if (t == null || t.optBoolean("done") || t.optBoolean("location_notified")) continue;
            JSONObject loc = t.optJSONObject("location");
            if (loc == null) continue;
            String id = t.optString("id");
            if (id.isEmpty() || key(loc).equals(fired.optString(id, null))) continue;
            float radius = (float) loc.optDouble("radius");
            boolean exit = isExit(loc);
            Float road = exit ? null : roadRadii.get(id);
            boolean bigger = road != null && road > radius && mode != null && !mode.isEmpty();
            out.add(new Fence(id, t.optString("title"), loc.optString("name"), key(loc), loc.optDouble("lat"),
                    loc.optDouble("lng"), bigger ? road : radius, exit, bigger ? mode : ""));
        }
        return out;
    }

    /** Gelijk voor dezelfde set geofences, ongeacht de volgorde; anders moet er opnieuw geregistreerd worden. */
    static String signature(List<Fence> fences) {
        TreeMap<String, String> sorted = new TreeMap<>();
        for (Fence f : fences) sorted.put(f.id, f.lat + "|" + f.lng + "|" + f.radius + "|" + (f.exit ? "exit" : "enter")
                + (f.mode.isEmpty() ? "" : "|" + f.mode));
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
        // Onderweg vergroot: "@soort:straal" erachter, zodat de melding dat ook weet als de stand al voorbij is
        // (Android meldt vaak pas na het uitstappen).
        return f.id + "#" + f.key + (f.mode.isEmpty() ? "" : "@" + f.mode + ":" + f.radius);
    }

    /** Taak-id uit een request-id; een geofence van een oudere versie heeft alleen het taak-id. */
    static String taskId(String requestId) {
        int i = requestId.lastIndexOf('#');
        return i < 0 ? requestId : requestId.substring(0, i);
    }

    /**
     * Key van de plek uit een request-id, of null als die er niet in staat. Een key bevat zelf nooit '#' of '@'.
     */
    static String fenceKey(String requestId) {
        int i = requestId.lastIndexOf('#');
        if (i < 0) return null;
        String rest = requestId.substring(i + 1);
        int at = rest.indexOf('@');
        return at < 0 ? rest : rest.substring(0, at);
    }

    /** "car" of "bike" als de geofence onderweg vergroot was, anders "". */
    static String roadMode(String requestId) {
        String road = roadPart(requestId);
        if (road == null) return "";
        int colon = road.indexOf(':');
        return colon < 0 ? "" : road.substring(0, colon);
    }

    /** De vergrote straal uit de request-id, of NaN als hij niet vergroot was. */
    static float roadRadius(String requestId) {
        String road = roadPart(requestId);
        if (road == null) return Float.NaN;
        try {
            return Float.parseFloat(road.substring(road.indexOf(':') + 1));
        } catch (Exception e) {
            return Float.NaN;
        }
    }

    private static String roadPart(String requestId) {
        int i = requestId.lastIndexOf('#');
        int at = i < 0 ? -1 : requestId.indexOf('@', i);
        return at < 0 ? null : requestId.substring(at + 1);
    }

    /** Wat er bij Play-diensten moet veranderen om van de geregistreerde request-ids naar deze geofences te gaan. */
    static final class Diff {
        /** Request-ids die weg moeten. */
        final List<String> remove = new ArrayList<>();
        /** Nieuwe geofences, zonder initiële trigger (sta je er al, dan pas bij de volgende keer). */
        final List<Fence> add = new ArrayList<>();
        /**
         * Aankomstcirkels die van onderweg-vergroot terug naar normaal gaan (uitgestapt). Met initiële trigger: sta je
         * er nu binnen, dan ben je net aangekomen, en een nog niet afgeleverde melding van de grote cirkel is weg.
         */
        final List<Fence> addArrived = new ArrayList<>();
    }

    /**
     * Alleen wat veranderd is: ongewijzigde geofences blijven staan, zodat een aankomst of vertrek die Play-diensten
     * nog niet afgeleverd hebben niet verloren gaat bij het opnieuw registreren.
     */
    static Diff diff(Collection<String> registered, List<Fence> fences) {
        Diff d = new Diff();
        Set<String> wanted = new HashSet<>();
        for (Fence f : fences) wanted.add(requestId(f));
        Set<String> wasRoad = new HashSet<>();
        for (String rid : registered) {
            if (!wanted.contains(rid)) d.remove.add(rid);
            if (!roadMode(rid).isEmpty()) wasRoad.add(taskId(rid));
        }
        for (Fence f : fences) {
            if (registered.contains(requestId(f))) continue;
            if (!f.exit && f.mode.isEmpty() && wasRoad.contains(f.id)) d.addArrived.add(f);
            else d.add.add(f);
        }
        return d;
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
