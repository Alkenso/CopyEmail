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
        await options.getByRole('tab', { name: 'Patterns', exact: true }).click();
        const rows = options.locator('#copy-patterns tr');
        await expect(rows).toHaveCount(3);
        await expect(options.getByRole('columnheader')).toHaveText(['', 'Regex (required)', 'Name (optional)', '']);
        await expect(options.locator('[data-action], [data-parent-levels], [data-parent-regex]')).toHaveCount(0);
        await expect(rows.nth(2).getByLabel('Name', { exact: true })).toHaveValue('Addresses');
        await expect(rows.nth(2).getByRole('checkbox')).toBeChecked();
        await expect(rows.getByRole('button', { name: 'Remove pattern' })).toHaveCount(0);
        await expect(rows.nth(0).getByRole('checkbox')).toBeChecked();
        await expect(rows.nth(1).getByRole('checkbox')).not.toBeChecked();
        for (const index of [0, 1, 2]) {
            await expect(rows.nth(index).getByLabel('Regex', { exact: true })).toHaveAttribute('readonly', '');
            await expect(rows.nth(index).getByLabel('Name', { exact: true })).toHaveAttribute('readonly', '');
            await expect(rows.nth(index).getByRole('checkbox')).toBeEnabled();
        }
        await options.getByRole('button', { name: 'Add Pattern', exact: true }).click();
        const regex = rows.nth(3).getByLabel('Regex', { exact: true });
        await expect(save).toBeDisabled();
        await regex.fill('[');
        await expect(regex).toHaveAttribute('aria-invalid', 'true');
        await expect(options.getByRole('button', { name: 'Add Pattern', exact: true })).toBeDisabled();
        await expect(save).toBeDisabled();
        await regex.fill('ORDER-[0-9]+');
        await expect(regex).toHaveAttribute('aria-invalid', 'false');
        await expect(options.getByRole('button', { name: 'Add Pattern', exact: true })).toBeEnabled();
        await page.locator('body').evaluate(element => {
            const paragraph = document.createElement('p');
            paragraph.textContent = 'ORDER-123';
            element.prepend(paragraph);
        });
        const custom = page.getByRole('button', { name: 'Copy ORDER-123', exact: true });
        await expect(custom).toHaveCount(0);
        await save.click();
        await expect(custom).toBeVisible();
        await rows.nth(0).getByRole('checkbox').uncheck();
        await save.click();
        await expect(button).toHaveCount(0);
        await expect(custom).toBeVisible();
        await options.reload();
        await options.getByRole('tab', { name: 'Patterns', exact: true }).click();
        await expect(rows.nth(3).getByLabel('Regex', { exact: true })).toHaveValue('ORDER-[0-9]+');
        await rows.nth(3).getByRole('button', { name: 'Remove pattern' }).click();
        await save.click();
        await expect(custom).toHaveCount(0);
        await options.screenshot({ path: test.info().outputPath('settings.png'), fullPage: true });
    } finally {
        await context.close();
        await fs.rm(profile, { recursive: true, force: true });
    }
});
