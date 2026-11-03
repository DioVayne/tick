package nl.detussenpartij.tick;

import com.google.androidbrowserhelper.locationdelegation.LocationDelegationExtraCommandHandler;
import com.google.androidbrowserhelper.trusted.DelegationService;

/**
 * Wat Chrome aan de app vraagt voor de PWA: meldingen (Browser Helper zelf) en je locatie. In een TWA vraagt Chrome
 * navigator.geolocation aan de app; zonder deze handler komt er nooit een locatie (geen fout, alleen een time-out), en
 * dan werken de rijmodus en "mijn locatie" op de kaart niet.
 */
public class TickDelegationService extends DelegationService {
    @Override
    public void onCreate() {
        super.onCreate();
        registerExtraCommandHandler(new LocationDelegationExtraCommandHandler());
    }
}
