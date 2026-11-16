const { test, expect, chromium } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const totalClicks = days => days.flatMap(Object.values).reduce((sum, count) => sum + count, 0);

test('persists clicks across tabs and frames immediately and restores them after browser restart', async () => {
    const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'copymail-statistics-'));
    const extensionPath = path.join(__dirname, '../extension');
    const launchOptions = {
        channel: 'chromium', headless: true,
        args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
        ignoreDefaultArgs: ['--disable-extensions']
    };
    let context = await chromium.launchPersistentContext(profile, launchOptions);
    try {
        await context.route('http://statistics.test/**', route => route.fulfill({
            contentType: 'text/html',
            body: new URL(route.request().url()).pathname === '/frame'
                ? '<p>frame@example.com</p>'
                : '<p>test@example.com</p><p>10 Downing Street, London</p><iframe src="/frame"></iframe>'
        }));
        await context.route('https://www.google.com/maps/**', route => route.fulfill({ body: 'Maps' }));
        const first = await context.newPage();
        const second = await context.newPage();
        await Promise.all([first.goto('http://statistics.test/'), second.goto('http://statistics.test/')]);
        const copy = first.getByRole('button', { name: 'Copy test@example.com', exact: true });
        await expect(copy).toBeVisible();
        await copy.evaluate(button => button.click()); // Synthetic events must not count.
        await Promise.all([
            copy.click(),
            second.getByRole('button', { name: 'Copy test@example.com', exact: true }).click()
        ]);
        await first.frameLocator('iframe').getByRole('button', { name: 'Copy frame@example.com', exact: true }).click();
        const maps = first.getByRole('link', { name: 'Open in Google Maps: 10 Downing Street, London', exact: true });
        await maps.evaluate(link => link.dispatchEvent(new MouseEvent('click')));
        const opened = context.waitForEvent('page');
        await maps.click();
        await (await opened).close();

        const worker = context.serviceWorkers()[0];
        expect(worker).toBeTruthy();
        const extensionId = new URL(worker.url()).host;
        const popup = await context.newPage();
        await popup.goto(`chrome-extension://${extensionId}/app/popup.html`);
        await expect(popup.locator('#statistics')).toHaveText('Copies: week: 4 · month: 4 · total: 4');
        const saved = await popup.evaluate(async () => (await chrome.storage.local.get('actionStatistics')).actionStatistics);
        expect(totalClicks(saved.copy)).toBe(3);
        expect(totalClicks(saved.openLink)).toBe(1);
        await popup.screenshot({ path: test.info().outputPath('statistics-popup.png') });
        await context.close();
        context = await chromium.launchPersistentContext(profile, launchOptions);
        const reopened = await context.newPage();
        await reopened.goto(`chrome-extension://${extensionId}/app/popup.html`);
        await expect(reopened.locator('#statistics')).toHaveText('Copies: week: 4 · month: 4 · total: 4');
        const stored = await reopened.evaluate(async () => (await chrome.storage.local.get('actionStatistics')).actionStatistics);
        expect(totalClicks(stored.copy)).toBe(3);
        expect(totalClicks(stored.openLink)).toBe(1);
    } finally {
        await context.close();
        await fs.rm(profile, { recursive: true, force: true });
    }
});
