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

for (const ignoreHoverHints of [false, true]) {
    test(`hover hints are ${ignoreHoverHints ? 'ignored when enabled' : 'included when disabled'}`, async ({ page }) => {
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(ignore => {
            window.chrome ??= {};
            chrome.storage = {
                local: { get: async () => ({ websiteSettings: { ignoreHoverHints: ignore } }) },
                onChanged: { addListener(listener) {
                    window.setHoverPreference = ignoreHoverHints => listener({
                        websiteSettings: { newValue: { ignoreHoverHints } }
                    }, 'local');
                } }
            };
        }, ignoreHoverHints);
        await load(page, `
            <style>
                #trigger { display:inline-block; }
                #hint { display:none;position:absolute;background:white;top:90px;left:40px; }
                #trigger:hover #hint, #trigger.pinned #hint { display:block; }
            </style>
            <main style="position:fixed;inset:30px">
            <p>normal@example.com</p>
            <div id="trigger" onclick="this.classList.add('pinned')">Hover for details<div id="hint">hover@example.com</div></div>
            <button id="js-trigger" onmouseenter="document.querySelector('#js-hint').innerHTML = '<div style=&quot;position:absolute;top:160px;left:40px;background:white&quot;>dynamic@example.com</div>'">Dynamic hint</button>
            <div id="js-hint"></div>
            <button id="open" onclick="document.querySelector('#popup').hidden = false">Open popup</button>
            <div id="popup" hidden style="position:absolute;top:220px;left:40px;background:white">clicked@example.com</div>
            <div role="tooltip" style="position:absolute;top:280px;left:40px;background:white">tooltip@example.com</div>
            </main>
        `);
        await expect(copyButton(page, 'normal@example.com')).toBeVisible();
        await page.locator('#trigger').hover();
        await expect(page.locator('#hint')).toBeVisible();
        if (ignoreHoverHints) {
            await expect(copyButton(page, 'hover@example.com')).toHaveCount(0);
            await expect(copyButton(page, 'tooltip@example.com')).toHaveCount(0);
        } else {
            await expect(copyButton(page, 'hover@example.com')).toBeVisible();
            await expect(copyButton(page, 'tooltip@example.com')).toBeVisible();
        }
        if (ignoreHoverHints) {
            await page.locator('#trigger').click();
            await page.mouse.move(900, 650);
            await expect(page.locator('#hint')).toBeVisible();
            await expect(copyButton(page, 'hover@example.com')).toBeVisible();
            await page.locator('#trigger').evaluate(element => element.classList.remove('pinned'));
            await expect(page.locator('#hint')).toBeHidden();
        } else {
            await page.evaluate(() => window.setHoverPreference(true));
            await expect(copyButton(page, 'hover@example.com')).toHaveCount(0);
            await page.evaluate(() => window.setHoverPreference(false));
            await expect(copyButton(page, 'hover@example.com')).toBeVisible();
        }
        await page.locator('#js-trigger').hover();
        await expect(page.locator('#js-hint')).toHaveText('dynamic@example.com');
        // A normal dynamic update proves the debounced scan has processed the hint.
        await page.locator('#js-hint').evaluate(element => {
            element.insertAdjacentHTML('afterend', '<p style="margin-top:240px">updated@example.com</p>');
        });
        await expect(copyButton(page, 'updated@example.com')).toBeVisible();
        if (ignoreHoverHints) {
            await expect(copyButton(page, 'dynamic@example.com')).toHaveCount(0);
        } else {
            await expect(copyButton(page, 'dynamic@example.com')).toBeVisible();
        }
        await page.locator('#open').click();
        await expect(copyButton(page, 'clicked@example.com')).toBeVisible();
        if (ignoreHoverHints) {
            await page.evaluate(() => window.setHoverPreference(false));
            await expect(copyButton(page, 'tooltip@example.com')).toBeVisible();
            await page.evaluate(() => window.setHoverPreference(true));
            await expect(copyButton(page, 'tooltip@example.com')).toHaveCount(0);
        }
        expect(errors).toEqual([]);
    });
}

for (const sample of [
    '<div aria-atomic="true" role="alert" class="js-flash-alert">We sent a confirmation email to volodymyr.vashurkin@controlup.com. Please follow the instructions in it to verify your email.</div>',
    '<span>volodymyr.vashurkin@controlup.com <span id="labels" class="ml-1"><span class="Label Label--accent">Primary</span> <span class="Label Label--warning">Unverified</span></span><div class="note">This email address is the default for GitHub notifications, such as replies to issues, pull requests, and similar activity.</div><div class="note">Your email address is managed by your identity provider.</div></span>'
]) {
    for (const width of [1000, 390]) {
        test(`keeps the copy button clear of following GitHub ${sample.startsWith('<div') ? 'confirmation text' : 'email labels'} at ${width}px`, async ({ page }) => {
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            page.on('console', message => {
                if (message.type() === 'error') {
                    errors.push(message.text());
                }
            });
            await page.setViewportSize({ width, height: 700 });
            await load(page, sample);
            const button = copyButton(page, 'volodymyr.vashurkin@controlup.com');
            await expect(button).toBeVisible();
            const overlaps = await button.evaluate(element => {
                const box = element.getBoundingClientRect();
                const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
                const collisions = [];
                while (walker.nextNode()) {
                    const node = walker.currentNode;
                    for (let index = 0; index < node.length; index++) {
                        if (!node.data[index].trim()) {
                            continue;
                        }
                        const range = document.createRange();
                        range.setStart(node, index);
                        range.setEnd(node, index + 1);
                        for (const rect of range.getClientRects()) {
                            if (rect.left < box.right && rect.right > box.left && rect.top < box.bottom && rect.bottom > box.top) {
                                collisions.push(node.data[index]);
                            }
                        }
                    }
                }
                return collisions;
            });
            expect(overlaps).toEqual([]);
            await page.screenshot({ path: test.info().outputPath('github-spacing.png'), fullPage: true });
            await button.click();
            await expect(button).toHaveAttribute('title', 'Copied!');
            expect(errors).toEqual([]);
        });
    }
}

for (const direction of ['row', 'column']) {
    test(`preserves a popup with a ${direction} flex layout and an email at the end`, async ({ page }) => {
        await load(page, `
            <button id="popup" style="display:flex;flex-direction:${direction};gap:8px;align-items:center;justify-content:center;width:640px;padding:12px 20px;font:24px/32px Arial;border:0;border-radius:12px;background:#39424b;color:white">
                <span>Manage email</span>
                volodymyr.vashurkin@controlup.com
            </button>
            <script>
                const popup = document.querySelector('#popup');
                const email = document.createRange();
                email.selectNode(popup.lastChild);
                window.originalPopupLayout = {
                    popup: popup.getBoundingClientRect().toJSON(),
                    email: email.getBoundingClientRect().toJSON()
                };
            </script>
        `);
        await expect(copyButton(page, 'volodymyr.vashurkin@controlup.com')).toBeVisible();
        const layout = await page.locator('#popup').evaluate(popup => {
            const email = document.createRange();
            const node = [...popup.childNodes].find(node => node.textContent.includes('volodymyr.vashurkin@controlup.com'));
            email.selectNode(node);
            return { popup: popup.getBoundingClientRect().toJSON(), email: email.getBoundingClientRect().toJSON() };
        });
        expect(layout).toEqual(await page.evaluate(() => window.originalPopupLayout));
    });
}

test('reuses button spacing across rescans and removes it with an obsolete match', async ({ page }) => {
    await load(page, '<p id="line">alice@example.com and bob@example.com<span id="suffix"> are contacts.</span></p><div id="updates"></div>');
    await expect(copyButton(page, 'alice@example.com')).toBeVisible();
    await expect(copyButton(page, 'bob@example.com')).toBeVisible();
    const suffix = page.locator('#suffix');
    const initial = await suffix.boundingBox();
    await page.locator('#updates').evaluate(element => element.textContent = 'new@example.com');
    await expect(copyButton(page, 'new@example.com')).toBeVisible();
    await expect(page.getByRole('button')).toHaveCount(3);
    expect(await suffix.boundingBox()).toEqual(initial);
    await expect(page.locator('#line')).toHaveText('alice@example.com and bob@example.com are contacts.');

    await page.locator('#line').evaluate(element => element.firstChild.data = 'alice');
    await expect(copyButton(page, 'alice@example.com')).toHaveCount(0);
    const gap = await page.locator('#line').evaluate(element => {
        const name = document.createRange();
        name.selectNode(element.firstChild);
        const following = document.createRange();
        following.selectNode(element.firstChild.nextSibling);
        return following.getBoundingClientRect().left - name.getBoundingClientRect().right;
    });
    expect(gap).toBeLessThan(1);
});

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
