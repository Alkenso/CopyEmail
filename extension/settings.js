const CopyMailSettings = (() => {
    'use strict';

    const Mode = Object.freeze({ EXCLUDE: 'everywhere-except', INCLUDE: 'nowhere-but' });
    const STORAGE_KEY = 'websiteSettings';

    const DEFAULT_PATTERNS = [
        { predefined: 'email', isOn: true, regex: "[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+[a-z]{2,63}\\b", name: 'Email' },
        { predefined: 'phone', isOn: false, regex: String.raw`\+?\b\d[\d ().-]{6,}\d\b`, name: 'Phone' },
        { predefined: 'address', isOn: true, action: 'map', parentLevels: 5, name: 'Addresses',
            regex: String.raw`(?<![\p{L}\d])(?:(?:ul(?:ica)?\.?|al(?:eja|eje)?\.?|plac|osiedle|rue|avenue|via|calle)[ \t]+[\p{L}\p{M}.'’ -]{2,70}[ \t]+\d+[\p{L}]?(?:[/-]\d+)?|\d+[\p{L}]?[ \t]+[\p{L}\p{M}.'’ -]{2,70}[ \t]+(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|boulevard|blvd)\.?|[\p{L}\p{M}.'’ -]{2,70}(?:straße|strasse|straat)[ \t]+\d+[\p{L}]?)(?:,[ \t]*[\p{L}\p{M}\d .’'()-]+){0,3}` }
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
        if (copyPatterns.length && !copyPatterns.some(pattern => pattern?.predefined === 'address')) {
            copyPatterns.push(DEFAULT_PATTERNS.find(pattern => pattern.predefined === 'address'));
        }
        return {
            ignoreHoverHints: value?.ignoreHoverHints !== false,
            googleMapsLinks: value?.googleMapsLinks !== false,
            copyPatterns: copyPatterns
                .filter(pattern => pattern && typeof pattern.regex === 'string')
                .map(pattern => ({
                    predefined: DEFAULT_PATTERNS.find(defaultPattern => defaultPattern.predefined === pattern.predefined ||
                        (!Object.hasOwn(pattern, 'predefined') && defaultPattern.regex === pattern.regex && defaultPattern.name === pattern.name))?.predefined || null,
                    isOn: pattern.isOn === true,
                    regex: pattern.regex,
                    action: pattern.predefined === 'address' ? 'map' : 'copy',
                    parentLevels: pattern.predefined === 'address' ? 5 : 0,
                    parentRegex: '',
                    name: pattern.predefined === 'address' ? 'Addresses' : typeof pattern.name === 'string' ? pattern.name : ''
                })),
            mode: value?.mode === Mode.INCLUDE ? Mode.INCLUDE : Mode.EXCLUDE,
            patterns: [...new Set(patterns.filter(pattern => typeof pattern === 'string')
                .map(pattern => pattern.trim().toLowerCase()).filter(Boolean))]
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
