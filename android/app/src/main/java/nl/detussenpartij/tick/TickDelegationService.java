package nl.detussenpartij.tick;

import com.google.androidbrowserhelper.locationdelegation.LocationDelegationExtraCommandHandler;
import com.google.androidbrowserhelper.trusted.DelegationService;

/**
 * Wat Chrome aan de app vraagt voor de PWA: meldingen (Browser Helper zelf) en je locatie. In een TWA vraagt Chrome
 * navigator.geolocation aan de app; zonder deze handlers komt er nooit een locatie (geen fout, alleen een time-out), en
 * dan werken de rijmodus en "mijn locatie" op de kaart niet.
 */
public class TickDelegationService extends DelegationService {
    @Override
    public void onCreate() {
        super.onCreate();
        // Eerst de eigen: die neemt start- en stopLocation over (zie TickLocationHandler). De handler van Browser Helper
        // blijft voor "checkAndroidLocationPermission" (toestemming vragen, met zijn eigen scherm).
        registerExtraCommandHandler(new TickLocationHandler());
        registerExtraCommandHandler(new LocationDelegationExtraCommandHandler());
    }
}
