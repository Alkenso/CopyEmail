const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

async function load(page, html, settings) {
    let requests = 0;
    await page.route('http://addresses.test/**', route => {
        if (route.request().url().endsWith('/data/cities.txt')) {
            requests++;
            return route.fulfill({ contentType: 'text/plain', path: path.join(__dirname, '../extension/app/data/cities.txt') });
        }
        return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<style>body {font:16px/30px Arial; padding:30px}</style>${html}` });
    });
    await page.goto('http://addresses.test/');
    if (settings) await page.evaluate(value => {
        window.chrome = { storage: { local: { get: async () => ({ websiteSettings: value }) }, onChanged: { addListener(listener) { window.updateSettings = newValue => listener({ websiteSettings: { newValue } }, 'local'); } } } };
    }, settings);
    for (const file of ['settings', 'patterns', 'geography', 'scanner', 'services', 'content', 'bootstrap']) {
        await page.addScriptTag({ path: path.join(__dirname, `../extension/app/${file}.js`) });
    }
    return () => requests;
}

const mapLink = (page, address) => page.getByRole('link', { name: `Open in Google Maps: ${address}`, exact: true });

test('bundled city data is lowercase, sorted, unique and includes translated names', () => {
    const names = fs.readFileSync(path.join(__dirname, '../extension/app/data/cities.txt'), 'utf8').trimEnd().split('\n');
    expect(names.length).toBeGreaterThan(100000);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every(name => name === name.toLowerCase())).toBe(true);
    // Python generation sorts by Unicode code point, including supplementary characters.
    expect(Buffer.from(names.join('\n')).equals(Buffer.from([...names].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))).join('\n')))).toBe(true);
    for (const city of ['warszawa', 'warsaw', 'варшава', 'london', 'londyn']) expect(names).toContain(city);
});

test('Warszawa list enriches both addresses, loads data once, and updates parent context', async ({ page }) => {
    const requests = await load(page, '<section><h2>Polska</h2><div><h3 id="city">Warszawa:</h3><ul><li>Aleja Rzeczypospolitej 18, 02-972 Wilanów</li><li>Aleja Rzeczypospolitej 183, 01-972 Wilanów</li></ul></div></section>');
    for (const number of ['18, 02-972', '183, 01-972']) {
        const address = `Aleja Rzeczypospolitej ${number} Wilanów, Warszawa, Polska`;
        await expect(mapLink(page, address)).toBeVisible();
        expect(new URL(await mapLink(page, address).getAttribute('href')).searchParams.get('query')).toBe(address);
    }
    await page.locator('#city').evaluate(node => node.textContent = 'Kraków:');
    await expect(mapLink(page, 'Aleja Rzeczypospolitej 18, 02-972 Wilanów, Kraków, Polska')).toBeVisible();
    expect(requests()).toBe(1);
    await expect(page.getByRole('button', { name: /^Copy Aleja/ })).toHaveCount(2);
});

test('inline names are not duplicated and unrelated or hidden labels are ignored', async ({ page }) => {
    await load(page, '<section><h2 hidden>Paris</h2><h2>Not a city</h2><ul><li>221B Baker Street, London, United Kingdom</li></ul></section><article><h2>Paris</h2><p>10 Downing Street</p></article>');
    await expect(mapLink(page, '221B Baker Street, London, United Kingdom')).toBeVisible();
    await expect(mapLink(page, '10 Downing Street, Paris')).toBeVisible();
});

test('custom patterns remain simple regex copies even with legacy advanced settings', async ({ page }) => {
    await load(page, '<section><h2>Batch-42</h2><div><p>ORDER-12</p><p>ITEM-34</p></div></section>', {
        copyPatterns: [{ isOn: true, regex: 'ORDER-\\d+|ITEM-\\d+', name: 'Order', parentLevels: 2, parentRegex: 'Batch-\\d+' }]
    });
    await expect(page.getByRole('button', { name: 'Copy ORDER-12', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy ITEM-34', exact: true })).toBeVisible();
    expect(await page.evaluate(() => {
        const pattern = new CopyMailPatterns.RegexPattern('ORDER-\\d+');
        return pattern.valueFor(pattern.matches({ text: 'ORDER-12' })[0], { element: document.querySelector('p') });
    })).toBe('ORDER-12');
});

test('parent lookup stops at configured depth and rejects ambiguous headings', async ({ page }) => {
    await load(page, '<section><h2>Warszawa</h2><div><div><div><div><div><p>10 Downing Street</p></div></div></div></div></div></section><section><h2>Paris, London</h2><p>12 Baker Street</p></section>');
    await expect(mapLink(page, '10 Downing Street')).toBeVisible();
    await expect(mapLink(page, '12 Baker Street')).toBeVisible();
    await page.evaluate(() => CopyMailGeography.load());
    expect(await page.evaluate(() => CopyMailGeography.find('Варшава, Польша'))).toEqual({ city: 'Варшава', country: 'Польша' });
});

test('globe opens the encoded query in a new tab', async ({ page, context }) => {
    await load(page, '<section><h2>Warszawa</h2><p>Aleja Rzeczypospolitej 18</p></section>');
    const link = mapLink(page, 'Aleja Rzeczypospolitej 18, Warszawa');
    await expect(link).toBeVisible();
    await context.route('https://www.google.com/maps/**', route => route.fulfill({ body: 'Map destination' }));
    const popupPromise = page.waitForEvent('popup');
    await link.click();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    expect(new URL(popup.url()).searchParams.get('query')).toBe('Aleja Rzeczypospolitej 18, Warszawa');
    await popup.close();
});

test('globe opens Maps across its full hit area, including transparent edges and corners', async ({ page, context }) => {
    await load(page, '<p>10 Downing Street</p>');
    const link = mapLink(page, '10 Downing Street');
    await expect(link).toBeVisible();
    await context.route('https://www.google.com/maps/**', route => route.fulfill({ body: 'Map destination' }));
    const box = await link.boundingBox();
    for (const y of [0.5, box.height / 2, box.height - 0.5]) {
        for (const x of [0.5, box.width / 2, box.width - 0.5]) {
            expect(await link.evaluate((element, point) => {
                const rect = element.getBoundingClientRect();
                return element.getRootNode().elementFromPoint(rect.x + point.x, rect.y + point.y) === element;
            }, { x, y }), `globe receives clicks at (${x}, ${y})`).toBe(true);
            const popupPromise = page.waitForEvent('popup');
            await page.mouse.click(box.x + x, box.y + y);
            const popup = await popupPromise;
            await popup.waitForLoadState();
            expect(new URL(popup.url()).searchParams.get('query')).toBe('10 Downing Street');
            await popup.close();
        }
    }
});

test('metadata addresses retain map actions and direct body headings supply context', async ({ page }) => {
    await load(page, '<h2>Warszawa</h2><p title="Aleja Rzeczypospolitej 18">Aleja Rzeczy…</p>');
    await expect(mapLink(page, 'Aleja Rzeczypospolitej 18, Warszawa')).toBeVisible();
});

test('pages without address candidates do not load city data', async ({ page }) => {
    const requests = await load(page, '<p>user@example.com</p>');
    await expect(page.getByRole('button', { name: 'Copy user@example.com' })).toBeVisible();
    expect(requests()).toBe(0);
});

test('addresses show copy first, globe second, and copy the enriched value', async ({ page }) => {
    await load(page, '<section><h2>Warszawa</h2><p>Aleja Rzeczypospolitej 18</p></section><textarea aria-label="Paste"></textarea>');
    const address = 'Aleja Rzeczypospolitej 18, Warszawa';
    const copy = page.getByRole('button', { name: `Copy ${address}`, exact: true });
    const globe = mapLink(page, address);
    await expect(copy).toBeVisible();
    await expect(globe).toBeVisible();
    const copyBox = await copy.boundingBox();
    const globeBox = await globe.boundingBox();
    expect(globeBox.x).toBeGreaterThanOrEqual(copyBox.x + copyBox.width);
    expect(await copy.evaluate(node => node.nextElementSibling?.tagName)).toBe('A');
    await copy.click();
    await expect(copy).toHaveAttribute('title', 'Copied!');
    await page.getByRole('textbox', { name: 'Paste' }).focus();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');
    await expect(page.getByRole('textbox', { name: 'Paste' })).toHaveValue(address);
});

test('disabling Google Maps links preserves address copying', async ({ page }) => {
    await load(page, '<section><h2>Warszawa</h2><p>Aleja Rzeczypospolitej 18</p></section>', { googleMapsLinks: false });
    await expect(page.getByRole('button', { name: 'Copy Aleja Rzeczypospolitej 18, Warszawa', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Open in Google Maps:/ })).toHaveCount(0);
});

test('address copy and globe preferences work independently and update live', async ({ page }) => {
    await load(page, '<section><h2>Warszawa</h2><p>Aleja Rzeczypospolitej 18</p></section>', {});
    const address = 'Aleja Rzeczypospolitej 18, Warszawa';
    const copy = page.getByRole('button', { name: `Copy ${address}`, exact: true });
    const globe = mapLink(page, address);
    await expect(copy).toBeVisible();
    for (const [copyEnabled, mapsEnabled] of [[false, true], [false, false], [true, false], [true, true]]) {
        await page.evaluate(({ copyEnabled, mapsEnabled }) => {
            const settings = CopyMailSettings.normalize({ googleMapsLinks: mapsEnabled });
            settings.rules.find(rule => rule.builtinType === 'address').enabledActions = [
                ...(copyEnabled ? ['copy'] : []), ...(mapsEnabled ? ['openLink'] : [])
            ];
            window.updateSettings(settings);
        }, { copyEnabled, mapsEnabled });
        if (copyEnabled) await expect(copy).toBeVisible();
        else await expect(copy).toHaveCount(0);
        if (mapsEnabled) await expect(globe).toBeVisible();
        else await expect(globe).toHaveCount(0);
    }
    expect((await globe.boundingBox()).x).toBeGreaterThan((await copy.boundingBox()).x);
});

test('bare Polish address matches the full line and inherits Warszawa', async ({ page }) => {
    await load(page, '<section><h2>Warszawa:</h2><p>Dubois 9, 00-182, Śródmieście</p></section>');
    const address = 'Dubois 9, 00-182, Śródmieście, Warszawa';
    await expect(page.getByRole('button', { name: `Copy ${address}`, exact: true })).toBeVisible();
    await expect(mapLink(page, address)).toBeVisible();
    await expect(page.locator('copymail-overlay button')).toHaveCount(1);
    await expect(page.locator('copymail-overlay a')).toHaveCount(1);
});

test('native Asian address formats render copy and globe controls', async ({ page }) => {
    const addresses = ['東京都新宿区西新宿2丁目8番1号', '北京市朝阳区建国路88号', '서울특별시 종로구 세종대로 209'];
    await load(page, addresses.map(address => `<p>${address}</p>`).join(''));
    for (const address of addresses) {
        await expect(page.getByRole('button', { name: `Copy ${address}`, exact: true })).toBeVisible();
        await expect(mapLink(page, address)).toBeVisible();
    }
});
