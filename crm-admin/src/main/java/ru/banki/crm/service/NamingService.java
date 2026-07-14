package ru.banki.crm.service;

import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

/**
 * Communication-name rules ported from v2 (CommunicationNameJS) / v1 saveTemplate.
 * Currently covers the A/B-variant suffixing (-a, -b, …). The full prefix-based
 * communication_name generator from v2 is a follow-up once its JS is finalized;
 * v1 already composes communication_name client-side and sends it as-is.
 */
@Service
public class NamingService {

    private static final String LETTERS = "abcdefghijklmnopqrstuvwxyz";

    /** base "foo" + count 3 -> ["foo-a","foo-b","foo-c"]. Strips an existing trailing -x first. */
    public List<String> abVariants(String base, int count) {
        String clean = (base == null || base.isBlank()) ? "NoComName" : base.trim();
        clean = clean.replaceAll("-[a-zA-Z]$", "");
        int n = Math.max(2, Math.min(count, 26));
        List<String> out = new ArrayList<>(n);
        for (int i = 0; i < n; i++) {
            out.add(clean + "-" + LETTERS.charAt(i));
        }
        return out;
    }
}
