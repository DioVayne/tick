package nl.detussenpartij.tick;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Logboek van de locatiemeldingen op dit toestel: wanneer Tick plekken bij Android aanmeldde, wat Android meldde, wat
 * het vangnet zag en of er een melding kwam (en zo niet, waarom). Zo is een melding die uitblijft na te gaan in
 * "Tick op deze telefoon". Alleen tijden, aantallen, taaktitels, nauwkeurigheid en redenen; nooit coördinaten of
 * afstanden tot een plek. Puur Java, zodat het zonder toestel te testen is; de teksten maakt MainActivity.
 */
final class GeoLog {
    /** Zoveel regels blijven bewaard; oudere vallen eraf. */
    static final int KEEP = 80;
    /** Langere taaktitels worden ingekort. */
    static final int TITLE_MAX = 60;

    /** Plekken aangemeld bij Android. Velden: n (totaal), added (nieuw), full (alles opnieuw), why (Why.*). */
    static final String REG = "reg";
    /** Aanmelden mislukt. Veld: why (korte foutnaam). */
    static final String REG_FAILED = "regfail";
    /** Android meldde een aankomst of vertrek. Velden: exit, n (aantal plekken). */
    static final String EVENT = "event";
    /** Android meldde een fout in plaats van een aankomst of vertrek. Veld: code. */
    static final String EVENT_ERROR = "eventerr";
    /** Melding wel of niet getoond. Velden: title, result (NotifyDecision.Result-naam, SHOWN of OFF), net. */
    static final String DECIDE = "decide";
    /** Het vangnet keek waar je bent. Velden: tasks (bewaakte taken), acc (nauwkeurigheid, m), caught. */
    static final String NET = "net";
    /** Het vangnet vond geen locatie. */
    static final String NET_NO_FIX = "netnofix";

    /** Uitkomst van DECIDE naast de namen van NotifyDecision.Result. */
    static final String SHOWN = "SHOWN";
    static final String OFF = "OFF";

    /** Waarom alle plekken opnieuw aangemeld werden. */
    static final class Why {
        /** Alleen wat veranderd was (geen volledige aanmelding). */
        static final String CHANGED = "";
        /** Herstart, update, toestemming, koppelen of zelf gevraagd. */
        static final String START = "start";
        /** De dagelijkse controle. */
        static final String DAILY = "daily";
        /** Android was ze kwijt (locatie uit, of Tick was gestopt). */
        static final String LOST = "lost";
        /** Het vangnet ving een aankomst die Android niet (op tijd) meldde. */
        static final String MISSED = "missed";

        private Why() {}
    }

    static JSONObject reg(long at, int total, int added, boolean full, String why) {
        JSONObject e = entry(at, REG);
        try {
            e.put("n", total).put("added", added).put("full", full).put("why", why == null ? "" : why);
        } catch (Exception ignored) {
        }
        return e;
    }

    static JSONObject regFailed(long at, String why) {
        return with(entry(at, REG_FAILED), "why", why == null ? "" : why);
    }

    static JSONObject event(long at, boolean exit, int places) {
        JSONObject e = entry(at, EVENT);
        try {
            e.put("exit", exit).put("n", places);
        } catch (Exception ignored) {
        }
        return e;
    }

    static JSONObject eventError(long at, int code) {
        JSONObject e = entry(at, EVENT_ERROR);
        try {
            e.put("code", code);
        } catch (Exception ignored) {
        }
        return e;
    }

    /** result: de naam van een NotifyDecision.Result, SHOWN of OFF. net: de beslissing kwam van het vangnet. */
    static JSONObject decide(long at, String title, String result, boolean net) {
        JSONObject e = entry(at, DECIDE);
        try {
            e.put("title", title(title)).put("result", result).put("net", net);
        } catch (Exception ignored) {
        }
        return e;
    }

    /** tasks: aantal bewaakte aankomsttaken; accuracy in m (NaN als onbekend); caught: aantal meldingen dat het gaf. */
    static JSONObject net(long at, int tasks, double accuracy, int caught) {
        JSONObject e = entry(at, NET);
        try {
            e.put("tasks", tasks).put("caught", caught);
            if (!Double.isNaN(accuracy)) e.put("acc", Math.round(accuracy));
        } catch (Exception ignored) {
        }
        return e;
    }

    static JSONObject netNoFix(long at) {
        return entry(at, NET_NO_FIX);
    }

    /**
     * Voegt een regel toe en houdt de laatste KEEP over. Onleesbare opslag telt als leeg. Het vangnet kijkt elke 15
     * minuten; zolang dat niets oplevert en er niets anders gebeurt, wordt de vorige vangnetregel bijgewerkt (times,
     * since) in plaats van een nieuwe toegevoegd, zodat het logboek niet volloopt.
     */
    static String add(String json, JSONObject e) {
        JSONArray old = parse(json);
        JSONObject last = old.length() == 0 ? null : old.optJSONObject(old.length() - 1);
        if (last != null && sameQuietNet(last, e)) {
            try {
                e.put("times", last.optInt("times", 1) + 1).put("since", last.optLong("since", last.optLong("at")));
            } catch (Exception ignored) {
            }
            JSONArray out = new JSONArray();
            for (int i = 0; i < old.length() - 1; i++) out.put(old.opt(i));
            out.put(e);
            return out.toString();
        }
        JSONArray out = new JSONArray();
        for (int i = Math.max(0, old.length() + 1 - KEEP); i < old.length(); i++) out.put(old.opt(i));
        out.put(e);
        return out.toString();
    }

    /** Twee vangnetregels van dezelfde soort, voor evenveel taken, die allebei geen melding gaven. */
    private static boolean sameQuietNet(JSONObject a, JSONObject b) {
        String kind = b.optString("kind");
        if (!kind.equals(a.optString("kind"))) return false;
        if (NET_NO_FIX.equals(kind)) return true;
        return NET.equals(kind) && a.optInt("caught") == 0 && b.optInt("caught") == 0 && a.optInt("tasks") == b.optInt("tasks");
    }

    /** De laatste max regels, nieuwste eerst. */
    static List<JSONObject> newestFirst(String json, int max) {
        JSONArray arr = parse(json);
        List<JSONObject> out = new ArrayList<>();
        for (int i = arr.length() - 1; i >= 0 && out.size() < max; i--) {
            JSONObject e = arr.optJSONObject(i);
            if (e != null) out.add(e);
        }
        return out;
    }

    /** Titel ingekort tot TITLE_MAX tekens (met …), nooit midden in een teken. */
    static String title(String t) {
        String s = t == null ? "" : t.trim();
        if (s.length() <= TITLE_MAX) return s;
        int end = TITLE_MAX - 1;
        if (Character.isHighSurrogate(s.charAt(end - 1))) end--;
        return s.substring(0, end).trim() + "…";
    }

    private static JSONObject entry(long at, String kind) {
        JSONObject e = new JSONObject();
        try {
            e.put("at", at).put("kind", kind);
        } catch (Exception ignored) {
        }
        return e;
    }

    private static JSONObject with(JSONObject e, String key, String value) {
        try {
            e.put(key, value);
        } catch (Exception ignored) {
        }
        return e;
    }

    private static JSONArray parse(String json) {
        if (json == null) return new JSONArray();
        try {
            return new JSONArray(json);
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    private GeoLog() {}
}
