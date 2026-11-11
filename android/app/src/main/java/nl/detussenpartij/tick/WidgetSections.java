package nl.detussenpartij.tick;

import org.json.JSONObject;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * De rijen van een widget na de statusregel: taken, en in de weergave Ruim kopjes tussen de groepen. De volgorde van
 * de taken verandert nooit (die komt uit WidgetFilter.select); de kopjes volgen wat die volgorde al is:
 * Vandaag en te laat: eerst Te laat, dan Vandaag (op tijd gesorteerd). Alles en een lijst: eerst Vastgezet, dan
 * Overige (vastgezet staat van de server bovenaan). Kopjes alleen als er minstens twee groepen zijn, anders zeggen
 * ze niets. Zonder Android, zodat het testbaar is.
 */
final class WidgetSections {
    static final int OVERDUE = 0, TODAY = 1, PINNED = 2, OTHER = 3;

    /** Eén rij: een kopje (section) of een taak (task, index in de takenlijst). */
    static final class Entry {
        final boolean header;
        final int section;
        final int task;
        /** Na deze taak de grotere ruimte (einde van de vastgezette taken, als er geen kopjes zijn). */
        final boolean groupEnd;

        private Entry(boolean header, int section, int task, boolean groupEnd) {
            this.header = header;
            this.section = section;
            this.task = task;
            this.groupEnd = groupEnd;
        }

        static Entry header(int section) {
            return new Entry(true, section, -1, false);
        }

        static Entry task(int section, int index, boolean groupEnd) {
            return new Entry(false, section, index, groupEnd);
        }
    }

    /** De groep van een taak in een weergave. */
    static int sectionOf(JSONObject t, String view, Instant now) {
        if (WidgetFilter.TODAY.equals(view)) {
            String r = t.isNull("remind_at") ? "" : t.optString("remind_at", ""); // als Sync.remindAt
            try {
                return !r.isEmpty() && Instant.parse(r).isBefore(now) ? OVERDUE : TODAY;
            } catch (Exception e) {
                return TODAY;
            }
        }
        return t.optBoolean("pinned") ? PINNED : OTHER;
    }

    /**
     * De rijen voor deze taken. withHeaders: kopjes tonen als dat kan (weergave Ruim). Liggen de groepen niet netjes
     * achter elkaar (dat hoort niet, maar een taak uit de wachtrij kan ertussen staan), dan geen kopjes: liever geen
     * dan twee keer hetzelfde kopje.
     */
    static List<Entry> plan(List<JSONObject> tasks, String view, Instant now, boolean withHeaders) {
        String v = view == null ? "" : view;
        int n = tasks.size();
        int[] sec = new int[n];
        for (int i = 0; i < n; i++) sec[i] = sectionOf(tasks.get(i), v, now);

        Set<Integer> seen = new HashSet<>();
        boolean contiguous = true;
        int groups = 0;
        for (int i = 0; i < n; i++) {
            if (i > 0 && sec[i] == sec[i - 1]) continue;
            groups++;
            if (!seen.add(sec[i])) contiguous = false;
        }
        boolean headers = withHeaders && contiguous && groups >= 2;

        List<Entry> out = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            if (headers && (i == 0 || sec[i] != sec[i - 1])) out.add(Entry.header(sec[i]));
            // Zonder kopjes markeert extra ruimte het einde van de vastgezette taken (niet in Vandaag: daar telt de tijd).
            boolean groupEnd = !headers && !WidgetFilter.TODAY.equals(v) && sec[i] == PINNED
                    && i + 1 < n && sec[i + 1] != PINNED;
            out.add(Entry.task(sec[i], i, groupEnd));
        }
        return out;
    }

    private WidgetSections() {}
}
