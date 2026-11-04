const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');

test('the third Settings tab defaults hover filtering on and restores saved preferences', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
        window.chrome ??= {};
        chrome.storage = {
            local: {
                get: async key => ({ [key]: JSON.parse(localStorage.getItem(key) || 'null') }),
                set: async values => {
                    for (const [key, value] of Object.entries(values)) {
                        localStorage.setItem(key, JSON.stringify(value));
                    }
                }
            }
        };
    });
    await page.route('http://options.test/**', async route => {
        const filename = new URL(route.request().url()).pathname.slice(1);
        const types = { 'options.html': 'text/html', 'options.css': 'text/css', 'options.js': 'text/javascript', 'settings.js': 'text/javascript' };
        if (!types[filename]) {
            await route.fulfill({ status: 404, body: '' });
            return;
        }
        await route.fulfill({ contentType: types[filename], body: await fs.readFile(path.join(__dirname, '../extension', filename)) });
    });
    await page.goto('http://options.test/options.html');
    await expect(page.getByRole('tab')).toHaveText(['Websites', 'Patterns', 'Settings']);
    await page.getByRole('tab', { name: 'Settings', exact: true }).click();
    const checkbox = page.getByRole('checkbox', { name: 'Ignore hover hints', exact: true });
    const save = page.getByRole('button', { name: 'Save Settings', exact: true });
    await expect(checkbox).toBeChecked();
    await expect(save).toBeDisabled();
    await checkbox.uncheck();
    await expect(save).toBeEnabled();
    await checkbox.check();
    await expect(save).toBeDisabled();
    await checkbox.uncheck();
    await save.click();
    await expect(page.getByRole('status')).toHaveText('Settings saved.');
    await page.reload();
    await page.getByRole('tab', { name: 'Settings', exact: true }).click();
    await expect(checkbox).not.toBeChecked();
    await checkbox.check();
    await save.click();
    await expect(page.getByRole('status')).toHaveText('Settings saved.');
    await page.reload();
    await page.getByRole('tab', { name: 'Settings', exact: true }).click();
    await expect(checkbox).toBeChecked();
    await page.screenshot({ path: test.info().outputPath('settings-tab.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 700 });
    await expect(checkbox).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('settings-tab-narrow.png'), fullPage: true });
    expect(errors).toEqual([]);
});
