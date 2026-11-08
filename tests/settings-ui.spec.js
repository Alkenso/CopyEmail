const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');

test('settings uses the new category design and restores saved preferences', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
        window.chrome ??= {};
        const listeners = [];
        window.sendStorage = value => {
            const key = 'websiteSettings';
            const oldValue = JSON.parse(localStorage.getItem(key) || 'null');
            localStorage.setItem(key, JSON.stringify(value));
            listeners.forEach(listener => listener({ [key]: { oldValue, newValue: value } }, 'local'));
        };
        chrome.storage = {
            onChanged: { addListener(listener) { listeners.push(listener); }, removeListener() {} },
            local: {
                get: async key => ({ [key]: JSON.parse(localStorage.getItem(key) || 'null') }),
                set: async values => {
                    for (const [key, value] of Object.entries(values)) localStorage.setItem(key, JSON.stringify(value));
                }
            }
        };
    });
    await page.route('http://options.test/**', async route => {
        const filename = new URL(route.request().url()).pathname.slice(1);
        const types = { 'theme.css': 'text/css', 'options.html': 'text/html', 'options.css': 'text/css', 'options.js': 'text/javascript', 'settings.js': 'text/javascript', 'icons/icon48.png': 'image/png' };
        if (!types[filename]) return route.fulfill({ status: 404, body: '' });
        await route.fulfill({ contentType: types[filename], body: await fs.readFile(path.join(__dirname, '../extension', filename)) });
    });
    await page.goto('http://options.test/options.html');
    await expect(page.getByRole('tab')).toHaveText(['Categories', 'Websites', 'General']);
    await expect(page.locator('.rule-row')).toHaveCount(3);
    await expect(page.getByRole('checkbox', { name: 'Addresses: Maps', exact: true })).toBeChecked();
    await page.getByRole('tab', { name: 'General', exact: true }).click();
    const checkbox = page.getByRole('checkbox', { name: /^Ignore hover hints/ });
    const save = page.getByRole('button', { name: 'Save settings', exact: true });
    await expect(checkbox).toBeChecked();
    await expect(save).toBeDisabled();
    await checkbox.uncheck();
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByRole('status')).toHaveText('Settings saved.');
    await page.reload();
    await page.getByRole('tab', { name: 'General', exact: true }).click();
    await expect(checkbox).not.toBeChecked();
    await checkbox.check();
    await page.evaluate(() => {
        const value = JSON.parse(localStorage.getItem('websiteSettings'));
        value.mode = 'nowhere-but';
        window.sendStorage(value);
    });
    await expect(page.getByRole('status')).toHaveText('Settings changed in another view. Reload before saving.');
    await expect(page.getByRole('button', { name: 'Reload saved', exact: true })).toBeVisible();
    await expect(save).toBeDisabled();
    await page.getByRole('button', { name: 'Reload saved', exact: true }).click();
    await expect(checkbox).not.toBeChecked();
    await page.getByRole('tab', { name: 'Websites', exact: true }).click();
    await expect(page.getByRole('radio', { name: 'Only these sites', exact: true })).toBeChecked();
    await page.evaluate(() => {
        const value = JSON.parse(localStorage.getItem('websiteSettings'));
        value.ignoreHoverHints = true;
        window.sendStorage(value);
    });
    await page.getByRole('tab', { name: 'General', exact: true }).click();
    await expect(checkbox).toBeChecked();
    await expect(page.getByRole('status')).toHaveText('Updated from another view.');
    await page.setViewportSize({ width: 390, height: 700 });
    await expect(checkbox).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('settings-narrow.png'), fullPage: true });
    expect(errors).toEqual([]);
});
