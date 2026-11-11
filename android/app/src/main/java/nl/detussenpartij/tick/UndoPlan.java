package nl.detussenpartij.tick;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Afvinken en ongedaan maken in de widget, zonder Android, zodat het testbaar is.
 *
 * Een tik op het bolletje vinkt af (de server hoort het meteen). De rij blijft dan UNDO_WINDOW_MS op dezelfde plek
 * staan, doorgestreept, met een knop Ongedaan maken. Pas daarna verdwijnt hij. Zo schuift de lijst niet onder je vinger
 * als je snel achter elkaar afvinkt.
 */
final class UndoPlan {
    /** Zo lang blijft een afgevinkte taak (doorgestreept, met Ongedaan maken) op zijn plek staan. */
    static final long UNDO_WINDOW_MS = PendingDecision.UNDO_WINDOW_MS;
    /**
     * Extra tijd voor een tik op Ongedaan maken: sommige launchers verversen de lijst traag, dan staat de knop er nog
     * even. Wie hem ziet en erop tikt, krijgt de taak terug. De server staat dat toe (gewone taak altijd, herhalende
     * taak 15 minuten).
     */
    static final long UNDO_GRACE_MS = 10_000;

    /** Mag een tik op het bolletje (of "Afvinken" in een melding) afvinken? Niet als deze taak al onderweg is. */
    static boolean tick(JSONObject pending, String id) {
        return id != null && !id.isEmpty() && !pending.has(id);
    }

    /**
     * Welke afvinktik maakt een tik op Ongedaan maken ongedaan? rowTickedAt: het moment dat de rij bij de knop meegaf
     * (0 als onbekend). Geeft dat moment terug, of 0 als er niets (meer) ongedaan te maken valt.
     */
    static long undo(JSONObject pending, String id, long rowTickedAt, long now) {
        if (id == null || id.isEmpty()) return 0;
        long pendingAt = pending.has(id) ? pending.optLong(id) : 0;
        long at = rowTickedAt > 0 ? rowTickedAt : pendingAt;
        if (at <= 0) return 0;
        // Een oude rij van een eerdere tik (afgevinkt, teruggezet, opnieuw afgevinkt): niet de nieuwe tik terugdraaien.
        if (pendingAt > 0 && pendingAt != at) return 0;
        if (now - at > UNDO_WINDOW_MS + UNDO_GRACE_MS) return 0;
        return at;
    }

    /** Net afgevinkte taken die nog in het venster zitten (doorgestreept, met Ongedaan maken). */
    static Set<String> held(JSONObject pending, long now) {
        Set<String> out = new HashSet<>();
        Iterator<String> keys = pending.keys();
        while (keys.hasNext()) {
            String id = keys.next();
            if (now - pending.optLong(id) <= UNDO_WINDOW_MS) out.add(id);
        }
        return out;
    }

    /**
     * De nieuwe lijst van de server, maar met de taken in `held` zoals ze in de oude lijst stonden en op hun oude plek:
     * een gewone taak die de server al als afgerond weglaat blijft staan, en een herhalende taak die de server al naar de
     * volgende keer schoof houdt zijn oude herinnering (en dus zijn plek in Vandaag). Een taak die niet in de oude lijst
     * stond, komt zoals de server hem geeft.
     */
    static JSONArray merge(JSONArray oldCache, JSONArray server, Set<String> held) {
        if (held.isEmpty() || oldCache == null) return server;
        Map<String, JSONObject> old = new HashMap<>();
        List<String> oldOrder = new ArrayList<>();
        for (int i = 0; i < oldCache.length(); i++) {
            JSONObject t = oldCache.optJSONObject(i);
            if (t == null) continue;
            String id = t.optString("id");
            old.put(id, t);
            oldOrder.add(id);
        }
        List<JSONObject> out = new ArrayList<>();
        Set<String> present = new HashSet<>();
        for (int i = 0; i < server.length(); i++) {
            JSONObject t = server.optJSONObject(i);
            if (t == null) continue;
            String id = t.optString("id");
            present.add(id);
            out.add(held.contains(id) && old.containsKey(id) ? old.get(id) : t);
        }
        // Vastgehouden taken die de server niet meer geeft: terug direct na de taak die er in de oude lijst voor stond.
        for (int i = 0; i < oldOrder.size(); i++) {
            String id = oldOrder.get(i);
            if (!held.contains(id) || present.contains(id)) continue;
            int at = 0;
            for (int j = i - 1; j >= 0; j--) {
                int k = indexOf(out, oldOrder.get(j));
                if (k >= 0) {
                    at = k + 1;
                    break;
                }
            }
            out.add(at, old.get(id));
            present.add(id);
        }
        JSONArray arr = new JSONArray();
        for (JSONObject t : out) arr.put(t);
        return arr;
    }

    private static int indexOf(List<JSONObject> list, String id) {
        for (int i = 0; i < list.size(); i++) if (id.equals(list.get(i).optString("id"))) return i;
        return -1;
    }

    private UndoPlan() {}
}
