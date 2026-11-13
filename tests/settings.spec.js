const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function settingsModule() {
    const filename = path.join(__dirname, '../extension/app/settings.js');
    expect(fs.existsSync(filename), 'Shared website settings implementation exists').toBe(true);
    return vm.runInNewContext(`${fs.readFileSync(filename, 'utf8')}\nCopyMailSettings;`);
}

test('website wildcards match entire hostnames, with only star and question mark special', () => {
    const settings = settingsModule();
    const cases = [
        ['example.com', 'example.com', true],
        ['example.com', 'www.example.com', false],
        ['example.com', 'example.com.evil.test', false],
        ['example.com', 'notexample.com', false],
        ['*.example.com', 'mail.example.com', true],
        ['*.example.com', 'nested.mail.example.com', true],
        ['*.example.com', 'example.com', false],
        ['mail?.example.com', 'mail1.example.com', true],
        ['mail?.example.com', 'mail12.example.com', false],
        ['mail?.example.com', 'mail.example.com', false],
        ['EXAMPLE.COM', 'example.com', true],
        ['example.com', 'EXAMPLE.COM', true],
        ['example.com', 'exampleXcom', false],
        ['[ab].example.com', 'a.example.com', false],
        ['*', 'anything.test', true],
        ['a*b*c', 'axybzzc', true],
        ['a*b*c', 'axybzzd', false]
    ];
    for (const [pattern, hostname, expected] of cases) {
        expect(settings.matches(pattern, hostname), `${pattern} against ${hostname}`).toBe(expected);
    }
});

test('empty lists and matching lists have opposite effects in the two modes', () => {
    const settings = settingsModule();
    expect(settings.isEnabled(settings.normalize(), 'example.com')).toBe(true);
    expect(settings.isEnabled({ mode: settings.Mode.EXCLUDE, patterns: [] }, 'example.com')).toBe(true);
    expect(settings.isEnabled({ mode: settings.Mode.INCLUDE, patterns: [] }, 'example.com')).toBe(false);
    expect(settings.isEnabled({ mode: settings.Mode.EXCLUDE, patterns: ['*.example.com'] }, 'mail.example.com')).toBe(false);
    expect(settings.isEnabled({ mode: settings.Mode.EXCLUDE, patterns: ['*.example.com'] }, 'other.test')).toBe(true);
    expect(settings.isEnabled({ mode: settings.Mode.INCLUDE, patterns: ['*.example.com'] }, 'mail.example.com')).toBe(true);
    expect(settings.isEnabled({ mode: settings.Mode.INCLUDE, patterns: ['*.example.com'] }, 'other.test')).toBe(false);
});

test('parses one pattern per line and rejects URLs or ports instead of silently ignoring them', () => {
    const settings = settingsModule();
    expect(Array.from(settings.parsePatterns(' EXAMPLE.com \n\n*.example.com\r\nexample.com'))).toEqual(['example.com', '*.example.com']);
    for (const invalid of ['https://example.com', 'example.com/path', 'example.com:8080', 'two words']) {
        expect(() => settings.parsePatterns(invalid)).toThrow(/hostname/i);
    }
});

test('rules default safely and preserve explicitly empty legacy lists', () => {
    const settings = settingsModule();
    const defaults = settings.normalize().rules;
    expect(defaults.map(rule => rule.name)).toEqual(['Email', 'Phone', 'Addresses']);
    expect(defaults.map(rule => rule.enabledActions)).toEqual([
        ['copy'], [], ['copy', 'openLink']
    ]);
    expect(settings.normalize({ copyPatterns: [] }).rules).toHaveLength(0);
});

test('ignoring hover hints defaults on and preserves an explicit preference', () => {
    const settings = settingsModule();
    for (const value of [undefined, {}, { ignoreHoverHints: true }]) {
        expect(settings.normalize(value).ignoreHoverHints).toBe(true);
    }
    const enabled = settings.normalize({ ignoreHoverHints: true });
    expect(enabled.ignoreHoverHints).toBe(true);
    expect(settings.normalize(enabled).ignoreHoverHints).toBe(true);
    const disabled = settings.normalize({ ignoreHoverHints: false });
    expect(disabled.ignoreHoverHints).toBe(false);
    expect(settings.normalize(disabled).ignoreHoverHints).toBe(false);
});
