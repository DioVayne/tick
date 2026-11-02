package nl.detussenpartij.tick;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.temporal.TemporalAdjusters;

/** Rekenwerk voor de snelle-taak-popup (QuickAddActivity), los van Android zodat het te testen is. */
final class QuickAddPlan {
    /** Tijd voor "Morgen" en "Volgende week", net als de standaardtijd van de webapp. */
    static final LocalTime DEFAULT_TIME = LocalTime.of(9, 0);

    /** Ritmes in de popup, met dezelfde regels als de snelkeuzes in public/repeat.js. */
    enum Repeat { NONE, DAILY, WEEKLY, BIWEEKLY, MONTHLY, YEARLY }

    private static final String[] CODES = {"MO", "TU", "WE", "TH", "FR", "SA", "SU"};

    /** "Vandaag": het eerstvolgende hele uur, of null als dat al morgen is (na 23:00). */
    static LocalDateTime today(LocalDateTime now) {
        LocalDateTime at = now.plusHours(1).withMinute(0).withSecond(0).withNano(0);
        return at.toLocalDate().equals(now.toLocalDate()) ? at : null;
    }

    static LocalDateTime tomorrow(LocalDateTime now) {
        return now.toLocalDate().plusDays(1).atTime(DEFAULT_TIME);
    }

    /** "Volgende week": de eerste dag van de volgende week (firstDay: maandag of zondag, uit de locale). */
    static LocalDateTime nextWeek(LocalDateTime now, DayOfWeek firstDay) {
        return now.toLocalDate().with(TemporalAdjusters.next(firstDay)).atTime(DEFAULT_TIME);
    }

    /** De RRULE voor de server; start is de dag van de herinnering (of vandaag). null bij NONE. */
    static String rule(Repeat r, LocalDate start) {
        String day = CODES[start.getDayOfWeek().getValue() - 1];
        switch (r) {
            case DAILY: return "FREQ=DAILY";
            case WEEKLY: return "FREQ=WEEKLY;BYDAY=" + day;
            case BIWEEKLY: return "FREQ=WEEKLY;INTERVAL=2;BYDAY=" + day;
            case MONTHLY: return "FREQ=MONTHLY;BYMONTHDAY=" + start.getDayOfMonth();
            case YEARLY: return "FREQ=YEARLY";
            default: return null;
        }
    }

    private QuickAddPlan() {}
}
