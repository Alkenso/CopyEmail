const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

async function loadScanner(page, html) {
    await page.setContent(`<main>${html}</main>`);
    for (const file of ['settings', 'patterns', 'scanner']) {
        await page.addScriptTag({ path: path.join(__dirname, `../extension/app/${file}.js`) });
    }
}

test('scanner maps matches across inline nodes to one DOM range', async ({ page }) => {
    await loadScanner(page, '<p>Contact alice@<strong>example.com</strong> today</p>');
    const result = await page.evaluate(() => {
        const rule = { id: 'email', name: 'Email', builtinType: 'email',
            possibleActions: ['copy'], enabledActions: ['copy'],
            patterns: ["[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}"] };
        const scanner = new CopyMailScanner.Scanner({ revision: 1, value: { rules: [rule] } });
        return scanner.scan(document.querySelector('main')).map(detection => ({
            value: detection.value,
            name: detection.rule.name,
            text: detection.location.range.toString(),
            element: detection.location.element.tagName
        }));
    });
    expect(result).toEqual([{ value: 'alice@example.com', name: 'Email',
        text: 'alice@example.com', element: 'STRONG' }]);
});

test('scanner recompiles only after the settings revision changes', async ({ page }) => {
    await loadScanner(page, '<p>ORDER-123 INVOICE-456</p>');
    const result = await page.evaluate(() => {
        const state = { revision: 1, value: { rules: [{ id: 'custom', name: 'Order', builtinType: null,
            possibleActions: ['copy'], enabledActions: ['copy'], patterns: ['ORDER-\\d+'] }] } };
        const scanner = new CopyMailScanner.Scanner(state);
        scanner.scan(document.querySelector('main'));
        const first = scanner.compiledRules;
        scanner.scan(document.querySelector('main'));
        const reused = first === scanner.compiledRules;
        state.value.rules[0].patterns = ['INVOICE-\\d+'];
        state.revision++;
        const values = scanner.scan(document.querySelector('main')).map(item => item.value);
        return { reused, rebuilt: first !== scanner.compiledRules, values };
    });
    expect(result).toEqual({ reused: true, rebuilt: true, values: ['INVOICE-456'] });
});

test('disabled rules are not compiled and actions do not affect address enrichment', async ({ page }) => {
    await loadScanner(page, '<section><h2>Warsaw</h2><p>Marszałkowska 10</p></section>');
    const result = await page.evaluate(() => {
        const geography = {
            load: async () => {},
            find(value) { return value.includes('Warsaw') ? { city: 'Warsaw', country: '' } : { city: '', country: '' }; },
            contains(value, part) { return value.includes(part); }
        };
        const rules = [
            { id: 'off', name: 'Off', builtinType: null, possibleActions: ['copy'], enabledActions: [], patterns: ['Warsaw'] },
            { id: 'address', name: 'Address', builtinType: 'address', possibleActions: ['copy', 'openLink'],
                enabledActions: ['copy'], patterns: ['Marszałkowska\\s+10'] }
        ];
        const scanner = new CopyMailScanner.Scanner({ revision: 1, value: { rules } }, { geography });
        const detections = scanner.scan(document.querySelector('main'));
        return { compiled: scanner.compiledRules.map(item => item.rule.id),
            detections: detections.map(item => ({ value: item.value, actions: scanner.compiledRules
                .find(rule => rule.rule.id === item.rule.id).actions })) };
    });
    expect(result.compiled).toEqual(['address']);
    expect(result.detections).toEqual([{ value: 'Marszałkowska 10, Warsaw', actions: ['copy'] }]);
});

test('earlier rules win overlaps and regex alternatives prefer the longest match', async ({ page }) => {
    await loadScanner(page, '<p>ORDER-123-FINAL</p>');
    const values = await page.evaluate(() => {
        const rules = [
            { id: 'first', name: 'First', builtinType: null, possibleActions: ['copy'], enabledActions: ['copy'],
                patterns: ['ORDER-\\d+', 'ORDER-\\d+-FINAL'] },
            { id: 'second', name: 'Second', builtinType: null, possibleActions: ['copy'], enabledActions: ['copy'],
                patterns: ['ORDER-123'] }
        ];
        return new CopyMailScanner.Scanner({ revision: 1, value: { rules } })
            .scan(document.querySelector('main')).map(item => [item.value, item.rule.id]);
    });
    expect(values).toEqual([['ORDER-123-FINAL', 'first']]);
});

test('metadata overlap uses rule priority before accepting one recovered value', async ({ page }) => {
    await loadScanner(page, '<p title="alice@example.com">alice@exam…</p>');
    const result = await page.evaluate(() => {
        const rules = [
            { id: 'email', name: 'Email', builtinType: 'email', possibleActions: ['copy'], enabledActions: ['copy'],
                patterns: ["[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}"] },
            { id: 'custom', name: 'Custom', builtinType: null, possibleActions: ['copy'], enabledActions: ['copy'],
                patterns: ['alice@example\\.com'] }
        ];
        return new CopyMailScanner.Scanner({ revision: 1, value: { rules } })
            .scan(document.querySelector('main')).map(item => [item.value, item.rule.id]);
    });
    expect(result).toEqual([['alice@example.com', 'email']]);
});

test('metadata abbreviation is validated before address context is appended', async ({ page }) => {
    await loadScanner(page, '<section><h2>Warsaw</h2><p title="Aleja Rzeczypospolitej 18">Aleja…18</p></section>');
    const result = await page.evaluate(() => {
        const geography = {
            load: async () => {},
            find(value) { return value.includes('Warsaw') ? { city: 'Warsaw', country: '' } : { city: '', country: '' }; },
            contains(value, part) { return value.includes(part); }
        };
        const rule = { id: 'address', name: 'Address', builtinType: 'address',
            possibleActions: ['copy', 'openLink'], enabledActions: ['openLink'],
            patterns: ['Aleja Rzeczypospolitej 18'] };
        return new CopyMailScanner.Scanner({ revision: 1, value: { rules: [rule] } }, { geography })
            .scan(document.querySelector('main')).map(item => item.value);
    });
    expect(result).toEqual(['Aleja Rzeczypospolitej 18, Warsaw']);
});

test('address context loads on demand and scanner invalidation can be unsubscribed', async ({ page }) => {
    await loadScanner(page, '<section><h2>Warsaw</h2><p>No address yet</p></section>');
    const result = await page.evaluate(async () => {
        let resolveLoad;
        const ready = new Promise(resolve => { resolveLoad = resolve; });
        let loads = 0;
        let loaded = false;
        const geography = {
            load() { loads++; return ready.then(() => { loaded = true; }); },
            find(value) { return { city: loaded && value.includes('Warsaw') ? 'Warsaw' : '', country: '' }; },
            contains(value, part) { return value.includes(part); }
        };
        const rule = { id: 'address', name: 'Address', builtinType: 'address',
            possibleActions: ['copy', 'openLink'], enabledActions: ['copy'], patterns: ['10 Main Street'] };
        const scanner = new CopyMailScanner.Scanner({ revision: 1, value: { rules: [rule] } }, { geography });
        const root = document.querySelector('main');
        scanner.scan(root);
        const loadsBeforeDetection = loads;
        document.querySelector('p').textContent = '10 Main Street';
        const initial = scanner.scan(root)[0].value;
        scanner.scan(root);
        let calls = 0;
        let removedCalls = 0;
        scanner.subscribe(() => { calls++; });
        const unsubscribe = scanner.subscribe(() => { removedCalls++; });
        unsubscribe();
        resolveLoad();
        await ready;
        await Promise.resolve();
        return { loadsBeforeDetection, loads, initial, calls, removedCalls, enriched: scanner.scan(root)[0].value };
    });
    expect(result).toEqual({ loadsBeforeDetection: 0, loads: 1, initial: '10 Main Street',
        calls: 1, removedCalls: 0, enriched: '10 Main Street, Warsaw' });
});

test('scan hooks are scoped to each scan and report shadow roots', async ({ page }) => {
    await loadScanner(page, '<p>ORDER-1</p><div id="shadow"></div>');
    const result = await page.evaluate(() => {
        const shadow = document.querySelector('#shadow').attachShadow({ mode: 'open' });
        shadow.innerHTML = '<p>ORDER-2</p>';
        const rule = { id: 'order', name: 'Order', builtinType: null,
            possibleActions: ['copy'], enabledActions: ['copy'], patterns: ['ORDER-\\d+'] };
        const scanner = new CopyMailScanner.Scanner({ revision: 1, value: { rules: [rule] } });
        const root = document.querySelector('main');
        const roots = [];
        const first = scanner.scan(root, {
            isIgnored: node => node === document.querySelector('p'),
            onRoot: root => roots.push(root)
        }).map(detection => detection.value);
        return { first, second: scanner.scan(root).map(detection => detection.value),
            reportedShadow: roots.length === 1 && roots[0] === shadow };
    });
    expect(result).toEqual({ first: ['ORDER-2'], second: ['ORDER-1', 'ORDER-2'], reportedShadow: true });
});

test('address patterns use the nearest matching parent pattern', async ({ page }) => {
    await loadScanner(page, '<section><h2>Region: North</h2><div><h3>Region: Central</h3><p>10 Main Street</p></div></section>');
    const value = await page.evaluate(() => {
        const pattern = new CopyMailPatterns.AddressPattern(
            new CopyMailPatterns.RegexPattern('10 Main Street'),
            new CopyMailPatterns.RegexPattern('Region: \\w+'));
        const finding = pattern.matches({ text: '10 Main Street' })[0];
        return pattern.valueFor(finding, { element: document.querySelector('p'), parentElement: element => element.parentElement });
    });
    expect(value).toBe('10 Main Street, Region: Central');
});
