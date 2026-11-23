package nl.detussenpartij.tick;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Delen naar Tick: wat een andere app via het deelmenu stuurt (EXTRA_SUBJECT en EXTRA_TEXT) wordt een titel en een
 * omschrijving voor het snelle invoerscherm. Chrome stuurt de paginatitel als onderwerp en de link als tekst. Zelfde
 * regels als public/sharein.js in de webapp: de paginatitel (of de tekst zonder links) wordt de titel, de links en de
 * overige tekst gaan in de omschrijving.
 */
final class SharedText {
    static final int MAX_TITLE = 200;
    private static final Pattern URL = Pattern.compile("https?://[^\\s<>\"]+");
    private static final Pattern WORDISH = Pattern.compile("[\\p{L}\\p{N}]");

    final String title;
    final String description;

    private SharedText(String title, String description) {
        this.title = title;
        this.description = description;
    }

    /** Null als er niets bruikbaars gedeeld is. */
    static SharedText of(String subject, String text) {
        String rawTitle = subject == null ? "" : subject.trim();
        String body = text == null ? "" : text.trim();
        List<String> urls = new ArrayList<>();
        Matcher m = URL.matcher(body);
        while (m.find()) {
            String u = m.group().replaceAll("[.,;:!?)\\]]+$", "");
            if (!u.isEmpty() && !urls.contains(u)) urls.add(u);
        }
        StringBuilder restB = new StringBuilder();
        for (String line : URL.matcher(body).replaceAll("").split("\n")) {
            String l = line.trim();
            if (!WORDISH.matcher(l).find()) continue;
            if (restB.length() > 0) restB.append('\n');
            restB.append(l);
        }
        String rest = restB.toString();

        String title = oneLine(rawTitle);
        String restLeft = rest;
        // Sommige apps sturen het onderwerp ook als tekst, of de link als onderwerp: dat geen titel van maken.
        if (!title.isEmpty() && URL.matcher(title).matches()) title = "";
        if (title.isEmpty() && !rest.isEmpty()) {
            int nl = rest.indexOf('\n');
            title = oneLine(nl < 0 ? rest : rest.substring(0, nl));
            restLeft = nl < 0 ? "" : rest.substring(nl + 1);
        } else if (!rest.isEmpty() && oneLine(rest).equals(title)) {
            restLeft = "";
        }
        if (title.length() > MAX_TITLE) {
            restLeft = restLeft.isEmpty() ? title : title + "\n" + restLeft;
            title = title.substring(0, MAX_TITLE - 1).trim() + "…";
        }
        if (title.isEmpty() && !urls.isEmpty()) title = urls.get(0);
        StringBuilder d = new StringBuilder(restLeft);
        for (String u : urls) {
            if (d.length() > 0) d.append('\n');
            d.append(u);
        }
        if (title.isEmpty() && d.length() == 0) return null;
        return new SharedText(title, d.toString());
    }

    private static String oneLine(String s) {
        return s.replaceAll("\\s+", " ").trim();
    }
}
