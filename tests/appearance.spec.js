const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');

async function openSurface(page, surface) {
    await page.addInitScript(() => {
        const listeners = [];
        window.chrome = { storage: {
            local: {
                get: async key => ({ [key]: JSON.parse(localStorage.getItem(key) || 'null') }),
                set: async values => {
                    for (const [key, value] of Object.entries(values)) {
                        localStorage.setItem(key, JSON.stringify(value));
                        listeners.forEach(listener => listener({ [key]: { newValue: value } }, 'local'));
                    }
                }
            },
            onChanged: { addListener(listener) { listeners.push(listener); }, removeListener() {} }
        } };
        window.changeAppearance = appearance => chrome.storage.local.set({
            websiteSettings: { ...JSON.parse(localStorage.getItem('websiteSettings') || '{}'), appearance }
        });
    });
    await page.route('http://appearance.test/**', async route => {
        const filename = new URL(route.request().url()).pathname.slice(1);
        const contentType = filename.endsWith('.css') ? 'text/css' : filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.png') ? 'image/png' : 'text/html';
        await route.fulfill({ contentType, body: await fs.readFile(path.join(__dirname, '../extension', filename)) });
    });
    await page.goto(`http://appearance.test/${surface}.html`);
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'system');
}

async function expectScheme(page, scheme) {
    await expect.poll(() => page.evaluate(() => {
        const style = getComputedStyle(document.documentElement);
        const red = Number(style.backgroundColor.match(/[\d.]+/)[0]);
        return red < 100 ? 'dark' : 'light';
    })).toBe(scheme);
}

for (const surface of ['popup', 'options']) {
    test(`${surface} follows system changes and honors explicit appearance overrides`, async ({ page }) => {
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setViewportSize(surface === 'popup' ? { width: 370, height: 585 } : { width: 1000, height: 760 });
        await page.emulateMedia({ colorScheme: 'dark' });
        await openSurface(page, surface);
        await expectScheme(page, 'dark');
        await page.screenshot({ path: test.info().outputPath(`${surface}-dark.png`) });
        await page.emulateMedia({ colorScheme: 'light' });
        await expectScheme(page, 'light');
        await page.evaluate(() => window.changeAppearance('dark'));
        await expectScheme(page, 'dark');
        await page.evaluate(() => window.changeAppearance('light'));
        await page.emulateMedia({ colorScheme: 'dark' });
        await expectScheme(page, 'light');
        await page.reload();
        await expect(page.locator('html')).toHaveAttribute('data-appearance', 'light');
        await expectScheme(page, 'light');
        await page.evaluate(() => window.changeAppearance('system'));
        await expectScheme(page, 'dark');
        expect(errors).toEqual([]);
    });
}

test('appearance selector previews, saves, and restores the preference', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await openSurface(page, 'options');
    await page.getByRole('tab', { name: 'General', exact: true }).click();
    const appearance = page.getByRole('combobox', { name: 'Appearance' });
    await expect(appearance).toHaveValue('system');
    await expect(appearance.locator('option')).toHaveText(['System', 'Light', 'Dark']);
    await appearance.selectOption('dark');
    await expectScheme(page, 'dark');
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Settings saved.');
    await page.reload();
    await expectScheme(page, 'dark');
    await page.getByRole('tab', { name: 'General', exact: true }).click();
    await expect(appearance).toHaveValue('dark');
    await page.setViewportSize({ width: 390, height: 700 });
    await page.screenshot({ path: test.info().outputPath('appearance-settings-dark.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
