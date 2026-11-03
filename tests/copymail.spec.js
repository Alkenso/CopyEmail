const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const scriptPath = path.join(__dirname, '../extension/content.js');

async function load(page, html, protocol = 'http') {
    await page.route(`${protocol}://copymail.test/**`, route => route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: `<html><head><style>body { font: 16px/24px Arial; padding: 30px; } p { margin: 24px 0; }</style></head><body>${html}</body></html>`
    }));
    await page.goto(`${protocol}://copymail.test/`);
    if (fs.existsSync(scriptPath)) {
        await page.addScriptTag({ path: path.join(__dirname, '../extension/settings.js') });
        await page.addScriptTag({ path: scriptPath });
    }
}

function copyButton(page, email) {
    return page.getByRole('button', { name: `Copy ${email}`, exact: true });
}

test('finds separate addresses, inline markup, and ignores hidden and editable text', async ({ page }) => {
    await load(page, `
        <p>alice@example.com and bob+news@example.co.uk.</p>
        <p><span>split</span><b>@example.com</b></p>
        <p hidden>hidden@example.com</p>
        <p style="opacity:0">transparent@example.com</p>
        <div contenteditable="true">editing@example.com</div>
        <script>const email = 'script@example.com';</script>
    `);
    await expect(page.getByRole('button')).toHaveCount(3);
    await expect(copyButton(page, 'alice@example.com')).toBeVisible();
    await expect(copyButton(page, 'bob+news@example.co.uk')).toBeVisible();
    await expect(copyButton(page, 'split@example.com')).toBeVisible();
});

test('aligns the icon at the visible trailing edge of a CSS-truncated email', async ({ page }) => {
    await load(page, '<div id="email" style="width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">very.long.address@example.com</div>');
    const button = copyButton(page, 'very.long.address@example.com');
    await expect(button).toBeVisible();
    const textBox = await page.locator('#email').boundingBox();
    const buttonBox = await button.boundingBox();
    expect(buttonBox.x).toBeGreaterThanOrEqual(textBox.x + textBox.width);
    expect(buttonBox.x).toBeLessThan(textBox.x + textBox.width + 8);
    expect(Math.abs(buttonBox.y + buttonBox.height / 2 - textBox.y - textBox.height / 2)).toBeLessThan(2);
});

test('recovers shortened labels from mailto and tooltip without duplicate icons', async ({ page }) => {
    await load(page, `
        <p><a href="mailto:long.name%2Btag@example.com?subject=Hello">long.name…</a></p>
        <p><span title="another.long@example.com">another.long@exa…</span></p>
        <p><a href="mailto:complete@example.com">complete@example.com</a></p>
    `);
    await expect(page.getByRole('button')).toHaveCount(3);
    await expect(copyButton(page, 'long.name+tag@example.com')).toBeVisible();
    await expect(copyButton(page, 'another.long@example.com')).toBeVisible();
    await expect(copyButton(page, 'complete@example.com')).toBeVisible();
});

test('copies only the full email and does not activate its link', async ({ page }) => {
    await load(page, '<a href="mailto:long.name@example.com?subject=Hello">long.name…</a><textarea id="paste"></textarea>');
    await page.evaluate(() => {
        document.querySelector('a').addEventListener('click', () => document.body.dataset.linkClicked = 'yes');
    });
    const button = copyButton(page, 'long.name@example.com');
    await button.click();
    await expect(button).toHaveAttribute('title', 'Copied!');
    await page.locator('#paste').focus();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');
    await expect(page.locator('#paste')).toHaveValue('long.name@example.com');
    await expect(page.locator('body')).not.toHaveAttribute('data-link-clicked', 'yes');
});

for (const dismissEvent of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick', 'focusin']) {
    test(`copying keeps a popup open when it dismisses on outside ${dismissEvent}`, async ({ page }) => {
        await load(page, `
            <div id="popup" tabindex="-1"><p>popup@example.com</p></div>
            <button id="outside">Outside</button>
            <textarea id="paste"></textarea>
            <script>
                const popup = document.querySelector('#popup');
                popup.focus();
                document.addEventListener('${dismissEvent}', event => {
                    if (!popup.contains(event.target)) {
                        popup.hidden = true;
                    }
                }, true);
            </script>
        `, 'https');
        const button = copyButton(page, 'popup@example.com');
        if (dismissEvent === 'dblclick') {
            await button.dblclick();
        } else {
            await button.click();
        }
        await expect(page.locator('#popup')).toBeVisible();
        await expect(button).toHaveAttribute('title', 'Copied!');
        await expect(page.locator('#popup')).toBeFocused();

        if (dismissEvent === 'dblclick') {
            await page.locator('#outside').dblclick();
        } else {
            await page.locator('#outside').click();
        }
        await expect(page.locator('#popup')).toBeHidden();
        await page.locator('#paste').focus();
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');
        await expect(page.locator('#paste')).toHaveValue('popup@example.com');
    });
}

test('tracks updates, visibility, removal and nested scrolling', async ({ page }) => {
    await load(page, '<div id="scroller" style="height:100px;overflow:auto"><p id="email">before@example.com</p><div style="height:400px"></div><p id="later">later@example.com</p></div>');
    await expect(copyButton(page, 'before@example.com')).toBeVisible();
    await expect(copyButton(page, 'later@example.com')).not.toBeVisible();
    await page.locator('#email').evaluate(element => element.textContent = 'after@example.com');
    await expect(copyButton(page, 'after@example.com')).toBeVisible();
    await expect(copyButton(page, 'before@example.com')).toHaveCount(0);
    await page.locator('#scroller').evaluate(element => element.scrollTop = element.scrollHeight);
    await expect(copyButton(page, 'later@example.com')).toBeVisible();
    await expect(copyButton(page, 'after@example.com')).not.toBeVisible();
    await page.locator('#later').evaluate(element => element.remove());
    await expect(copyButton(page, 'later@example.com')).toHaveCount(0);
});

test('does not float an icon over an obscuring element', async ({ page }) => {
    await load(page, '<p id="email">covered@example.com</p><div style="position:fixed;inset:0;background:white;z-index:10"></div>');
    await expect(copyButton(page, 'covered@example.com')).not.toBeVisible();
});

test('does not copy an incomplete address when shortening has no full value', async ({ page }) => {
    await load(page, '<p>long.name@example.co…</p><p>…name@example.com</p><p>known@example.com.</p>');
    await expect(copyButton(page, 'known@example.com')).toBeVisible();
    await expect(page.getByRole('button')).toHaveCount(1);
});

test('finds addresses in open shadow roots and follows their updates', async ({ page }) => {
    await load(page, '<div id="component"></div>');
    await page.locator('#component').evaluate(element => {
        const shadow = element.attachShadow({ mode: 'open' });
        shadow.innerHTML = '<p>shadow@example.com</p>';
        element.className = 'ready';
    });
    await expect(copyButton(page, 'shadow@example.com')).toBeVisible();
    await page.locator('#component p').evaluate(element => element.textContent = 'updated@example.com');
    await expect(copyButton(page, 'updated@example.com')).toBeVisible();
    await expect(copyButton(page, 'shadow@example.com')).toHaveCount(0);
});

test('continues detecting addresses when a page replaces its body', async ({ page }) => {
    await load(page, '<p>before@example.com</p>');
    await expect(copyButton(page, 'before@example.com')).toBeVisible();
    await page.evaluate(() => {
        const body = document.createElement('body');
        body.innerHTML = '<p>replacement@example.com</p>';
        document.body.replaceWith(body);
    });
    await expect(copyButton(page, 'replacement@example.com')).toBeVisible();
    await expect(copyButton(page, 'before@example.com')).toHaveCount(0);
});

test('keeps viewport-edge icons stable instead of hiding behind themselves', async ({ page }) => {
    await load(page, '<span style="position:fixed;right:0;top:50px">edge@example.com</span>');
    const button = copyButton(page, 'edge@example.com');
    await expect(button).toBeVisible();
    const hiddenSamples = await button.evaluate(async element => {
        const samples = [];
        for (let index = 0; index < 16; index++) {
            await new Promise(resolve => setTimeout(resolve, 100));
            samples.push(element.hidden);
        }
        return samples;
    });
    expect(hiddenSamples).not.toContain(true);
});

test('ignores synthetic clicks from the host page', async ({ page }) => {
    await load(page, '<p>untrusted@example.com</p>');
    const button = copyButton(page, 'untrusted@example.com');
    await expect(button).toBeVisible();
    await button.evaluate(element => element.click());
    await page.waitForTimeout(100);
    expect(await button.getAttribute('title')).toBe('Copy untrusted@example.com');
});

test('finds visible email addresses assigned to a web component slot', async ({ page }) => {
    await load(page, '<div id="component"></div>');
    await page.locator('#component').evaluate(element => {
        element.attachShadow({ mode: 'open' }).innerHTML = '<div><slot></slot></div>';
        element.innerHTML = '<span>slotted@example.com</span>';
    });
    await expect(copyButton(page, 'slotted@example.com')).toBeVisible();
    await expect(page.getByRole('button')).toHaveCount(1);
});

test('handles text directly inside a shadow root without disrupting other icons', async ({ page }) => {
    await load(page, '<div id="component"></div><p>normal@example.com</p>');
    await page.locator('#component').evaluate(element => {
        element.attachShadow({ mode: 'open' }).textContent = 'direct@example.com';
        element.className = 'ready';
    });
    await expect(copyButton(page, 'direct@example.com')).toBeVisible();
    await expect(copyButton(page, 'normal@example.com')).toBeVisible();
});

test('keeps keyboard focus on the copy button after an HTTP clipboard write', async ({ page }) => {
    await load(page, '<p>keyboard@example.com</p>');
    const button = copyButton(page, 'keyboard@example.com');
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(button).toHaveAttribute('title', 'Copied!');
    expect(await button.evaluate(element => element.getRootNode().activeElement === element)).toBe(true);
});

test('finds visible addresses inside nested open shadow roots', async ({ page }) => {
    await load(page, '<div id="outer"></div>');
    await page.locator('#outer').evaluate(element => {
        const outer = element.attachShadow({ mode: 'open' });
        outer.innerHTML = '<div id="inner"></div>';
        outer.querySelector('#inner').attachShadow({ mode: 'open' }).innerHTML = '<p>nested@example.com</p>';
        element.className = 'ready';
    });
    await expect(copyButton(page, 'nested@example.com')).toBeVisible();
});

test('aligns a slotted email to its clipping container inside a web component', async ({ page }) => {
    await load(page, '<div id="component"></div>');
    await page.locator('#component').evaluate(element => {
        element.attachShadow({ mode: 'open' }).innerHTML = '<div id="clip" style="width:80px;overflow:hidden;white-space:nowrap"><slot></slot></div>';
        element.innerHTML = '<span>very.long.address@example.com</span>';
    });
    const button = copyButton(page, 'very.long.address@example.com');
    await expect(button).toBeVisible();
    const box = await page.locator('#clip').boundingBox();
    const buttonBox = await button.boundingBox();
    expect(buttonBox.x).toBeGreaterThanOrEqual(box.x + box.width);
    expect(buttonBox.x).toBeLessThan(box.x + box.width + 8);
});
