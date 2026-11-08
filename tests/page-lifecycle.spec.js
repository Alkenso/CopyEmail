const { test, expect } = require('@playwright/test');
const path = require('node:path');

const extensionDirectory = path.join(__dirname, '../extension');

async function loadPageLayer(page, html = '<p>person@example.com</p>') {
    await page.setContent(html);
    for (const file of ['settings', 'patterns', 'geography', 'scanner', 'services', 'content']) {
        await page.addScriptTag({ path: path.join(extensionDirectory, `${file}.js`) });
    }
}

test('start is idempotent and disposal during settings load cannot resurrect the page', async ({ page }) => {
    await loadPageLayer(page);

    const result = await page.evaluate(async () => {
        let finishLoad;
        let loadCount = 0;
        const storage = {
            get() {
                loadCount++;
                return new Promise(resolve => { finishLoad = resolve; });
            }
        };
        const settings = new CopyMailSettings.Settings(storage);
        const scanner = new CopyMailScanner.Scanner(settings, { geography: CopyMailGeography });
        const services = new CopyMailServices.ServiceCollection();
        const augmenter = new PageAugmenter(settings, scanner, services);

        const firstStart = augmenter.start();
        await augmenter.start();
        augmenter.dispose();
        augmenter.lastHoverTime = 123;
        window.dispatchEvent(new KeyboardEvent('keydown'));
        finishLoad({});
        await firstStart;

        return {
            loadCount,
            started: augmenter.started,
            enabled: augmenter.enabled,
            overlayConnected: augmenter.host.isConnected,
            scannerListeners: scanner.listeners.size,
            lastHoverTime: augmenter.lastHoverTime
        };
    });

    expect(result).toEqual({
        loadCount: 1,
        started: false,
        enabled: false,
        overlayConnected: false,
        scannerListeners: 0,
        lastHoverTime: 123
    });
});

test('dispose releases subscriptions, observers, timers, controls, and spacers', async ({ page }) => {
    await loadPageLayer(page, '<p>person@example.com has an account on this website</p>');

    const before = await page.evaluate(async () => {
        const settings = new CopyMailSettings.Settings({ get: async () => ({}) });
        const scanner = new CopyMailScanner.Scanner(settings, { geography: CopyMailGeography });
        const services = new CopyMailServices.ServiceCollection();
        const augmenter = new PageAugmenter(settings, scanner, services);
        await augmenter.start();
        const spacer = [...augmenter.records.values()][0]?.spacer;
        window.pageLifecycle = { augmenter, scanner, settings, spacer };
        return {
            enabled: augmenter.enabled,
            controls: augmenter.shadow.querySelectorAll('button, a').length,
            scannerListeners: scanner.listeners.size,
            observedRoots: augmenter.observedRoots.size,
            spacerConnected: spacer?.isConnected || false
        };
    });

    expect(before.enabled).toBe(true);
    expect(before.controls).toBe(1);
    expect(before.scannerListeners).toBe(1);
    expect(before.observedRoots).toBeGreaterThan(0);
    expect(before.spacerConnected).toBe(true);
    const copyButton = page.getByRole('button', { name: 'Copy person@example.com', exact: true });
    await copyButton.click();
    await expect(copyButton).toHaveAttribute('title', 'Copied!');

    const after = await page.evaluate(async () => {
        const { augmenter, scanner, settings, spacer } = window.pageLifecycle;
        augmenter.dispose();
        document.body.append(' second@example.com');
        settings.update({ ignoreHoverHints: false });
        scanner.invalidate();
        await new Promise(resolve => setTimeout(resolve, 150));
        return {
            started: augmenter.started,
            enabled: augmenter.enabled,
            overlayConnected: augmenter.host.isConnected,
            records: augmenter.records.size,
            scannerListeners: scanner.listeners.size,
            observedRoots: augmenter.observedRoots.size,
            spacerConnected: spacer.isConnected,
            buttonResetTimers: augmenter.buttonResetTimers.size,
            scanTimer: augmenter.scanTimer,
            layoutFrame: augmenter.layoutFrame,
            layoutTimer: augmenter.layoutTimer
        };
    });

    expect(after).toEqual({
        started: false,
        enabled: false,
        overlayConnected: false,
        records: 0,
        scannerListeners: 0,
        observedRoots: 0,
        spacerConnected: false,
        buttonResetTimers: 0,
        scanTimer: 0,
        layoutFrame: 0,
        layoutTimer: 0
    });
    await expect(page.locator('copymail-overlay')).toHaveCount(0);
});

test('a failed scan preserves prior shadow-root observation and existing controls', async ({ page }) => {
    await loadPageLayer(page, '<div id="shadow-host"></div>');
    await page.evaluate(() => {
        document.querySelector('#shadow-host').attachShadow({ mode: 'open' }).innerHTML =
            '<p id="address">first@example.com</p>';
    });

    const state = await page.evaluate(async () => {
        const settings = new CopyMailSettings.Settings({ get: async () => ({}) });
        const scanner = new CopyMailScanner.Scanner(settings, { geography: CopyMailGeography });
        const services = new CopyMailServices.ServiceCollection();
        const augmenter = new PageAugmenter(settings, scanner, services);
        await augmenter.start();

        const originalCommands = services.commands.bind(services);
        services.commands = () => { throw new Error('deliberate scan failure'); };
        let message = '';
        try {
            augmenter.scan();
        } catch (error) {
            message = error.message;
        }
        const controlsAfterFailure = augmenter.shadow.querySelectorAll('button, a').length;
        services.commands = originalCommands;
        document.querySelector('#shadow-host').shadowRoot.querySelector('#address').textContent =
            'second@example.com';
        await new Promise(resolve => setTimeout(resolve, 150));

        return {
            message,
            controlsAfterFailure,
            titles: [...augmenter.shadow.querySelectorAll('button')].map(button => button.title),
            observedRoots: augmenter.observedRoots.size
        };
    });

    expect(state.message).toBe('deliberate scan failure');
    expect(state.controlsAfterFailure).toBe(1);
    expect(state.titles).toContain('Copy second@example.com');
    expect(state.observedRoots).toBeGreaterThan(1);
});

test('overlapping and pending copies cannot leave reset timers after disposal', async ({ page }) => {
    await loadPageLayer(page);
    const result = await page.evaluate(async () => {
        const settings = new CopyMailSettings.Settings({ get: async () => ({}) });
        const augmenter = new PageAugmenter(settings, new CopyMailScanner.Scanner(settings),
            new CopyMailServices.ServiceCollection());
        await augmenter.start();
        const completeCopies = [];
        augmenter.copyValue = () => new Promise(resolve => completeCopies.push(resolve));
        const copy = augmenter.copyActions.get(augmenter.shadow.querySelector('button'));
        const resetTimers = new Set();
        const originalSetTimeout = window.setTimeout;
        const originalClearTimeout = window.clearTimeout;
        window.setTimeout = (callback, delay) => {
            const timer = originalSetTimeout(callback, delay);
            if (delay === 1500) resetTimers.add(timer);
            return timer;
        };
        window.clearTimeout = timer => {
            resetTimers.delete(timer);
            originalClearTimeout(timer);
        };
        try {
            const first = copy();
            const second = copy();
            completeCopies.shift()();
            await first;
            completeCopies.shift()();
            await second;
            const timersAfterCopies = resetTimers.size;
            const pending = copy();
            augmenter.dispose();
            completeCopies.shift()();
            await pending;
            return { timersAfterCopies, timersAfterDisposal: resetTimers.size };
        } finally {
            for (const timer of resetTimers) originalClearTimeout(timer);
            window.setTimeout = originalSetTimeout;
            window.clearTimeout = originalClearTimeout;
        }
    });
    expect(result).toEqual({ timersAfterCopies: 1, timersAfterDisposal: 0 });
});
