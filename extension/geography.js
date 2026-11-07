const CopyMailGeography = (() => {
    'use strict';

    let loading;
    let cities = new Set();
    const normalize = value => value.trim().toLowerCase().normalize('NFC');

    // ISO region codes from GeoNames countryInfo; localized names come from browser CLDR.
    const countryCodes = ["AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR", "AS", "AT", "AU", "AW", "AX", "AZ", "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ", "BR", "BS", "BT", "BV", "BW", "BY", "BZ", "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN", "CO", "CR", "CU", "CV", "CW", "CX", "CY", "CZ", "DE", "DJ", "DK", "DM", "DO", "DZ", "EC", "EE", "EG", "EH", "ER", "ES", "ET", "FI", "FJ", "FK", "FM", "FO", "FR", "GA", "GB", "GD", "GE", "GF", "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GS", "GT", "GU", "GW", "GY", "HK", "HM", "HN", "HR", "HT", "HU", "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR", "IS", "IT", "JE", "JM", "JO", "JP", "KE", "KG", "KH", "KI", "KM", "KN", "KP", "KR", "XK", "KW", "KY", "KZ", "LA", "LB", "LC", "LI", "LK", "LR", "LS", "LT", "LU", "LV", "LY", "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK", "ML", "MM", "MN", "MO", "MP", "MQ", "MR", "MS", "MT", "MU", "MV", "MW", "MX", "MY", "MZ", "NA", "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR", "NU", "NZ", "OM", "PA", "PE", "PF", "PG", "PH", "PK", "PL", "PM", "PN", "PR", "PS", "PT", "PW", "PY", "QA", "RE", "RO", "RS", "RU", "RW", "SA", "SB", "SC", "SD", "SS", "SE", "SG", "SH", "SI", "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "ST", "SV", "SX", "SY", "SZ", "TC", "TD", "TF", "TG", "TH", "TJ", "TK", "TL", "TM", "TN", "TO", "TR", "TT", "TV", "TW", "TZ", "UA", "UG", "UM", "US", "UY", "UZ", "VA", "VC", "VE", "VG", "VI", "VN", "VU", "WF", "WS", "YE", "YT", "ZA", "ZM", "ZW", "CS", "AN"];
    const countryNames = ['usa', 'uk', 'united states of america', 'great britain'];
    const locales = ['en', 'pl', 'ru', 'uk', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'cs', 'sk', 'be',
        'ar', 'zh', 'ja', 'ko', 'tr', 'el', 'sv', 'no', 'da', 'fi', 'he', 'hi', 'ro', 'hu', 'bg',
        ...navigator.languages];
    for (const locale of Intl.DisplayNames.supportedLocalesOf(locales)) {
        const names = new Intl.DisplayNames([locale], { type: 'region' });
        for (const code of countryCodes) countryNames.push(normalize(names.of(code)));
    }
    const countries = new Set(countryNames.sort());

    function load() {
        if (!loading) {
            const url = typeof chrome !== 'undefined' && chrome.runtime?.getURL
                ? chrome.runtime.getURL('data/cities.txt')
                : new URL('data/cities.txt', document.currentScript?.src || location.href).href;
            loading = fetch(url).then(response => {
                if (!response.ok) throw new Error(`City data: HTTP ${response.status}`);
                return response.text();
            }).then(text => {
                cities = new Set(text.split('\n').filter(Boolean));
            });
        }
        return loading;
    }

    function contains(text, name) {
        return normalize(text).split(/[,;:\n]+/).some(part =>
            part.trim().replace(/^\d{2}-\d{3}\s+|^\d{4,6}\s+/, '') === normalize(name));
    }

    function find(text) {
        const found = { city: '', country: '' };
        const cityMatches = new Set();
        const countryMatches = new Set();
        for (const fragment of text.split(/[,;:\n]+/)) {
            const name = fragment.trim().replace(/^\d{2}-\d{3}\s+|^\d{4,6}\s+/, '');
            const key = normalize(name);
            if (countries.has(key)) countryMatches.add(name);
            else if (cities.has(key)) cityMatches.add(name);
        }
        // Ambiguous headings must not select an arbitrary city or country.
        if (cityMatches.size === 1) found.city = [...cityMatches][0];
        if (countryMatches.size === 1) found.country = [...countryMatches][0];
        return found;
    }

    return Object.freeze({ load, find, contains, normalize, hasCity: value => cities.has(normalize(value)) });
})();
