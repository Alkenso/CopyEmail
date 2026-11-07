const { test, expect, chromium } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('loads as Manifest V3 and copies full addresses on HTTP, HTTPS and in frames', async () => {
    const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'copymail-test-'));
    const extensionPath = path.join(__dirname, '../extension');
    const context = await chromium.launchPersistentContext(profile, {
        channel: 'chromium',
        headless: true,
        args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
        ignoreDefaultArgs: ['--disable-extensions']
    });
    try {
        const errors = [];
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await context.route('**://copymail.test/**', route => route.fulfill({
            contentType: 'text/html; charset=utf-8',
            body: `
                <div id="popup" tabindex="-1"><p><a href="mailto:full.address@example.com?subject=Hi">full.addr…</a></p></div>
                <section><h2>Warszawa</h2><p>Aleja Rzeczypospolitej 18, 02-972 Wilanów</p></section><textarea id="paste"></textarea><iframe src="http://frame.test/"></iframe>
                <script>
                    const popup = document.querySelector('#popup');
                    popup.focus();
                    for (const type of ['pointerdown', 'mousedown', 'click']) {
                        document.addEventListener(type, event => {
                            if (!popup.contains(event.target)) {
                                popup.hidden = true;
                            }
                        }, true);
                    }
                </script>
            `
        }));
        await context.route('http://frame.test/**', route => route.fulfill({
            contentType: 'text/html; charset=utf-8',
            body: '<p>frame@example.com</p>'
        }));
        for (const protocol of ['http', 'https']) {
            await page.goto(`${protocol}://copymail.test/`);
            const button = page.getByRole('button', { name: 'Copy full.address@example.com', exact: true });
            await expect(button).toBeVisible();
            await expect(page.getByRole('link', { name: 'Open in Google Maps: Aleja Rzeczypospolitej 18, 02-972 Wilanów, Warszawa', exact: true })).toBeVisible();
            await button.evaluate(element => element.click());
            await page.waitForTimeout(100);
            expect(await button.getAttribute('title')).toBe('Copy full.address@example.com');
            await button.click();
            await expect(button).toHaveAttribute('title', 'Copied!');
            await expect(page.locator('#popup')).toBeVisible();
            await page.locator('#paste').focus();
            await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');
            await expect(page.locator('#paste')).toHaveValue('full.address@example.com');
        }
        await page.goto('http://copymail.test/');
        await expect(page.frameLocator('iframe').getByRole('button', { name: 'Copy frame@example.com', exact: true })).toBeVisible();
        await page.evaluate(() => {
            const blob = new Blob(['<p>blob@example.com</p>'], { type: 'text/html' });
            const frame = document.createElement('iframe');
            frame.id = 'blob-frame';
            frame.src = URL.createObjectURL(blob);
            document.body.append(frame);
        });
        await expect(page.frameLocator('#blob-frame').getByRole('button', { name: 'Copy blob@example.com', exact: true })).toBeVisible();
        expect(errors).toEqual([]);

        const demo = await fs.readFile(path.join(__dirname, '../demo.html'), 'utf8');
        await context.route('http://demo.test/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: demo }));
        await page.goto('http://demo.test/');
        await expect(page.getByRole('button', { name: 'Copy hello@example.com', exact: true })).toBeVisible();
        await page.screenshot({ path: test.info().outputPath('demo.png'), fullPage: true });
    } finally {
        await context.close();
        await fs.rm(profile, { recursive: true, force: true });
    }
});
