package nl.detussenpartij.tick;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Wat een taakrij in de widget toont naast de titel. Zonder Android, zodat het testbaar is; WidgetRows zet het om in
 * views.
 *
 * De titel is het belangrijkst. De metaregel eronder toont alleen wat helpt kiezen, in deze volgorde (wat vooraan staat,
 * valt als laatste weg als de regel te lang is):
 * <ol>
 * <li>tijd van de herinnering (rood als hij voorbij is), altijd;</li>
 * <li>herhaling en plaats als icoontje, alleen in Ruim op een brede widget;</li>
 * <li>de lijst, als de widget meerdere lijsten toont en te smal is voor de pil naast de titel;</li>
 * <li>wie het doet ("Sanne doet dit"), als iemand anders de taak in een gedeelde lijst op zijn naam heeft;</li>
 * <li>open subtaken ("3 subtaken open"), alleen in Ruim;</li>
 * <li>met wie hij gedeeld is ("Gedeeld met Sanne"), alleen in Ruim en als niet al iemand hem doet.</li>
 * </ol>
 * Een kopie (ieder een eigen exemplaar) toont de widget niet: dat zie je in de taak zelf.
 */
final class RowMeta {
    /** De lijstnaam als pil rechts naast de titel. */
    final boolean pill;
    /** De lijstnaam in de metaregel (smalle widget). */
    final boolean listInMeta;
    final boolean time;
    final boolean repeat;
    final boolean place;
    /** Naam van wie de taak doet (iemand anders), of null. */
    final String doer;
    /** Aantal open subtaken, of 0 als die niet getoond worden. */
    final int subtasks;
    /** Met wie hij gedeeld is (de eerste naam), of null als dat niet getoond wordt. */
    final String sharedWith;
    /** Hoeveel anderen er nog meer bij horen dan sharedWith. */
    final int sharedOthers;
    /** Gedeeld, maar (nog) niemand anders doet mee: dan alleen "Gedeeld". */
    final boolean sharedPlain;

    private RowMeta(boolean pill, boolean listInMeta, boolean time, boolean repeat, boolean place, String doer,
                    int subtasks, String sharedWith, int sharedOthers, boolean sharedPlain) {
        this.pill = pill;
        this.listInMeta = listInMeta;
        this.time = time;
        this.repeat = repeat;
        this.place = place;
        this.doer = doer;
        this.subtasks = subtasks;
        this.sharedWith = sharedWith;
        this.sharedOthers = sharedOthers;
        this.sharedPlain = sharedPlain;
    }

    /** Staat er iets in de metaregel? Anders blijft die weg en is de rij één (of twee) titelregels hoog. */
    boolean any() {
        return time || repeat || place || listInMeta || doer != null || subtasks > 0 || sharedWith != null || sharedPlain;
    }

    /**
     * @param t        de taak (zoals GET /api/tasks hem geeft)
     * @param done     net afgevinkt: dan niets (plaats voor Ongedaan maken)
     * @param mixed    de widget toont taken uit meer lijsten (Alles, Vandaag)
     * @param roomy    weergave Ruim
     * @param narrow   smalle widget (WidgetLook.narrow)
     * @param me       mijn user_id ("" als onbekend)
     * @param openSubs aantal open subtaken van deze taak
     * @param hasTime  er is een leesbare herinnering
     */
    static RowMeta plan(JSONObject t, boolean done, boolean mixed, boolean roomy, boolean narrow, String me,
                        int openSubs, boolean hasTime) {
        if (done) return new RowMeta(false, false, false, false, false, null, 0, null, 0, false);
        boolean icons = roomy && !narrow;
        boolean repeat = icons && t.optJSONObject("repeat") != null;
        boolean place = icons && t.optJSONObject("location") != null;
        String doer = doer(t, me);
        int subs = roomy ? Math.max(0, openSubs) : 0;
        String sharedWith = null;
        int others = 0;
        boolean plain = false;
        if (roomy && doer == null && WidgetFilter.isShared(t)) {
            List<String> names = sharedWith(t, me);
            if (names.isEmpty()) plain = true;
            else {
                sharedWith = names.get(0);
                others = names.size() - 1;
            }
        }
        return new RowMeta(mixed && !narrow, mixed && narrow, hasTime, repeat, place, doer, subs, sharedWith, others, plain);
    }

    /**
     * Wie de taak doet: claimed_by ({id, name}) in een gedeelde lijst, als dat iemand anders is dan ik. Zonder mijn id
     * (oude koppeling) toch de naam: die klopt dan nog steeds.
     */
    static String doer(JSONObject t, String me) {
        JSONObject by = t.optJSONObject("claimed_by");
        if (by == null) return null;
        String name = by.optString("name", "").trim();
        if (name.isEmpty()) return null;
        if (me != null && !me.isEmpty() && me.equals(by.optString("id"))) return null;
        return name;
    }

    /**
     * De anderen met wie een gedeelde taak samen gedaan wordt (share: {owner, members}): de eigenaar als ik dat niet
     * ben, en de deelnemers die geaccepteerd hebben, behalve ik. Eigenaar eerst, dan op volgorde van delen.
     */
    static List<String> sharedWith(JSONObject t, String me) {
        List<String> out = new ArrayList<>();
        JSONObject share = t.optJSONObject("share");
        if (share == null) return out;
        String self = me == null ? "" : me;
        JSONObject owner = share.optJSONObject("owner");
        boolean mine = share.optBoolean("mine", false);
        if (owner != null && !mine && !self.equals(owner.optString("id"))) add(out, owner.optString("name"));
        JSONArray members = share.optJSONArray("members");
        if (members != null) {
            for (int i = 0; i < members.length(); i++) {
                JSONObject m = members.optJSONObject(i);
                if (m == null || !"accepted".equals(m.optString("status"))) continue;
                if (!self.isEmpty() && self.equals(m.optString("user_id"))) continue;
                add(out, m.optString("name"));
            }
        }
        return out;
    }

    private static void add(List<String> out, String name) {
        String n = name == null ? "" : name.trim();
        if (!n.isEmpty() && !out.contains(n)) out.add(n);
    }
}
