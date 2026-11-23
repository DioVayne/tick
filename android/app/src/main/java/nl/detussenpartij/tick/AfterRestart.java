package nl.detussenpartij.tick;

/**
 * Wat er moet gebeuren na een herstart van de telefoon of een update van de app (BootReceiver). Puur, dus te testen.
 *
 * Na een app-update roept Android niet altijd onUpdate van de widget aan. Dan blijft de widget de oude weergave tonen,
 * met tikacties en een lijstkoppeling van het vorige proces: tikken, afvinken en snel toevoegen deden dan soms niets
 * meer tot de widget toevallig opnieuw werd opgebouwd (dat gebeurde alleen na een geslaagde verversing, dus niet
 * offline of zonder koppeling). Daarom bouwt de app hem hier zelf opnieuw op, zonder netwerk, vóór al het andere.
 */
final class AfterRestart {
    static final String BOOT = "android.intent.action.BOOT_COMPLETED";
    static final String REPLACED = "android.intent.action.MY_PACKAGE_REPLACED";

    /** Een van de twee momenten waarop BootReceiver iets doet. */
    final boolean handled;
    /** Widgets opnieuw opbouwen uit de cache (RemoteViews, tikacties, lijst) en het verversalarm opnieuw zetten. */
    final boolean rebuildWidgets;
    /** De lijst van de server halen. */
    final boolean refresh;

    private AfterRestart(boolean handled, boolean rebuildWidgets, boolean refresh) {
        this.handled = handled;
        this.rebuildWidgets = rebuildWidgets;
        this.refresh = refresh;
    }

    static AfterRestart plan(String action, int widgets, boolean paired, boolean online) {
        if (!BOOT.equals(action) && !REPLACED.equals(action)) return new AfterRestart(false, false, false);
        // Vlak na het opstarten is er vaak nog geen netwerk: dan niet verversen (en dus geen "geen verbinding" in de
        // widget). De cache staat al; een latere verversing haalt het in.
        return new AfterRestart(true, widgets > 0, paired && online);
    }
}
