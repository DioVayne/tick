package nl.detussenpartij.tick;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.Collator;
import java.time.Instant;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/** Wat een widget toont: welke taken, in welke volgorde, en de lijstkleuren. Zonder Android, zodat het testbaar is. */
final class WidgetFilter {
    /** Weergave "Vandaag & te laat"; "" is Alles, anders een lijstnaam. */
    static final String TODAY = "@today";
    static final String INBOX = "Inbox";

    /** Lege lijstnaam is Inbox, net als normName in public/lists.js. */
    static String normName(String name) {
        String n = name == null ? "" : name.trim();
        return n.isEmpty() ? INBOX : n;
    }

    private static String listOf(JSONObject t) {
        return normName(t.isNull("list") ? null : t.optString("list"));
    }

    private static Instant remindAt(JSONObject t) {
        String r = Sync.remindAt(t);
        if (r.isEmpty()) return null;
        try {
            return Instant.parse(r);
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * De hoofdtaken voor een weergave. Alles en een lijst houden de volgorde van de server (vastgezet, dan positie);
     * Vandaag houdt de taken met een herinnering tot middernacht, op tijd gesorteerd, dus te laat bovenaan.
     */
    static List<JSONObject> select(JSONArray tasks, String view, ZonedDateTime now) {
        String v = view == null ? "" : view;
        List<JSONObject> out = new ArrayList<>();
        Instant endOfDay = now.toLocalDate().plusDays(1).atStartOfDay(now.getZone()).toInstant();
        for (int i = 0; i < tasks.length(); i++) {
            JSONObject t = tasks.optJSONObject(i);
            if (t == null || !t.isNull("parent_id")) continue; // alleen hoofdtaken
            if (TODAY.equals(v)) {
                Instant at = remindAt(t);
                if (at == null || !at.isBefore(endOfDay)) continue;
            } else if (!v.isEmpty() && !listOf(t).equalsIgnoreCase(normName(v))) {
                continue;
            }
            out.add(t);
        }
        if (TODAY.equals(v)) out.sort((a, b) -> remindAt(a).compareTo(remindAt(b))); // stabiel: gelijke tijd houdt servervolgorde
        return out;
    }

    /** Aantal open subtaken per hoofdtaak (afgeronde subtaken geeft de API niet mee). */
    static Map<String, Integer> openSubtasks(JSONArray tasks) {
        Map<String, Integer> n = new HashMap<>();
        for (int i = 0; i < tasks.length(); i++) {
            JSONObject t = tasks.optJSONObject(i);
            if (t == null || t.isNull("parent_id")) continue;
            n.merge(t.optString("parent_id"), 1, Integer::sum);
        }
        return n;
    }

    /** Alle lijstnamen die in de taken voorkomen. */
    static Set<String> listNames(JSONArray tasks) {
        Set<String> names = new HashSet<>();
        for (int i = 0; i < tasks.length(); i++) {
            JSONObject t = tasks.optJSONObject(i);
            if (t != null) names.add(listOf(t));
        }
        return names;
    }

    // Lijstkleuren: een letterlijke kopie van listColor/colorMap/slotOf in public/lists.js, zodat de widget dezelfde
    // kleur toont als de pillen in de webapp. Pas je daar iets aan, doe het hier ook (WidgetFilterTest vergelijkt).
    private static final String[] COLORS = {"#e5484d", "#f76b15", "#e8a317", "#d9c62b", "#8bc34a", "#2e9d4f", "#12a594",
            "#00b8d9", "#378add", "#5b5bd6", "#a36bf0", "#d6409f", "#f49ac1", "#a1745a"};
    private static final int STEP = 5;

    private static int slotOf(String name) {
        long h = 0;
        String s = name.trim().toLowerCase(Locale.ROOT);
        for (int i = 0; i < s.length(); ) {
            int c = s.codePointAt(i);
            h = (h * 31 + c) & 0xFFFFFFFFL;
            i += Character.charCount(c);
        }
        return (int) (h % COLORS.length);
    }

    /** De kleur van een lijst (#rrggbb), gegeven alle lijstnamen; null voor Inbox. */
    static String listColor(String name, Collection<String> names, Locale locale) {
        if (INBOX.equals(normName(name))) return null;
        Collator coll = Collator.getInstance(locale);
        coll.setStrength(Collator.PRIMARY); // localeCompare met sensitivity 'base'
        List<String> own = new ArrayList<>();
        for (String n : names) if (!INBOX.equals(normName(n))) own.add(n);
        if (!own.contains(name)) own.add(name);
        own.sort((a, b) -> {
            int c = coll.compare(a, b);
            return c != 0 ? c : a.compareTo(b);
        });
        Set<Integer> used = new HashSet<>();
        for (String n : own) {
            if (used.size() == COLORS.length) used = new HashSet<>(); // meer lijsten dan kleuren: dan opnieuw rond
            int slot = slotOf(n);
            while (used.contains(slot)) slot = (slot + STEP) % COLORS.length;
            used.add(slot);
            if (n.equals(name)) return COLORS[slot];
        }
        return COLORS[slotOf(name)];
    }

    /**
     * Een lijstkleur die op de pil leesbaar is: zo nodig in stappen van 5% gemengd naar wit (donkere modus) of zwart
     * (lichte modus), tot het contrast met de pil minstens 4,5:1 is (WCAG voor kleine tekst). Kleuren als #rrggbb.
     */
    static int readable(int color, int pill, boolean dark) {
        int target = dark ? 0xFFFFFF : 0x000000;
        int c = color & 0xFFFFFF;
        for (int step = 0; step <= 20 && contrast(c, pill) < 4.5; step++) c = mix(color & 0xFFFFFF, target, step * 0.05f);
        return 0xFF000000 | c;
    }

    /** Contrastverhouding (WCAG) tussen twee kleuren (0xRRGGBB). */
    static double contrast(int a, int b) {
        double la = luminance(a), lb = luminance(b);
        return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    }

    private static double luminance(int c) {
        return 0.2126 * channel(c >> 16) + 0.7152 * channel(c >> 8) + 0.0722 * channel(c);
    }

    private static double channel(int v) {
        double x = (v & 0xFF) / 255.0;
        return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    }

    /** Mengt a met share van b (0xRRGGBB). */
    private static int mix(int a, int b, float share) {
        int r = Math.round(((a >> 16) & 0xFF) * (1 - share) + ((b >> 16) & 0xFF) * share);
        int g = Math.round(((a >> 8) & 0xFF) * (1 - share) + ((b >> 8) & 0xFF) * share);
        int bl = Math.round((a & 0xFF) * (1 - share) + (b & 0xFF) * share);
        return (r << 16) | (g << 8) | bl;
    }

    private WidgetFilter() {}
}
