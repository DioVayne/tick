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

/**
 * Welke taken een geofence krijgen. Puur Java, zodat het zonder toestel te testen is.
 * Een taak kan meerdere plekken hebben (location.more): elke plek krijgt een eigen geofence, en de eerste die afgaat
 * geeft de ene melding voor de hele taak (daarna gaan de andere van die taak weg).
 */
final class GeoPlan {
    /** Android staat maximaal 100 geofences per app toe. */
    static final int MAX = 100;

    static final class Fence {
        final String id, title, name, key;
        /** Welke plek van de taak: 0 = de eerste (location zelf), 1.. = location.more[idx - 1]. */
        final int idx;
        final double lat, lng;
        /** Straal van de geofence: de ingestelde, of onderweg de vergrote. */
        final float radius;
        final boolean exit;
        /** "car" of "bike" als de cirkel onderweg vergroot is, anders "". */
        final String mode;

        Fence(String id, String title, String name, String key, double lat, double lng, float radius, boolean exit, String mode) {
            this(id, 0, title, name, key, lat, lng, radius, exit, mode);
        }

        Fence(String id, int idx, String title, String name, String key, double lat, double lng, float radius, boolean exit, String mode) {
            this.id = id;
            this.idx = idx;
            this.key = key;
            this.title = title;
            this.name = name;
            this.lat = lat;
            this.lng = lng;
            this.radius = radius;
            this.exit = exit;
            this.mode = mode;
        }

        /** Taak-id, met "/idx" erachter voor een extra plek (zo heeft de eerste plek het oude formaat). */
        String fid() {
            return GeoPlan.fid(id, idx);
        }
    }

    static String fid(String id, int idx) {
        return idx == 0 ? id : id + "/" + idx;
    }

    /**
     * Herkent de plek(ken) van een taak: verandert er een, dan mag dezelfde taak opnieuw een melding geven. Met een
     * plek de leesbare vorm van altijd (zodat bestaande geofences en meldingen blijven kloppen); met meer plekken een
     * korte hash over allemaal, want de key staat in de request-id en die mag hooguit 100 tekens zijn.
     */
    static String key(JSONObject location) {
        String one = location.optDouble("lat") + "|" + location.optDouble("lng") + "|"
                + location.optDouble("radius") + "|" + trigger(location);
        List<JSONObject> all = places(location);
        if (all.size() == 1) return one;
        StringBuilder sb = new StringBuilder(one);
        for (int i = 1; i < all.size(); i++) {
            JSONObject m = all.get(i);
            sb.append(';').append(m.optDouble("lat")).append('|').append(m.optDouble("lng")).append('|').append(m.optDouble("radius"));
        }
        return "m" + fnv64(sb.toString());
    }

    /** FNV-1a (64 bit) als 16 hex-tekens: kort, stabiel, en zonder '#', '@' of '/' (die scheiden de request-id). */
    static String fnv64(String s) {
        long h = 0xcbf29ce484222325L;
        for (int i = 0; i < s.length(); i++) {
            h ^= s.charAt(i);
            h *= 0x100000001b3L;
        }
        String hex = Long.toHexString(h);
        return "0000000000000000".substring(hex.length()) + hex;
    }

    /** Alle plekken van een taak, de eerste voorop (location zelf, dan location.more). Een kapotte extra plek telt niet. */
    static List<JSONObject> places(JSONObject location) {
        List<JSONObject> out = new ArrayList<>();
        out.add(location);
        JSONArray more = location.optJSONArray("more");
        for (int i = 0; more != null && i < more.length(); i++) {
            JSONObject m = more.optJSONObject(i);
            if (m != null && m.has("lat") && m.has("lng") && m.has("radius")) out.add(m);
        }
        return out;
    }

    /** Plek nummer idx van een taak (0 = de eerste), of de eerste als die er niet (meer) is. */
    static JSONObject place(JSONObject location, int idx) {
        List<JSONObject> all = places(location);
        return idx >= 0 && idx < all.size() ? all.get(idx) : location;
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
        return plan(tasks, fired, max, roadRadii, mode).fences;
    }

    /** De gekozen geofences, en hoeveel taken met een plek er niet meer bij pasten. */
    static final class Plan {
        final List<Fence> fences = new ArrayList<>();
        /** Taken met een plek die nog moet afgaan, maar waarvoor geen ruimte meer was (boven max). */
        int skipped;
    }

    /**
     * Zie select. Een taak krijgt al zijn plekken of geen: past hij niet meer, dan telt hij als overgeslagen en kan een
     * latere taak met minder plekken er nog wel bij. roadRadii is per geofence (Fence.fid).
     */
    static Plan plan(JSONArray tasks, JSONObject fired, int max, Map<String, Float> roadRadii, String mode) {
        Plan p = new Plan();
        List<Fence> out = p.fences;
        for (int i = 0; i < tasks.length(); i++) {
            JSONObject t = tasks.optJSONObject(i);
            if (t == null || t.optBoolean("done") || t.optBoolean("location_notified")) continue;
            JSONObject loc = t.optJSONObject("location");
            if (loc == null) continue;
            String id = t.optString("id");
            String key = key(loc);
            if (id.isEmpty() || key.equals(fired.optString(id, null))) continue;
            boolean exit = isExit(loc);
            List<JSONObject> all = places(loc);
            if (out.size() + all.size() > max) {
                p.skipped++;
                continue;
            }
            for (int idx = 0; idx < all.size(); idx++) {
                JSONObject pl = all.get(idx);
                float radius = (float) pl.optDouble("radius");
                Float road = exit ? null : roadRadii.get(fid(id, idx));
                boolean bigger = road != null && road > radius && mode != null && !mode.isEmpty();
                out.add(new Fence(id, idx, t.optString("title"), pl.optString("name"), key, pl.optDouble("lat"),
                        pl.optDouble("lng"), bigger ? road : radius, exit, bigger ? mode : ""));
            }
        }
        return p;
    }

    /** Gelijk voor dezelfde set geofences, ongeacht de volgorde; anders moet er opnieuw geregistreerd worden. */
    static String signature(List<Fence> fences) {
        TreeMap<String, String> sorted = new TreeMap<>();
        for (Fence f : fences) sorted.put(f.fid(), f.lat + "|" + f.lng + "|" + f.radius + "|" + (f.exit ? "exit" : "enter")
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
        // Een extra plek: "/idx" achter de key. Onderweg vergroot: "@soort:straal" erachter, zodat de melding dat ook
        // weet als de stand al voorbij is (Android meldt vaak pas na het uitstappen).
        return f.id + "#" + f.key + (f.idx == 0 ? "" : "/" + f.idx) + (f.mode.isEmpty() ? "" : "@" + f.mode + ":" + f.radius);
    }

    /** Taak-id uit een request-id; een geofence van een oudere versie heeft alleen het taak-id. */
    static String taskId(String requestId) {
        int i = requestId.lastIndexOf('#');
        return i < 0 ? requestId : requestId.substring(0, i);
    }

    /**
     * Key van de plek uit een request-id, of null als die er niet in staat. Een key bevat zelf nooit '#', '@' of '/'.
     */
    static String fenceKey(String requestId) {
        String rest = keyPart(requestId);
        if (rest == null) return null;
        int slash = rest.indexOf('/');
        return slash < 0 ? rest : rest.substring(0, slash);
    }

    /** Welke plek van de taak bij deze request-id hoort (0 = de eerste, ook bij een oudere geofence). */
    static int placeIndex(String requestId) {
        String rest = keyPart(requestId);
        int slash = rest == null ? -1 : rest.indexOf('/');
        if (slash < 0) return 0;
        try {
            return Integer.parseInt(rest.substring(slash + 1));
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    /** Alles tussen '#' en '@': de key, en bij een extra plek "/idx". */
    private static String keyPart(String requestId) {
        int i = requestId.lastIndexOf('#');
        if (i < 0) return null;
        String rest = requestId.substring(i + 1);
        int at = rest.indexOf('@');
        return at < 0 ? rest : rest.substring(0, at);
    }

    /** De geregistreerde request-ids van deze taken: na een melding gaan ook de andere plekken van de taak weg. */
    static List<String> ofTasks(Collection<String> registered, Collection<String> taskIds) {
        List<String> out = new ArrayList<>();
        for (String rid : registered) if (taskIds.contains(taskId(rid))) out.add(rid);
        return out;
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
            String fid = eq < 0 ? "" : part.substring(0, eq);
            int slash = fid.indexOf('/');
            if (eq >= 0 && taskIds.contains(slash < 0 ? fid : fid.substring(0, slash))) continue;
            sb.append(part).append(';');
        }
        return sb.toString();
    }

    private GeoPlan() {}
}
