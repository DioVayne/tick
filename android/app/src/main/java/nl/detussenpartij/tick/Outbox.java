package nl.detussenpartij.tick;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Wachtrij van wijzigingen uit de widget en de snelle-taak-popup (afvinken, ongedaan maken, toevoegen), zonder Android,
 * zodat het testbaar is. De app bewaart eerst lokaal (Prefs "outbox", een JSON-array in volgorde) en stuurt later
 * (Sync.flush); zo werkt de widget ook offline.
 *
 * Een item: {k: eigen sleutel, op: done|reopen|create, id: taak-id, body: JSON-tekst voor de server,
 * at: moment van de tik (done/reopen) of van toevoegen, q: moment in de wachtrij, title: voor een melding,
 * tries: mislukte pogingen, next: niet voor dit moment opnieuw (ms), sending: nu onderweg,
 * task: (alleen create) de taak zoals de widget hem toont tot de server hem kent}.
 *
 * Dubbel versturen kan geen kwaad: afvinken en ongedaan maken dragen een actie-id (TickBody) en een herhalende taak de
 * keer (`occurrence`); toevoegen draagt een eigen uuid als `id`, en POST /api/tasks geeft bij een bekend id de bestaande
 * taak terug. Daarom is het tijdelijke id van een offline toegevoegde taak meteen ook zijn echte id.
 */
final class Outbox {
    static final String DONE = "done";
    static final String REOPEN = "reopen";
    static final String CREATE = "create";

    /** Eerste wachttijd na een mislukte poging; daarna steeds twee keer zo lang. */
    static final long BACKOFF_MS = 30_000;
    /** Geen verbinding: hooguit zo lang wachten, zodat het snel weer gaat als het netwerk terug is. */
    static final long MAX_OFFLINE_BACKOFF_MS = 5 * 60_000;
    /** Serverfout (5xx, 408, 429): hooguit zo lang wachten. */
    static final long MAX_SERVER_BACKOFF_MS = 60 * 60_000;
    /** Een wijziging die zo lang in de wachtrij staat (of al eens mislukte), noemt de widget. */
    static final long QUIET_MS = 15_000;
    /** Zo lang toont de widget dat een wijziging niet kon (de server wees hem af). */
    static final long NOTE_MS = 5 * 60_000;

    /** Wat er na een verzoek met een item gebeurt. */
    enum Outcome {
        /** De server heeft hem (2xx): weg uit de wachtrij. */
        SENT,
        /** Serverfout of te druk: later opnieuw, met een langere wachttijd. */
        RETRY,
        /** Geen verbinding: later opnieuw, en nu niet verder proberen. */
        OFFLINE,
        /** De server wijst hem af (4xx: weg, geen toegang, ongeldig): niet opnieuw, de rest van deze taak ook niet. */
        DROPPED,
        /** De sleutel geldt niet meer (401): de app vergeet het account, dus ook deze wachtrij. */
        STOP
    }

    static JSONObject op(String kind, String id, String body, long at, long now, String title, JSONObject task) {
        JSONObject o = new JSONObject();
        try {
            o.put("k", kind + ":" + id + ":" + at + ":" + now);
            o.put("op", kind);
            o.put("id", id);
            o.put("body", body == null ? "{}" : body);
            o.put("at", at);
            o.put("q", now);
            o.put("title", title == null ? "" : title);
            o.put("tries", 0);
            o.put("next", 0);
            if (task != null) o.put("task", task);
        } catch (Exception ignored) {
            // put met een geldige sleutel faalt niet
        }
        return o;
    }

    /** Achteraan in de wachtrij. */
    static void add(JSONArray ops, JSONObject op) {
        ops.put(op);
    }

    /**
     * Ongedaan maken van een afvinktik die nog niet weg is: haalt hem uit de wachtrij en geeft true; dan hoeft de server
     * niets te horen. False als hij al verstuurd is of nu onderweg is: dan moet er een reopen achteraan.
     */
    static boolean cancelDone(JSONArray ops, String id, long tickedAt) {
        for (int i = ops.length() - 1; i >= 0; i--) {
            JSONObject o = ops.optJSONObject(i);
            if (o == null || !DONE.equals(o.optString("op")) || !id.equals(o.optString("id"))) continue;
            if (o.optLong("at") != tickedAt || o.optBoolean("sending")) return false;
            ops.remove(i);
            return true;
        }
        return false;
    }

    /**
     * Het volgende item om te versturen, of null. Per taak in volgorde: zolang een eerder item van dezelfde taak nog
     * staat (of in `skip` zit, omdat het net mislukte), komt een later item van die taak niet aan de beurt. Een item
     * dat nog moet wachten (next) slaat de wachtrij over, tenzij force (de gebruiker deed net iets of vroeg erom).
     */
    static JSONObject next(JSONArray ops, long now, boolean force, Set<String> skip) {
        Set<String> blocked = new HashSet<>(skip);
        for (int i = 0; i < ops.length(); i++) {
            JSONObject o = ops.optJSONObject(i);
            if (o == null) continue;
            String id = o.optString("id");
            if (blocked.contains(id)) continue;
            if (!force && o.optLong("next") > now) {
                blocked.add(id);
                continue;
            }
            return o;
        }
        return null;
    }

    static void markSending(JSONArray ops, String key, boolean sending) {
        JSONObject o = find(ops, key);
        if (o == null) return;
        try {
            o.put("sending", sending);
        } catch (Exception ignored) {
        }
    }

    /** POST-pad voor een item. */
    static String path(JSONObject op, String encodedId) {
        String kind = op.optString("op");
        if (CREATE.equals(kind)) return "/api/tasks";
        return "/api/tasks/" + encodedId + "/" + (REOPEN.equals(kind) ? "reopen" : "done");
    }

    /** De HTTP-status uit de foutmelding van Api.call ("HTTP 404"), of -1 als er geen antwoord kwam. */
    static int httpCode(String message) {
        if (message == null || !message.startsWith("HTTP ")) return -1;
        try {
            return Integer.parseInt(message.substring(5).trim());
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    /** Uitkomst bij een HTTP-status (2xx is gelukt; -1 is geen verbinding). */
    static Outcome outcome(int code) {
        if (code >= 200 && code < 300) return Outcome.SENT;
        if (code < 0) return Outcome.OFFLINE;
        if (code == 401) return Outcome.STOP;
        if (code == 408 || code == 429 || code >= 500) return Outcome.RETRY;
        return Outcome.DROPPED;
    }

    /** Wachttijd na `tries` mislukte pogingen. */
    static long backoff(int tries, Outcome o) {
        long max = o == Outcome.OFFLINE ? MAX_OFFLINE_BACKOFF_MS : MAX_SERVER_BACKOFF_MS;
        int n = Math.max(0, Math.min(tries - 1, 20));
        return Math.min(max, BACKOFF_MS << n);
    }

    /**
     * Verwerkt de uitkomst van het item met sleutel `key` in de wachtrij. Geeft de items terug die eruit gingen: bij
     * SENT dat item, bij DROPPED dat item en alle latere van dezelfde taak (een afvinktik op een taak die niet aangemaakt
     * kon worden, of een reopen op een taak die weg is, heeft geen zin meer).
     */
    static List<JSONObject> settle(JSONArray ops, String key, Outcome o, long now) {
        List<JSONObject> removed = new ArrayList<>();
        int at = indexOf(ops, key);
        if (at < 0) return removed;
        JSONObject op = ops.optJSONObject(at);
        switch (o) {
            case SENT:
                ops.remove(at);
                removed.add(op);
                break;
            case DROPPED:
                String id = op.optString("id");
                for (int i = ops.length() - 1; i >= at; i--) {
                    JSONObject x = ops.optJSONObject(i);
                    if (x != null && id.equals(x.optString("id"))) {
                        ops.remove(i);
                        removed.add(0, x);
                    }
                }
                break;
            case RETRY:
            case OFFLINE:
                try {
                    int tries = op.optInt("tries") + 1;
                    op.put("tries", tries);
                    op.put("next", now + backoff(tries, o));
                    op.put("sending", false);
                } catch (Exception ignored) {
                }
                break;
            default:
                try {
                    op.put("sending", false);
                } catch (Exception ignored) {
                }
        }
        return removed;
    }

    /**
     * Hoeveel wijzigingen de widget als wachtend noemt: alle, zodra er één al eens mislukte of langer dan QUIET_MS
     * staat; anders 0 (dan gaat het gewoon even en hoeft er niets te staan).
     */
    static int waiting(JSONArray ops, long now) {
        for (int i = 0; i < ops.length(); i++) {
            JSONObject o = ops.optJSONObject(i);
            if (o != null && (o.optInt("tries") > 0 || now - o.optLong("q") > QUIET_MS)) return ops.length();
        }
        return 0;
    }

    /** Wanneer er weer iets te versturen valt: de vroegste `next` van het eerste item per taak (0 = nu), of -1 als leeg. */
    static long nextDue(JSONArray ops) {
        Set<String> seen = new HashSet<>();
        long best = -1;
        for (int i = 0; i < ops.length(); i++) {
            JSONObject o = ops.optJSONObject(i);
            if (o == null || !seen.add(o.optString("id"))) continue;
            long n = o.optLong("next");
            if (best < 0 || n < best) best = n;
        }
        return best;
    }

    /** Taken met een afvinktik in de wachtrij: Sync laat die in Prefs.pending staan (dus verborgen) tot hij weg is. */
    static Set<String> doneIds(JSONArray ops) {
        Set<String> out = new HashSet<>();
        for (int i = 0; i < ops.length(); i++) {
            JSONObject o = ops.optJSONObject(i);
            if (o != null && DONE.equals(o.optString("op"))) out.add(o.optString("id"));
        }
        return out;
    }

    /**
     * De lijst, met de taken uit de wachtrij die de server nog niet kent erbij: bovenaan na de vastgezette, net waar de
     * server een nieuwe taak zet (de nieuwste eerst). Een taak die er al in staat, blijft zoals hij is.
     */
    static JSONArray withLocal(JSONArray list, JSONArray ops) {
        List<JSONObject> out = new ArrayList<>();
        Set<String> present = new HashSet<>();
        for (int i = 0; i < list.length(); i++) {
            JSONObject t = list.optJSONObject(i);
            if (t == null) continue;
            out.add(t);
            present.add(t.optString("id"));
        }
        for (int i = 0; i < ops.length(); i++) {
            JSONObject o = ops.optJSONObject(i);
            if (o == null || !CREATE.equals(o.optString("op"))) continue;
            JSONObject task = o.optJSONObject("task");
            if (task == null || !present.add(o.optString("id"))) continue;
            int at = 0;
            while (at < out.size() && out.get(at).optBoolean("pinned") && out.get(at).isNull("parent_id")) at++;
            out.add(at, task);
        }
        JSONArray arr = new JSONArray();
        for (JSONObject t : out) arr.put(t);
        return arr;
    }

    /** De lijst met `task` (van de server) in plaats van de taak met hetzelfde id; zonder die taak: ongewijzigd. */
    static JSONArray replace(JSONArray list, JSONObject task) {
        String id = task.optString("id");
        JSONArray arr = new JSONArray();
        for (int i = 0; i < list.length(); i++) {
            JSONObject t = list.optJSONObject(i);
            arr.put(t != null && id.equals(t.optString("id")) ? task : t);
        }
        return arr;
    }

    /** De lijst zonder de taak met dit id (een toegevoegde taak die de server afwees). */
    static JSONArray without(JSONArray list, String id) {
        JSONArray arr = new JSONArray();
        for (int i = 0; i < list.length(); i++) {
            JSONObject t = list.optJSONObject(i);
            if (t != null && !id.equals(t.optString("id"))) arr.put(t);
        }
        return arr;
    }

    private static JSONObject find(JSONArray ops, String key) {
        int i = indexOf(ops, key);
        return i < 0 ? null : ops.optJSONObject(i);
    }

    private static int indexOf(JSONArray ops, String key) {
        for (int i = 0; i < ops.length(); i++) {
            JSONObject o = ops.optJSONObject(i);
            if (o != null && key.equals(o.optString("k"))) return i;
        }
        return -1;
    }

    private Outbox() {}
}
