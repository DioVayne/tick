package nl.detussenpartij.tick;

import java.util.HashMap;
import java.util.Map;
import java.util.Set;

/**
 * Het uiterlijk van één widget: weergave (Compact of Ruim, gekozen of automatisch naar de grootte), tekstgrootte en
 * regelafstand, en de maten die daaruit volgen. Zonder Android, zodat het testbaar is; TaskListService en het voorbeeld
 * in SettingsActivity rekenen er allebei mee.
 */
final class WidgetLook {
    /** Weergave: automatisch naar de grootte, of door de gebruiker vastgezet. */
    static final int AUTO = 0, COMPACT = 1, ROOMY = 2;

    static final int FONT_MIN = 12, FONT_MAX = 24, FONT_DEFAULT = 15;
    static final int SPACING_MIN = 0, SPACING_MAX = 16, SPACING_DEFAULT = 0;

    /**
     * Vanaf deze maat (dp, staand) is Automatisch Ruim. Ongeveer: 4 kolommen breed en 3 rijen hoog. Smaller (2-3
     * kolommen) of lager (2 rijen) wordt Compact. Een onbekende maat (0) telt als Ruim: de standaardmaat is 4 x 3.
     */
    static final int ROOMY_MIN_WIDTH_DP = 240, ROOMY_MIN_HEIGHT_DP = 180;

    /** Kleinste tikvlak (Android-richtlijn), in elke weergave. */
    static final float MIN_TOUCH_DP = 48;

    final int font;
    final int spacing;
    final boolean roomy;
    /** Smaller dan ROOMY_MIN_WIDTH_DP: de lijstnaam gaat dan van naast de titel naar de metaregel. */
    final boolean narrow;
    /** Lager dan ROOMY_MIN_HEIGHT_DP: dan telt elke regel. */
    final boolean low;

    WidgetLook(int font, int spacing, boolean roomy) {
        this(font, spacing, roomy, 0, 0);
    }

    /** Met de maat van de widget staand (dp; 0 als onbekend, dan niet smal en niet laag). */
    WidgetLook(int font, int spacing, boolean roomy, int widthDp, int heightDp) {
        this.font = clamp(font, FONT_MIN, FONT_MAX);
        this.spacing = clamp(spacing, SPACING_MIN, SPACING_MAX);
        this.roomy = roomy;
        this.narrow = widthDp > 0 && widthDp < ROOMY_MIN_WIDTH_DP;
        this.low = heightDp > 0 && heightDp < ROOMY_MIN_HEIGHT_DP;
    }

    static int clamp(int v, int min, int max) {
        return Math.max(min, Math.min(max, v));
    }

    /** Een opgeslagen weergave, met Automatisch voor alles wat onbekend is. */
    static int mode(int stored) {
        return stored == COMPACT || stored == ROOMY ? stored : AUTO;
    }

    /**
     * Ruim of Compact. widthDp en heightDp zijn de maat van de widget staand (OPTION_APPWIDGET_MIN_WIDTH en
     * OPTION_APPWIDGET_MAX_HEIGHT); 0 als de launcher die (nog) niet doorgaf.
     */
    static boolean isRoomy(int mode, int widthDp, int heightDp) {
        if (mode == COMPACT) return false;
        if (mode == ROOMY) return true;
        boolean wide = widthDp <= 0 || widthDp >= ROOMY_MIN_WIDTH_DP;
        boolean tall = heightDp <= 0 || heightDp >= ROOMY_MIN_HEIGHT_DP;
        return wide && tall;
    }

    // --- Maten van een rij (sp voor tekst, dp voor de rest) ---

    /** Titel. */
    int titleSp() {
        return font;
    }

    /**
     * Hoeveel regels de titel mag gebruiken. Ruim: 2. Compact: 1, behalve op een smalle widget die hoog genoeg is (daar
     * is ruimte in de hoogte maar niet in de breedte, dus breekt een titel anders na een paar woorden af).
     */
    int titleLines() {
        if (roomy) return 2;
        return narrow && !low ? 2 : 1;
    }

    /** Kleine tekst: tijd, aantal subtaken. */
    int smallSp() {
        return Math.max(10, font - 3);
    }

    /** Lijstnaam op de pil. */
    int pillSp() {
        return Math.max(9, font - 4);
    }

    /** Knop Ongedaan maken. */
    int undoSp() {
        return Math.max(12, font - 1);
    }

    /** Kop van een groep (Te laat, Vandaag, Vastgezet). */
    int sectionSp() {
        return Math.max(11, font - 3);
    }

    /** Titel bovenaan de widget. */
    int headerSp() {
        return roomy ? 18 : 16;
    }

    /** Icoontjes in de metaregel: zo hoog als de kleine tekst. */
    float iconDp() {
        return smallSp() + 2f;
    }

    /** Het zichtbare bolletje schaalt mee met de tekst. */
    float checkDp() {
        return Math.max(24f, font * 2.1f);
    }

    /** Het tikvlak van het bolletje: minstens 48 x 48 dp. */
    float touchDp() {
        return Math.max(MIN_TOUCH_DP, checkDp());
    }

    /** Binnenruimte rond het bolletje, zodat het zichtbaar even groot blijft als vroeger (check min 5 dp rand). */
    float checkPadDp() {
        return (touchDp() - (checkDp() - 10f)) / 2f;
    }

    /** Ruimte boven en onder het tekstblok: vast per weergave, plus de regelafstand uit de instellingen. */
    float textPadDp() {
        return (roomy ? 5 : 1) + spacing;
    }

    /** Ruimte onder elke rij. */
    float gapDp() {
        return roomy ? 4 : 0;
    }

    /** Ruimte na de laatste vastgezette taak, als er geen kopjes zijn. */
    float groupGapDp() {
        return roomy ? 10 : 8;
    }

    /** Tegeltje per taak (Ruim) of vlakke rijen (Compact). */
    boolean tiles() {
        return roomy;
    }


    /** Kopjes tussen groepen (Te laat / Vandaag, Vastgezet / Overige). */
    boolean sections() {
        return roomy;
    }

    // --- Opslag per widget ---

    static String fontKey(int widgetId) {
        return "widget_" + widgetId + "_font";
    }

    static String spacingKey(int widgetId) {
        return "widget_" + widgetId + "_spacing";
    }

    static String modeKey(int widgetId) {
        return "widget_" + widgetId + "_mode";
    }

    /** Oude sleutels: tekstgrootte en regelafstand voor alle widgets samen (tot en met deze versie). */
    static final String LEGACY_FONT = "fontSp", LEGACY_SPACING = "spacingDp";

    /**
     * Overstap naar uiterlijk per widget: elke bestaande widget zonder eigen waarde krijgt de oude algemene waarde
     * (als die er was). Geeft de sleutels die erbij moeten; de oude sleutels kunnen daarna weg. Een widget die al
     * eigen waarden heeft, houdt die.
     */
    static Map<String, Integer> migrate(Integer legacyFont, Integer legacySpacing, int[] widgetIds, Set<String> existingKeys) {
        Map<String, Integer> put = new HashMap<>();
        if (widgetIds == null) return put;
        for (int id : widgetIds) {
            if (legacyFont != null && !existingKeys.contains(fontKey(id))) {
                put.put(fontKey(id), clamp(legacyFont, FONT_MIN, FONT_MAX));
            }
            if (legacySpacing != null && !existingKeys.contains(spacingKey(id))) {
                put.put(spacingKey(id), clamp(legacySpacing, SPACING_MIN, SPACING_MAX));
            }
        }
        return put;
    }
}
