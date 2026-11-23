package nl.detussenpartij.tick;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class AfterRestartTest {
    @Test
    public void appUpdateRebuildsWidgetsEvenOffline() {
        AfterRestart p = AfterRestart.plan(AfterRestart.REPLACED, 1, true, false);
        assertTrue(p.handled);
        assertTrue(p.rebuildWidgets);
        assertFalse(p.refresh);
    }

    @Test
    public void appUpdateRebuildsWidgetsWithoutPairing() {
        AfterRestart p = AfterRestart.plan(AfterRestart.REPLACED, 2, false, true);
        assertTrue(p.rebuildWidgets);
        assertFalse(p.refresh);
    }

    @Test
    public void bootRebuildsAndRefreshesWhenPairedAndOnline() {
        AfterRestart p = AfterRestart.plan(AfterRestart.BOOT, 1, true, true);
        assertTrue(p.rebuildWidgets);
        assertTrue(p.refresh);
    }

    @Test
    public void noWidgetsNothingToRebuild() {
        AfterRestart p = AfterRestart.plan(AfterRestart.REPLACED, 0, true, true);
        assertTrue(p.handled);
        assertFalse(p.rebuildWidgets);
        assertTrue(p.refresh);
    }

    @Test
    public void otherActionsAreIgnored() {
        AfterRestart p = AfterRestart.plan("android.intent.action.PACKAGE_ADDED", 3, true, true);
        assertFalse(p.handled);
        assertFalse(p.rebuildWidgets);
        assertFalse(p.refresh);
        assertFalse(AfterRestart.plan(null, 3, true, true).handled);
    }

    @Test
    public void actionNamesMatchAndroid() {
        // Zonder Android-stubs: de namen moeten exact gelijk zijn aan Intent.ACTION_BOOT_COMPLETED en
        // Intent.ACTION_MY_PACKAGE_REPLACED (en aan het manifest).
        assertTrue(AfterRestart.BOOT.equals("android.intent.action.BOOT_COMPLETED"));
        assertTrue(AfterRestart.REPLACED.equals("android.intent.action.MY_PACKAGE_REPLACED"));
    }
}
