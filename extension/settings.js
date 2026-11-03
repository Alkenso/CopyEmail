const CopyMailSettings = (() => {
    'use strict';

    const Mode = Object.freeze({ EXCLUDE: 'everywhere-except', INCLUDE: 'nowhere-but' });
    const STORAGE_KEY = 'websiteSettings';

    /** @typedef {{ mode: string, patterns: string[] }} WebsiteSettings */

    /** @returns {WebsiteSettings} */
    function normalize(value) {
        const patterns = Array.isArray(value?.patterns) ? value.patterns : [];
        return {
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

    return Object.freeze({ Mode, STORAGE_KEY, normalize, parsePatterns, matches, isEnabled });
})();
