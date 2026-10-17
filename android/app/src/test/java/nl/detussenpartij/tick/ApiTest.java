package nl.detussenpartij.tick;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class ApiTest {
    @Test public void alleen401MetSleutelWist() {
        assertTrue(Api.shouldForget(401, true));
        assertFalse(Api.shouldForget(401, false));
        assertFalse(Api.shouldForget(500, true));
        assertFalse(Api.shouldForget(403, true));
    }
}
