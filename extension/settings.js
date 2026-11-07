const CopyMailSettings = (() => {
    'use strict';

    const Mode = Object.freeze({ EXCLUDE: 'everywhere-except', INCLUDE: 'nowhere-but' });
    const STORAGE_KEY = 'websiteSettings';

    // Ten format families, not a worldwide popularity ranking. See docs/address-formats.md.
    const word = String.raw`[\p{L}\p{M}][\p{L}\p{M}\d.'’\-]*`;
    const street = `${word}(?:[ \\t]+${word}){0,8}`;
    const number = String.raw`\d{1,6}[a-z]?(?:[/-](?:\d{1,6}[a-z]?|[a-z]{1,3}))?(?:[ \t]+\d/\d)?`;
    const suffix = String.raw`(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|boulevard|blvd|court|ct|way|place|pl|terrace|ter|parkway|pkwy|highway|hwy|circle|cir|square|sq|crescent|close)`;
    const tail = String.raw`(?:,[ \t]*[\p{L}\p{M}\d][\p{L}\p{M}\d .’'()/#\-]{0,79}){0,4}`;
    const bounded = source => String.raw`(?<![\p{L}\p{M}\d])(?:${source})(?![\p{L}\p{M}\d])`;
    const ADDRESS_REGEXES = [
        // 1. US/UK: building number, named street and street type, optional unit/locality.
        bounded(`(?:no\\.?[ \\t]+)?${number}[ \\t]+${street}[ \\t]+${suffix}\\.?(?:[ \\t]+(?:apt\\.?|suite|ste\\.?|unit|#)[ \\t]*${number})?${tail}`),
        // 2. Poland: bare street name + building number + postal code (including comma before district).
        bounded(`${street}[ \\t]+${number},?[ \\t]+\\d{2}-\\d{3}(?:[ \\t]+${street})?${tail}`),
        // 3. Poland: explicit street type, with or without postcode/locality.
        bounded(`(?:ul(?:ica)?\\.?|al(?:eja|eje)?\\.?|plac|osiedle)[ \\t]+${street}[ \\t]+${number}${tail}`),
        // 4. Germany/Austria/Netherlands: street-type suffix + building number.
        bounded(`${street}(?:straße|strasse|straat|weg|gasse|laan|platz)[ \\t]+${number}${tail}`),
        // 5. France: building number before a named street type.
        bounded(`${number}(?:[ \\t]+(?:bis|ter))?,?[ \\t]+(?:rue|avenue|av\\.?|boulevard|bd\\.?|chemin|place|route|allée)[ \\t]+${street}${tail}`),
        // 6. Spain/Italy/Portugal: street type and name before building number.
        bounded(`(?:calle|c/|avenida|av\\.?|plaza|paseo|via|viale|piazza|corso|rua|praça)[ \\t]+${street},?[ \\t]+${number}${tail}`),
        // 7. Japan: native block notation or hyphenated block numbers following a native locality.
        bounded(String.raw`(?:〒[ \t]*\d{3}-\d{4}[ \t]*)?[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]{2,60}\d{1,4}(?:丁目\d{1,4}(?:番(?:地)?\d{1,4}号?|[-－]\d{1,4})|[-－]\d{1,4}[-－]\d{1,4})(?:[ \t]*\d{3}-\d{4})?|\d{1,4}-\d{1,4}-\d{1,4}(?:-\d{1,4})?[ \t]+${street}${tail}`),
        // 8. China/Taiwan: native road/street name and numbered premises.
        bounded(String.raw`[\p{Script=Han}]{2,60}(?:路|街|道|巷)(?:[一二三四五六七八九十\d]+段)?[ \t]*\d{1,6}(?:号|號)(?:[ \t]*\d{6})?`),
        // 9. South Korea: road-name + building number in native or romanized order.
        bounded(String.raw`(?:[가-힣]+[ \t]+){0,4}[가-힣\d]+(?:대로|로|길)[ \t]+\d{1,5}(?:-\d{1,5})?(?:,[ \t]*[가-힣\d ]{1,60})?|\d{1,5}(?:-\d{1,5})?,?[ \t]+[a-z\d-]+-(?:daero|ro|gil)${tail}`),
        // 10. India/Singapore: numbered premises or block, locality and explicit six-digit PIN/postcode.
        bounded(`(?:block[ \\t]+|blk[ \\t]+|no\\.?[ \\t]*)?${number}[ \\t]+${street}(?:[ \\t]+\\d{1,4})?(?:,[ \\t]*(?:${street}|#\\d{1,3}-\\d{1,4})){0,3}[ ,\\t-]+\\d{6}`)
    ];

    /** @typedef {{ predefined: string|null, isOn: boolean, name: string, regexes: string[], action: string, parentLevels: number, parentRegex: string }} Rule */
    const DEFAULT_PATTERNS = [
        { predefined: 'email', isOn: true, regexes: ["[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+[a-z]{2,63}\\b"], name: 'Email' },
        { predefined: 'phone', isOn: false, regexes: [String.raw`\+?\b\d[\d ().-]{6,}\d\b`], name: 'Phone' },
        { predefined: 'address', isOn: true, regexes: ADDRESS_REGEXES, name: 'Addresses' }
    ];

    function validateRegex(source) {
        if (!source.trim()) {
            throw new Error('Regex is required.');
        }
        return new RegExp(source, /\\[pP]\{/.test(source) ? 'giu' : 'gi');
    }

    /** @typedef {{ mode: string, patterns: string[], ignoreHoverHints: boolean }} WebsiteSettings */

    /** @returns {WebsiteSettings} */
    function normalize(value) {
        const patterns = Array.isArray(value?.patterns) ? value.patterns : [];
        const copyPatterns = Array.isArray(value?.copyPatterns) ? [...value.copyPatterns] : DEFAULT_PATTERNS;
        if (copyPatterns.some(rule => typeof rule?.regex === 'string' && !Array.isArray(rule.regexes)) &&
            !copyPatterns.some(pattern => pattern?.predefined === 'address')) {
            copyPatterns.push(DEFAULT_PATTERNS.find(pattern => pattern.predefined === 'address'));
        }
        return {
            ignoreHoverHints: value?.ignoreHoverHints !== false,
            googleMapsLinks: value?.googleMapsLinks !== false,
            copyPatterns: copyPatterns
                .filter(rule => rule && (Array.isArray(rule.regexes) || typeof rule.regex === 'string'))
                .map(normalizeRule),
            mode: value?.mode === Mode.INCLUDE ? Mode.INCLUDE : Mode.EXCLUDE,
            patterns: [...new Set(patterns.filter(pattern => typeof pattern === 'string')
                .map(pattern => pattern.trim().toLowerCase()).filter(Boolean))]
        };
    }

    /** @returns {Rule} */
    function normalizeRule(rule, index) {
        const preset = DEFAULT_PATTERNS.find(item => item.predefined === rule.predefined ||
            (!Object.hasOwn(rule, 'predefined') && item.regexes[0] === rule.regex && item.name === rule.name));
        const legacy = !Array.isArray(rule.regexes);
        const sources = preset?.regexes || (legacy ? [rule.regex] : rule.regexes);
        const name = typeof rule.name === 'string' ? rule.name.trim() : '';
        return {
            predefined: preset?.predefined || null,
            isOn: rule.isOn === true,
            regexes: [...new Set(sources.filter(source => typeof source === 'string' && source.trim()))],
            action: preset?.predefined === 'address' ? 'map' : 'copy',
            parentLevels: preset?.predefined === 'address' ? 5 : 0,
            parentRegex: '',
            name: preset?.name || name || (legacy ? `Custom rule ${index + 1}` : '')
        };
    }

    function parsePatterns(text) {
        const patterns = text.split(/\r?\n/).map((line, index) => {
            const pattern = line.trim();
            if (/[\s/:#\\]/.test(pattern)) {
                throw new Error(`Line ${index + 1}: enter a hostname pattern without a scheme, path, port, or spaces.`);
            }
            return pattern;
        });
        return normalize({ patterns }).patterns;
    }

    function matches(pattern, hostname) {
        pattern = pattern.toLowerCase();
        hostname = hostname.toLowerCase();
        let patternIndex = 0;
        let hostnameIndex = 0;
        let starIndex = -1;
        let starEnd = 0;

        // Match glob characters directly; punctuation never becomes regular expression syntax.
        while (hostnameIndex < hostname.length) {
            if (pattern[patternIndex] === '?' || pattern[patternIndex] === hostname[hostnameIndex]) {
                patternIndex++;
                hostnameIndex++;
            } else if (pattern[patternIndex] === '*') {
                starIndex = patternIndex++;
                starEnd = hostnameIndex;
            } else if (starIndex !== -1) {
                patternIndex = starIndex + 1;
                hostnameIndex = ++starEnd;
            } else {
                return false;
            }
        }
        while (pattern[patternIndex] === '*') {
            patternIndex++;
        }
        return patternIndex === pattern.length;
    }

    /** @param {WebsiteSettings} settings */
    function isEnabled(settings, hostname) {
        const matched = settings.patterns.some(pattern => matches(pattern, hostname));
        return settings.mode === Mode.INCLUDE ? matched : !matched;
    }

    return Object.freeze({ Mode, STORAGE_KEY, normalize, validateRegex, parsePatterns, matches, isEnabled });
})();
