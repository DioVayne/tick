package nl.detussenpartij.tick;

/**
 * Wat de app na het koppelen nog vraagt, in deze volgorde: locatie (met uitleg; meldingen gaan in dezelfde systeemvraag
 * mee), daarna "Altijd toestaan", daarna de batterij. Pure Java, zonder Android, voor een gewone JUnit-test.
 */
final class PairSteps {
    enum Step { LOCATION, BACKGROUND, NOTIFICATIONS, BATTERY }

    private PairSteps() {}

    /** De eerste vraag na het koppelen, gegeven wat er al toegestaan is. */
    static Step first(boolean notifications, boolean location, boolean background) {
        if (!location) return Step.LOCATION;
        if (!background) return Step.BACKGROUND;
        return notifications ? Step.BATTERY : Step.NOTIFICATIONS;
    }

    /** Na de systeemvraag om locatie (en meldingen): alleen door naar "Altijd toestaan" als locatie gegeven is. */
    static Step afterLocation(boolean location, boolean background) {
        return location && !background ? Step.BACKGROUND : Step.BATTERY;
    }

    /** "Niet nu" bij locatie: dan alleen nog meldingen (als die ontbreken) en de batterij. */
    static Step skipLocation(boolean notifications) {
        return notifications ? Step.BATTERY : Step.NOTIFICATIONS;
    }
}
