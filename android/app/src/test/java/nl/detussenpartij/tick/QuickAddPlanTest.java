package nl.detussenpartij.tick;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Collections;
import java.util.List;

import org.junit.Test;

public class QuickAddPlanTest {
    // Dinsdag 3 november 2026.
    private static final LocalDateTime NOW = LocalDateTime.of(2026, 11, 3, 14, 25);

    @Test
    public void todayIsTheNextWholeHour() {
        assertEquals(LocalDateTime.of(2026, 11, 3, 15, 0), QuickAddPlan.today(NOW));
    }

    @Test
    public void todayAfterElevenIsGone() {
        assertNull(QuickAddPlan.today(LocalDateTime.of(2026, 11, 3, 23, 10)));
    }

    @Test
    public void tomorrowAtNine() {
        assertEquals(LocalDateTime.of(2026, 11, 4, 9, 0), QuickAddPlan.tomorrow(NOW));
    }

    @Test
    public void nextWeekFollowsTheFirstDay() {
        assertEquals(LocalDateTime.of(2026, 11, 9, 9, 0), QuickAddPlan.nextWeek(NOW, DayOfWeek.MONDAY));
        assertEquals(LocalDateTime.of(2026, 11, 8, 9, 0), QuickAddPlan.nextWeek(NOW, DayOfWeek.SUNDAY));
        // Op maandag zelf: de maandag erna.
        assertEquals(LocalDateTime.of(2026, 11, 16, 9, 0), QuickAddPlan.nextWeek(LocalDateTime.of(2026, 11, 9, 8, 0), DayOfWeek.MONDAY));
    }

    @Test
    public void rulesUseTheStartDay() {
        LocalDate tue = NOW.toLocalDate();
        assertNull(QuickAddPlan.rule(QuickAddPlan.Repeat.NONE, tue));
        assertEquals("FREQ=DAILY", QuickAddPlan.rule(QuickAddPlan.Repeat.DAILY, tue));
        assertEquals("FREQ=WEEKLY;BYDAY=TU", QuickAddPlan.rule(QuickAddPlan.Repeat.WEEKLY, tue));
        assertEquals("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU", QuickAddPlan.rule(QuickAddPlan.Repeat.BIWEEKLY, tue));
        assertEquals("FREQ=MONTHLY;BYMONTHDAY=3", QuickAddPlan.rule(QuickAddPlan.Repeat.MONTHLY, tue));
        assertEquals("FREQ=YEARLY", QuickAddPlan.rule(QuickAddPlan.Repeat.YEARLY, tue));
        assertEquals("FREQ=WEEKLY;BYDAY=SU", QuickAddPlan.rule(QuickAddPlan.Repeat.WEEKLY, LocalDate.of(2026, 11, 8)));
    }

    @Test
    public void radiusFollowsTheTriggerUnlessThePlaceHasOne() throws Exception {
        QuickAddPlan.Place here = new QuickAddPlan.Place("Hier", 52.1, 5.1, null);
        assertEquals(500, here.radius(false));
        assertEquals(200, here.radius(true));
        QuickAddPlan.Place fav = new QuickAddPlan.Place("Thuis", 52.1, 5.1, 300);
        assertEquals(300, fav.radius(true));
        JSONObject j = here.toJson(true);
        assertEquals("exit", j.getString("trigger"));
        assertEquals(200, j.getInt("radius"));
        assertEquals(52.1, j.getDouble("lat"), 0);
    }

    @Test
    public void shortNameIsThePartBeforeTheFirstComma() {
        assertEquals("Albert Heijn", QuickAddPlan.shortName("Albert Heijn, Dorpsstraat 1, Utrecht, Nederland"));
        assertEquals("Utrecht", QuickAddPlan.shortName(" Utrecht "));
        assertEquals(100, QuickAddPlan.shortName("x".repeat(150) + ", y").length());
    }

    private static JSONObject task(String updated, String place, String trigger) throws Exception {
        JSONObject t = new JSONObject().put("updated_at", updated);
        if (place != null) t.put("location", new JSONObject().put("name", place).put("lat", 52).put("lng", 5).put("radius", 250).put("trigger", trigger));
        return t;
    }

    @Test
    public void recentPlacesAreNewestFirstAndUnique() throws Exception {
        JSONArray tasks = new JSONArray()
                .put(task("2026-11-01T10:00:00.000Z", "Albert Heijn", "enter"))
                .put(task("2026-11-02T10:00:00.000Z", "Werk", "exit"))
                .put(task("2026-11-02T09:00:00.000Z", null, null))
                .put(task("2026-10-30T10:00:00.000Z", "albert heijn", "exit"))
                .put(task("2026-10-29T10:00:00.000Z", "Thuis", "enter"));
        List<JSONObject> r = QuickAddPlan.recentPlaces(tasks, Collections.singletonList("Thuis"), 5);
        assertEquals(2, r.size());
        assertEquals("Werk", r.get(0).getString("name"));
        assertEquals("exit", r.get(0).getString("trigger"));
        assertEquals("Albert Heijn", r.get(1).getString("name"));
        assertEquals(1, QuickAddPlan.recentPlaces(tasks, Collections.emptyList(), 1).size());
    }
}
