const { test, expect, chromium } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('saves website modes, updates open pages and frames, and restores settings', async () => {
    const extensionPath = path.join(__dirname, '../extension');
    const manifest = JSON.parse(await fs.readFile(path.join(extensionPath, 'manifest.json'), 'utf8'));
    expect(manifest.options_page, 'Extension provides a settings page').toBe('options.html');
    const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'copymail-options-'));
    const context = await chromium.launchPersistentContext(profile, {
        channel: 'chromium',
        headless: true,
        args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
        ignoreDefaultArgs: ['--disable-extensions']
    });
    try {
        const page = await context.newPage();
        await context.route('http://copymail.test/**', route => route.fulfill({
            contentType: 'text/html; charset=utf-8',
            body: '<p>settings@example.com</p><iframe src="http://frame.test/"></iframe>'
        }));
        await context.route('http://frame.test/**', route => route.fulfill({
            contentType: 'text/html; charset=utf-8', body: '<p>frame@example.com</p>'
        }));
        await page.goto('http://copymail.test/');
        const button = page.getByRole('button', { name: 'Copy settings@example.com', exact: true });
        const frameButton = page.frameLocator('iframe').getByRole('button', { name: 'Copy frame@example.com', exact: true });
        await expect(button).toBeVisible();
        await expect(frameButton).toBeVisible();

        const options = await context.newPage();
        await options.goto('chrome://extensions');
        const item = options.locator('extensions-item').filter({ hasText: 'CopyEmail' });
        await expect(item).toHaveCount(1);
        const extensionId = await item.getAttribute('id');
        await options.goto(`chrome-extension://${extensionId}/options.html`);
        const everywhere = options.getByRole('radio', { name: 'All sites except…', exact: true });
        const nowhere = options.getByRole('radio', { name: 'Only these sites', exact: true });
        const patterns = options.getByLabel('Website patterns', { exact: true });
        const save = options.getByRole('button', { name: /^Save settings$/i });
        await expect(everywhere).toBeChecked();
        await expect(patterns).toHaveValue('');
        await expect(save).toBeDisabled();

        await nowhere.check();
        await expect(save).toBeEnabled();
        await expect(options.getByRole('status')).toHaveText('Unsaved changes.');
        await everywhere.check();
        await expect(save).toBeDisabled();
        await expect(options.getByRole('status')).toHaveText('');
        await patterns.fill('example.com');
        await expect(save).toBeEnabled();
        await expect(options.getByRole('status')).toHaveText('Unsaved changes.');
        await patterns.fill('');
        await expect(save).toBeDisabled();
        await expect(options.getByRole('status')).toHaveText('');

        await patterns.fill('copymai?.test');
        await save.click();
        await expect(options.getByRole('status')).toHaveText('Settings saved.');
        await expect(save).toBeDisabled();
        await patterns.fill(' COPYMAI?.TEST \ncopymai?.test\n');
        await expect(save).toBeDisabled();
        await expect(options.getByRole('status')).toHaveText('');
        await patterns.fill('other.test');
        await expect(options.getByRole('status')).toHaveText('Unsaved changes.');
        await patterns.fill('copymai?.test');
        await expect(options.getByRole('status')).toHaveText('');
        await expect(save).toBeDisabled();
        await expect(button).toHaveCount(0);
        await expect(frameButton).toHaveCount(0);
        await page.locator('body').evaluate(element => element.append(document.createTextNode('later@example.com')));
        await page.reload();
        await expect(page.locator('copymail-overlay')).toHaveCount(0);
        await options.reload();
        await expect(patterns).toHaveValue('copymai?.test');

        await nowhere.check();
        await save.click();
        await expect(button).toBeVisible();
        await expect(frameButton).toBeVisible();

        await patterns.fill('');
        await save.click();
        await expect(button).toHaveCount(0);
        await patterns.fill('*.test');
        await save.click();
        await expect(button).toBeVisible();

        await patterns.fill('https://copymail.test/');
        await save.click();
        await expect(options.getByRole('status')).toContainText('hostname');
        await options.reload();
        await expect(nowhere).toBeChecked();
        await expect(patterns).toHaveValue('*.test');

        await everywhere.check();
        await patterns.fill('');
        await save.click();
        await expect(button).toBeVisible();
        await options.screenshot({ path: test.info().outputPath('settings.png'), fullPage: true });
    } finally {
        await context.close();
        await fs.rm(profile, { recursive: true, force: true });
    }
});
