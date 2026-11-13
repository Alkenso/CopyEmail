const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');

test('popup lists categories and saves action changes immediately', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
        const listeners = [];
        window.failNextStorage = false;
        window.chrome = {
            storage: {
                onChanged: { addListener(listener) { listeners.push(listener); }, removeListener() {} },
                local: {
                    get: async key => ({ [key]: JSON.parse(localStorage.getItem(key) || 'null') }),
                    set: async values => {
                        if (window.failNextStorage) {
                            window.failNextStorage = false;
                            throw new Error('Storage unavailable');
                        }
                        for (const [key, value] of Object.entries(values)) {
                            const oldValue = JSON.parse(localStorage.getItem(key) || 'null');
                            localStorage.setItem(key, JSON.stringify(value));
                            listeners.forEach(listener => listener({ [key]: { oldValue, newValue: value } }, 'local'));
                        }
                    }
                }
            },
            runtime: { openOptionsPage: async () => {}, getURL: path => `http://popup.test/${path}` },
            tabs: { create: async () => {} }
        };
    });
    await page.route('http://popup.test/**', async route => {
        const filename = new URL(route.request().url()).pathname.slice(1);
        const types = { 'theme.css': 'text/css', 'popup.html': 'text/html', 'popup.css': 'text/css', 'popup.js': 'text/javascript', 'settings.js': 'text/javascript', 'icons/icon48.png': 'image/png' };
        if (!types[filename]) return route.fulfill({ status: 404, body: '' });
        await route.fulfill({ contentType: types[filename], body: await fs.readFile(path.join(__dirname, '../extension/app', filename)) });
    });
    await page.setViewportSize({ width: 370, height: 585 });
    await page.goto('http://popup.test/popup.html');
    await expect(page.getByRole('heading', { name: 'CopyEmail' })).toBeVisible();
    await expect(page.locator('.item')).toHaveCount(3);
    await expect(page.getByText('3 actions enabled', { exact: true })).toBeVisible();

    await expect(page.getByRole('searchbox')).toHaveCount(0);

    const phoneCopy = page.getByRole('checkbox', { name: 'Phone: Copy', exact: true });
    await expect(phoneCopy).not.toBeChecked();
    await phoneCopy.check();
    await expect(page.getByText('4 actions enabled', { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('websiteSettings')).rules.find(rule => rule.builtinType === 'phone').enabledActions)).toEqual(['copy']);
    await phoneCopy.click();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('websiteSettings')).rules.find(rule => rule.builtinType === 'phone').enabledActions)).toEqual([]);
    await phoneCopy.click();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('websiteSettings')).rules.find(rule => rule.builtinType === 'phone').enabledActions)).toEqual(['copy']);
    const maps = page.getByRole('checkbox', { name: 'Addresses: Maps', exact: true });
    await maps.uncheck();
    await expect(page.getByText('3 actions enabled', { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('websiteSettings')).rules.find(rule => rule.builtinType === 'address').enabledActions)).toEqual(['copy']);
    const emailCopy = page.getByRole('checkbox', { name: 'Email: Copy', exact: true });
    await emailCopy.uncheck();
    await expect(page.getByText('2 actions enabled', { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('websiteSettings')).rules.find(rule => rule.builtinType === 'email').enabledActions)).toEqual([]);
    await page.evaluate(() => { window.failNextStorage = true; });
    await phoneCopy.click();
    await expect(phoneCopy).toBeChecked();
    await expect(page.getByRole('status')).toHaveText('Could not save this change. Try again.');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('websiteSettings')).rules.find(rule => rule.builtinType === 'phone').enabledActions)).toEqual(['copy']);
    await page.screenshot({ path: test.info().outputPath('popup.png') });
    expect(errors).toEqual([]);
});
