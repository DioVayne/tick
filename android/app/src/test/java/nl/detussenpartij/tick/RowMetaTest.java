package nl.detussenpartij.tick;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.util.Arrays;
import java.util.Collections;

public class RowMetaTest {
    private static JSONObject task() throws Exception {
        return new JSONObject().put("id", "t1").put("title", "Iets").put("parent_id", JSONObject.NULL)
                .put("repeat", JSONObject.NULL).put("location", JSONObject.NULL).put("claimed_by", JSONObject.NULL)
                .put("share", JSONObject.NULL);
    }

    private static JSONObject person(String id, String name) throws Exception {
        return new JSONObject().put("id", id).put("name", name);
    }

    private static JSONObject member(String id, String name, String status) throws Exception {
        return new JSONObject().put("share_id", "s-" + id).put("user_id", id).put("name", name).put("status", status);
    }

    @Test
    public void lijstnaamNaastTitelOfInMetaregel() throws Exception {
        RowMeta wide = RowMeta.plan(task(), false, true, true, false, "me", 0, false);
        assertTrue(wide.pill);
        assertFalse(wide.listInMeta);
        RowMeta narrow = RowMeta.plan(task(), false, true, true, true, "me", 0, false);
        assertFalse(narrow.pill);
        assertTrue(narrow.listInMeta);
        assertTrue(narrow.any());
        // Widget op één lijst: geen lijstnaam.
        RowMeta one = RowMeta.plan(task(), false, false, true, true, "me", 0, false);
        assertFalse(one.pill);
        assertFalse(one.listInMeta);
        assertFalse(one.any());
    }

    @Test
    public void afgevinktToontNiets() throws Exception {
        JSONObject t = task().put("repeat", new JSONObject()).put("claimed_by", person("u2", "Sanne"));
        RowMeta m = RowMeta.plan(t, true, true, true, false, "me", 3, true);
        assertFalse(m.pill);
        assertFalse(m.any());
    }

    @Test
    public void icoontjesAlleenInRuimEnBreed() throws Exception {
        JSONObject t = task().put("repeat", new JSONObject().put("freq", "daily"))
                .put("location", new JSONObject().put("name", "Thuis"));
        RowMeta roomyWide = RowMeta.plan(t, false, false, true, false, "me", 0, true);
        assertTrue(roomyWide.repeat);
        assertTrue(roomyWide.place);
        RowMeta roomyNarrow = RowMeta.plan(t, false, false, true, true, "me", 0, true);
        assertFalse(roomyNarrow.repeat);
        assertFalse(roomyNarrow.place);
        assertTrue(roomyNarrow.time);
        RowMeta compact = RowMeta.plan(t, false, false, false, false, "me", 0, true);
        assertFalse(compact.repeat);
        assertFalse(compact.place);
    }

    @Test
    public void subtakenAlleenInRuim() throws Exception {
        assertEquals(3, RowMeta.plan(task(), false, false, true, true, "me", 3, false).subtasks);
        assertEquals(0, RowMeta.plan(task(), false, false, false, false, "me", 3, false).subtasks);
    }

    @Test
    public void wieHetDoetOokInCompact() throws Exception {
        JSONObject t = task().put("claimed_by", person("u2", "Sanne"));
        assertEquals("Sanne", RowMeta.plan(t, false, false, false, true, "me", 0, false).doer);
        // Ik doe het zelf: niet melden.
        assertNull(RowMeta.plan(t, false, false, true, false, "u2", 0, false).doer);
        // Mijn id onbekend (oude koppeling): de naam klopt dan nog steeds.
        assertEquals("Sanne", RowMeta.doer(t, ""));
        // Geen naam (verwijderd account geeft null): niets.
        assertNull(RowMeta.doer(task(), "me"));
        assertNull(RowMeta.doer(task().put("claimed_by", person("u3", " ")), "me"));
    }

    @Test
    public void gedeeldMetAnderen() throws Exception {
        JSONObject share = new JSONObject().put("owner", person("me", "Dio")).put("mine", true)
                .put("members", new JSONArray(Arrays.asList(member("u2", "Sanne", "accepted"),
                        member("u3", "Kim", "pending"), member("u4", "Bo", "accepted"))));
        JSONObject t = task().put("share", share);
        assertEquals(Arrays.asList("Sanne", "Bo"), RowMeta.sharedWith(t, "me"));
        RowMeta m = RowMeta.plan(t, false, false, true, false, "me", 0, false);
        assertEquals("Sanne", m.sharedWith);
        assertEquals(1, m.sharedOthers);
        assertFalse(m.sharedPlain);
        // Compact: niet.
        assertNull(RowMeta.plan(t, false, false, false, false, "me", 0, false).sharedWith);
    }

    @Test
    public void gedeeldAlsOntvangerToontDeEigenaar() throws Exception {
        JSONObject share = new JSONObject().put("owner", person("u2", "Sanne")).put("mine", false)
                .put("members", new JSONArray(Collections.singletonList(member("me", "Dio", "accepted"))));
        assertEquals(Collections.singletonList("Sanne"), RowMeta.sharedWith(task().put("share", share), "me"));
    }

    @Test
    public void gedeeldZonderAnderenOfAlIemandDieHetDoet() throws Exception {
        JSONObject share = new JSONObject().put("owner", person("me", "Dio")).put("mine", true)
                .put("members", new JSONArray(Collections.singletonList(member("u3", "Kim", "pending"))));
        RowMeta plain = RowMeta.plan(task().put("share", share), false, false, true, false, "me", 0, false);
        assertTrue(plain.sharedPlain);
        assertNull(plain.sharedWith);
        // Doet iemand hem al, dan alleen dat.
        JSONObject t = task().put("share", share).put("claimed_by", person("u2", "Sanne"));
        RowMeta doing = RowMeta.plan(t, false, false, true, false, "me", 0, false);
        assertEquals("Sanne", doing.doer);
        assertFalse(doing.sharedPlain);
        assertNull(doing.sharedWith);
    }
}
