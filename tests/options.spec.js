const { test, expect, chromium } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('saves website modes, updates open pages and frames, and restores settings', async () => {
    const extensionPath = path.join(__dirname, '../extension');
    const manifest = JSON.parse(await fs.readFile(path.join(extensionPath, 'manifest.json'), 'utf8'));
    expect(manifest.options_page, 'Extension provides a settings page').toBe('app/options.html');
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
        await options.goto(`chrome-extension://${extensionId}/app/options.html`);
        await options.getByRole('tab', { name: 'Websites', exact: true }).click();
        const everywhere = options.getByRole('radio', { name: 'All sites except…', exact: true });
        const nowhere = options.getByRole('radio', { name: 'Only these sites', exact: true });
        const patterns = options.getByLabel('Website patterns', { exact: true });
        const save = options.getByRole('button', { name: /^Save settings$/i });
        await expect(everywhere).toBeChecked();
        await expect(patterns).toHaveValue('');
        await expect(save).toBeDisabled();

        await nowhere.locator('..').click();
        await expect(save).toBeEnabled();
        await expect(options.getByRole('status')).toHaveText('Unsaved changes.');
        await everywhere.locator('..').click();
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
        await options.getByRole('tab', { name: 'Websites', exact: true }).click();
        await expect(patterns).toHaveValue('copymai?.test');

        await nowhere.locator('..').click();
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
        await expect(save).toBeDisabled();
        await expect(patterns).toHaveAttribute('aria-invalid', 'true');
        await options.reload();
        await options.getByRole('tab', { name: 'Websites', exact: true }).click();
        await expect(nowhere).toBeChecked();
        await expect(patterns).toHaveValue('*.test');

        await everywhere.locator('..').click();
        await patterns.fill('');
        await save.click();
        await expect(button).toBeVisible();
        await options.getByRole('tab', { name: 'Categories', exact: true }).click();
        const rows = options.locator('.rule-row');
        await expect(rows).toHaveCount(3);
        await expect(rows.getByRole('button', { name: 'Delete category' })).toHaveCount(0);
        await expect(options.getByLabel('Email: Copy', { exact: true })).toBeChecked();
        await expect(options.getByLabel('Phone: Copy', { exact: true })).not.toBeChecked();
        await expect(options.getByLabel('Addresses: Maps', { exact: true })).toBeChecked();
        await options.getByRole('button', { name: 'Add category', exact: true }).click();
        const regex = options.getByLabel('Regexes', { exact: true });
        await options.getByLabel('Name', { exact: true }).fill('Orders');
        await regex.fill('ORDER-[0-9]+\n[');
        await options.getByRole('button', { name: 'Save category', exact: true }).click();
        await expect(regex).toHaveAttribute('aria-invalid', 'true');
        await expect(options.locator('#rule-error')).toContainText('Line 2:');
        await regex.fill('ORDER-[0-9]+\nITEM-[0-9]+');
        await options.getByRole('button', { name: 'Save category', exact: true }).click();
        await page.locator('body').evaluate(element => {
            const paragraph = document.createElement('p');
            paragraph.textContent = 'ORDER-123 ITEM-456';
            element.prepend(paragraph);
        });
        const custom = page.getByRole('button', { name: 'Copy ORDER-123', exact: true });
        await expect(custom).toHaveCount(0);
        await save.click();
        await expect(custom).toBeVisible();
        await expect(page.getByRole('button', { name: 'Copy ITEM-456', exact: true })).toBeVisible();
        await options.getByLabel('Email: Copy', { exact: true }).uncheck();
        await save.click();
        await expect(button).toHaveCount(0);
        await expect(custom).toBeVisible();
        await expect(page.getByRole('button', { name: 'Copy ITEM-456', exact: true })).toBeVisible();
        await options.reload();
        await options.getByRole('tab', { name: 'Websites', exact: true }).click();
        await options.getByRole('tab', { name: 'Categories', exact: true }).click();
        await rows.nth(3).getByRole('button', { name: 'Edit category' }).click();
        await expect(regex).toHaveValue('ORDER-[0-9]+\nITEM-[0-9]+');
        await options.getByRole('button', { name: 'Cancel', exact: true }).click();
        await rows.nth(3).getByRole('button', { name: 'Delete category' }).click();
        await save.click();
        await expect(custom).toHaveCount(0);
        await options.screenshot({ path: test.info().outputPath('settings.png'), fullPage: true });
    } finally {
        await context.close();
        await fs.rm(profile, { recursive: true, force: true });
    }
});
