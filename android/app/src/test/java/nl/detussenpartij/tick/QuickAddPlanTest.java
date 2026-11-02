package nl.detussenpartij.tick;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;

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
}
