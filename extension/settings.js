const CopyMailSettings = (() => {
    'use strict';

    const Action = Object.freeze({ COPY: 'copy', OPEN_LINK: 'openLink' });
    const Appearance = Object.freeze({ SYSTEM: 'system', LIGHT: 'light', DARK: 'dark' });
    const BuiltinRuleType = Object.freeze({ EMAIL: 'email', PHONE: 'phone', ADDRESS: 'address' });
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

    /** @typedef {{ predefined: string|null, isOn: boolean, name: string, regexes: string[], action: string, parentLevels: number, parentRegex: string }} LegacyRule */
    const DEFAULT_PATTERNS = [
        { predefined: 'email', isOn: true, regexes: ["[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+[a-z]{2,63}\\b"], name: 'Email' },
        { predefined: 'phone', isOn: false, regexes: [String.raw`\+?\b\d[\d ().-]{6,}\d\b`], name: 'Phone' },
        { predefined: 'address', isOn: true, regexes: ADDRESS_REGEXES, name: 'Addresses' }
    ];

    const BUILTIN_IDS = Object.freeze({
        [BuiltinRuleType.EMAIL]: '00000000-0000-4000-8000-000000000001',
        [BuiltinRuleType.PHONE]: '00000000-0000-4000-8000-000000000002',
        [BuiltinRuleType.ADDRESS]: '00000000-0000-4000-8000-000000000003'
    });
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    /** @typedef {{ id: string, name: string, possibleActions: string[], enabledActions: string[], builtinType: string|null, patterns: string[] }} Rule */
    /** @typedef {{ mode: string, patterns: string[], ignoreHoverHints: boolean, appearance: string, rules: Rule[] }} WebsiteSettings */

    /** @returns {WebsiteSettings} */
    function normalize(value) {
        const websitePatterns = Array.isArray(value?.patterns) ? value.patterns : [];
        const rules = Array.isArray(value?.rules) ? normalizeModernRules(value.rules) : migrateLegacyRules(value);
        return {
            appearance: Object.values(Appearance).includes(value?.appearance) ? value.appearance : Appearance.SYSTEM,
            ignoreHoverHints: value?.ignoreHoverHints !== false,
            mode: value?.mode === Mode.INCLUDE ? Mode.INCLUDE : Mode.EXCLUDE,
            patterns: [...new Set(websitePatterns.filter(pattern => typeof pattern === 'string')
                .map(pattern => pattern.trim().toLowerCase()).filter(Boolean))],
            rules
        };
    }

    /** @returns {LegacyRule} */
    function normalizeLegacyRule(rule, index) {
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

    function migrateLegacyRules(value) {
        const legacyRules = Array.isArray(value?.copyPatterns) ? [...value.copyPatterns] : DEFAULT_PATTERNS;
        if (legacyRules.some(rule => typeof rule?.regex === 'string' && !Array.isArray(rule.regexes)) &&
            !legacyRules.some(pattern => pattern?.predefined === BuiltinRuleType.ADDRESS)) {
            legacyRules.push(DEFAULT_PATTERNS.find(pattern => pattern.predefined === BuiltinRuleType.ADDRESS));
        }
        const migratableRules = legacyRules
            .filter(rule => rule && (Array.isArray(rule.regexes) || typeof rule.regex === 'string'));
        return migratableRules
            .map(normalizeLegacyRule)
            .map((rule, index) => {
                const builtinType = Object.values(BuiltinRuleType).includes(rule.predefined) ? rule.predefined : null;
                const enabledActions = rule.isOn ? [Action.COPY] : [];
                if (builtinType === BuiltinRuleType.ADDRESS && value?.googleMapsLinks !== false) {
                    enabledActions.push(Action.OPEN_LINK);
                }
                return normalizeModernRule({
                    id: migratableRules[index]?.id,
                    name: rule.name,
                    builtinType,
                    enabledActions,
                    patterns: rule.regexes
                }, index);
            });
    }

    // This compatibility repair intentionally applies only to values read from storage. Direct
    // normalize/save/storage-event paths retain their existing modern and legacy semantics.
    function migrateStoredLegacyAddressLinkPreference(value) {
        if (!value || Array.isArray(value.rules) || !Array.isArray(value.copyPatterns) ||
            value.googleMapsLinks === false || value.copyPatterns.some(rule => rule?.predefined === BuiltinRuleType.ADDRESS)) {
            return value;
        }
        return {
            ...value,
            copyPatterns: [...value.copyPatterns, {
                ...DEFAULT_PATTERNS.find(rule => rule.predefined === BuiltinRuleType.ADDRESS),
                isOn: false
            }]
        };
    }

    function normalizeModernRules(rules) {
        return rules.filter(rule => rule && typeof rule === 'object').map(normalizeModernRule);
    }

    /** @returns {Rule} */
    function normalizeModernRule(rule, index) {
        const builtinType = Object.values(BuiltinRuleType).includes(rule.builtinType) ? rule.builtinType : null;
        const preset = DEFAULT_PATTERNS.find(item => item.predefined === builtinType);
        const possibleActions = builtinType === BuiltinRuleType.ADDRESS
            ? [Action.COPY, Action.OPEN_LINK] : [Action.COPY];
        const requestedActions = Array.isArray(rule.enabledActions) ? rule.enabledActions : [];
        const sources = preset?.regexes || (Array.isArray(rule.patterns) ? rule.patterns : []);
        return {
            id: builtinType ? BUILTIN_IDS[builtinType] : normalizeId(rule.id, rule, index),
            name: preset?.name || (typeof rule.name === 'string' ? rule.name.trim() : ''),
            possibleActions,
            enabledActions: possibleActions.filter(action => requestedActions.includes(action)),
            builtinType,
            patterns: [...new Set(sources.filter(source => typeof source === 'string' && source.trim()))]
        };
    }

    function normalizeId(id, rule, index) {
        if (typeof id === 'string' && UUID.test(id)) return id.toLowerCase();
        const input = JSON.stringify([index, rule.name, rule.patterns, rule.regexes, rule.regex]);
        const hashes = [2166136261, 2166136261 ^ 0x9e3779b9, 2166136261 ^ 0x85ebca6b, 2166136261 ^ 0xc2b2ae35];
        for (let hashIndex = 0; hashIndex < hashes.length; hashIndex++) {
            for (let character = hashIndex; character < input.length; character += hashes.length) {
                hashes[hashIndex] = Math.imul(hashes[hashIndex] ^ input.charCodeAt(character), 16777619) >>> 0;
            }
        }
        const hex = hashes.map(hash => hash.toString(16).padStart(8, '0')).join('');
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
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

    function deepFreeze(value) {
        if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
        for (const child of Object.values(value)) deepFreeze(child);
        return Object.freeze(value);
    }

    class Settings {
        #listeners = new Set();
        #storage;
        #storageChanges;
        #storageListener;
        #value = deepFreeze(normalize());
        #revision = 0;

        constructor(storage = globalThis.chrome?.storage?.local,
            storageChanges = globalThis.chrome?.storage?.onChanged) {
            this.#storage = storage;
            this.#storageChanges = storageChanges;
            this.#storageListener = (changes, area) => {
                if (area === 'local' && Object.hasOwn(changes, STORAGE_KEY)) {
                    this.update(changes[STORAGE_KEY].newValue);
                }
            };
            this.#storageChanges?.addListener?.(this.#storageListener);
        }

        get value() {
            return this.#value;
        }

        get revision() {
            return this.#revision;
        }

        async load() {
            if (!this.#storage?.get) return this.value;
            const revisionBeforeLoad = this.revision;
            const stored = await this.#storage.get(STORAGE_KEY);
            if (this.revision !== revisionBeforeLoad) return this.value;
            const rawValue = stored?.[STORAGE_KEY];
            const normalized = normalize(migrateStoredLegacyAddressLinkPreference(rawValue));
            this.update(normalized);
            // A subscriber may update settings reentrantly; never persist the older loaded value.
            if (JSON.stringify(this.value) !== JSON.stringify(normalized)) return this.value;
            if (rawValue !== undefined && this.#storage.set && JSON.stringify(rawValue) !== JSON.stringify(normalized)) {
                try {
                    await this.#storage.set({ [STORAGE_KEY]: normalized });
                } catch (error) {
                    // Loaded preferences remain usable; retry migration on the next load.
                    console.warn('CopyEmail could not persist migrated settings.', error);
                }
            }
            return this.value;
        }

        async save(value) {
            const revisionBeforeSave = this.revision;
            const normalized = normalize(value);
            if (this.#storage?.set) {
                await this.#storage.set({ [STORAGE_KEY]: normalized });
            }
            if (this.revision === revisionBeforeSave) this.update(normalized);
            return this.value;
        }

        update(value) {
            const normalized = normalize(value);
            if (JSON.stringify(normalized) === JSON.stringify(this.#value)) return false;
            this.#value = deepFreeze(normalized);
            this.#revision++;
            for (const listener of this.#listeners) {
                try {
                    listener(this.#value, this.#revision);
                } catch (error) {
                    console.warn('CopyEmail settings subscriber failed.', error);
                }
            }
            return true;
        }

        isEnabled(hostname) {
            return isEnabled(this.#value, hostname);
        }

        subscribe(listener) {
            this.#listeners.add(listener);
            return () => this.#listeners.delete(listener);
        }

        dispose() {
            this.#storageChanges?.removeListener?.(this.#storageListener);
            this.#listeners.clear();
        }
    }

    return Object.freeze({ Action, Appearance, BuiltinRuleType, Mode, STORAGE_KEY, Settings, normalize,
        parsePatterns, matches, isEnabled });
})();
