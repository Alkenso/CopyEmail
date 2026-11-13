const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function modules() {
    const sources = ['settings', 'patterns', 'scanner'].map(file => fs.readFileSync(path.join(__dirname, `../extension/app/${file}.js`), 'utf8')).join('\n');
    return vm.runInNewContext(`${sources}\n({ settings: CopyMailSettings, patterns: CopyMailPatterns, Scanner: CopyMailScanner.Scanner })`);
}

const formatExamples = [
    ['US / UK', '123 W Main St Apt 12, Springfield, IL 62704'],
    ['Polish bare street', 'Dubois 9, 00-182, Śródmieście'],
    ['Polish street type', 'Aleja Rzeczypospolitej 18, 02-972 Wilanów'],
    ['Germanic street suffix', 'Friedrichstraße 12, 10117 Berlin'],
    ['French number first', '10 rue de la Paix, 75002 Paris'],
    ['Southern European street first', 'Via Roma 10/bis, 00100 Roma'],
    ['Japanese block notation', '東京都新宿区西新宿2丁目8番1号'],
    ['Chinese road and premises', '北京市朝阳区建国路88号'],
    ['Korean road and building', '서울특별시 종로구 세종대로 209'],
    ['India / Singapore postal address', '10 Eunos Road 8, #01-38, Singapore 408600']
];

for (const [index, [format, text]] of formatExamples.entries()) {
    test(`address format ${index + 1}: ${format}`, () => {
        const { settings, patterns } = modules();
        const address = settings.normalize().rules.find(rule => rule.builtinType === 'address');
        expect(address.patterns).toHaveLength(10);
        expect([...text.matchAll(patterns.validateRegex(address.patterns[index]))].map(match => match[0])).toEqual([text]);
        expect(new patterns.AddressPattern(new patterns.OrPattern(address.patterns.map(source => new patterns.RegexPattern(source)))).matches({ text }).map(match => match.text)).toEqual([text]);
    });
}

test('address variants retain house numbers and reject ordinary numbers and prose', () => {
    const { settings, patterns } = modules();
    const rule = settings.normalize().rules.find(rule => rule.builtinType === 'address');
    const pattern = new patterns.AddressPattern(new patterns.OrPattern(rule.patterns.map(source => new patterns.RegexPattern(source))));
    for (const text of ['221B Baker Street, London', '33 1/2 Main Street', 'Museumstraat 12', 'Calle Mayor 10',
        '霞ヶ関1丁目3-2', '3-16-4 Wakabayashi', '188 Dokseodang-ro, Seongdong-gu', 'No. 3 Financial Street',
        '12 MG Road, Bengaluru 560001']) {
        expect(pattern.matches({ text }).map(match => match.text), text).toEqual([text]);
    }
    for (const text of ['Order 123', 'Meeting at 10:30', '2026-11-07', 'Version 3.16.4',
        'Total 123456', 'https://example.com/orders/123', 'Call +1 212 555 0123']) {
        expect(pattern.matches({ text }), text).toHaveLength(0);
    }
});

test('migrates legacy rules without losing disabled state or custom regexes', () => {
    const { settings } = modules();
    const saved = settings.normalize({ copyPatterns: [
        { predefined: null, regex: 'ORDER-\\d+', name: '', isOn: false },
        { predefined: 'address', regex: 'old-address-regex', name: 'Address', isOn: false }
    ] });
    expect(saved.rules[0].name).toBe('Custom rule 1');
    expect(saved.rules[0].patterns).toEqual(['ORDER-\\d+']);
    expect(saved.rules[0].enabledActions).toEqual([]);
    expect(saved.rules[1].patterns).toHaveLength(10);
    expect(saved.rules[1].enabledActions).toEqual(['openLink']);
    expect(settings.normalize(saved)).toEqual(saved);
});

test('OR alternatives preserve backreferences and prefer longest overlapping match', () => {
    const { patterns } = modules();
    const pattern = new patterns.OrPattern([String.raw`(AB)\1`, String.raw`(xy)\1`, String.raw`ORDER-\d+`, String.raw`ORDER-\d+-FINAL`]
        .map(source => new patterns.RegexPattern(source)));
    expect(pattern.matches({ text: 'ABAB xyxy ORDER-123-FINAL' }).map(match => match.text)).toEqual(['ABAB', 'xyxy', 'ORDER-123-FINAL']);
    const duplicate = new patterns.OrPattern([String.raw`ORDER-\d+`, 'ORDER-123'].map(source => new patterns.RegexPattern(source)));
    expect(duplicate.matches({ text: 'ORDER-123' })).toHaveLength(1);
});

test('regex migration preserves significant whitespace and modern custom-only rules stay custom-only', () => {
    const { settings } = modules();
    const legacy = settings.normalize({ copyPatterns: [{ regex: ' foo ', name: 'Spaced', isOn: true }] });
    expect(legacy.rules[0].patterns).toEqual([' foo ']);
    const modern = settings.normalize({ copyPatterns: [{ regexes: [' foo ', '', ' foo '], name: 'Spaced', isOn: true }] });
    expect(modern.rules).toHaveLength(1);
    expect(modern.rules[0].patterns).toEqual([' foo ']);
    expect(settings.normalize(modern)).toEqual(modern);
});

test('comma-separated street addresses produce separate targets with correct offsets', () => {
    const { settings, patterns } = modules();
    const rule = settings.normalize().rules.find(rule => rule.builtinType === 'address');
    const pattern = new patterns.AddressPattern(new patterns.OrPattern(rule.patterns.map(source => new patterns.RegexPattern(source))));
    const text = '10 Main Street, 20 High Street';
    expect(pattern.matches({ text }).map(match => ({ text: match.text, index: match.index }))).toEqual([
        { text: '10 Main Street', index: 0 }, { text: '20 High Street', index: 16 }
    ]);
});

test('a rule without a required name is not activated', () => {
    const { settings, Scanner } = modules();
    const settingsValue = settings.normalize({ copyPatterns: [{ name: ' ', isOn: true, regexes: ['ORDER-\\d+'] }] });
    const scanner = new Scanner({ value: settingsValue, revision: 0 });
    scanner.refreshCompiledRules();
    expect(scanner.compiledRules).toHaveLength(0);
});

test('regex validation supports Unicode and existing non-Unicode expressions', () => {
    const { patterns } = modules();
    expect(() => patterns.validateRegex('')).toThrow('Regex is required');
    expect(() => patterns.validateRegex('[')).toThrow();
    expect('Élodie'.match(patterns.validateRegex(String.raw`\p{L}+`))).toEqual(['Élodie']);
    expect(patterns.validateRegex(String.raw`\_`)).toBeTruthy();
});
