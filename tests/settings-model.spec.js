const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function settingsModule(chrome, logger = { warn() {} }) {
    const filename = path.join(__dirname, '../extension/settings.js');
    const source = fs.readFileSync(filename, 'utf8');
    return vm.runInNewContext(`${source}\n({ ...CopyMailSettings, CopyMailSettings })`, { chrome, console: logger });
}

function storage(initialValue) {
    let value = initialValue;
    let listener = null;
    const writes = [];
    return {
        chrome: {
            storage: {
                local: {
                    async get(key) { return { [key]: value }; },
                    async set(update) {
                        writes.push(update);
                        value = update.websiteSettings;
                    }
                },
                onChanged: {
                    addListener(next) { listener = next; },
                    removeListener(previous) { if (listener === previous) listener = null; }
                }
            }
        },
        change(next) {
            value = next;
            listener?.({ websiteSettings: { newValue: next } }, 'local');
        },
        hasListener() { return Boolean(listener); },
        writes
    };
}

test('normalizes rules and limits enabled actions to their supported actions', () => {
    const { Action, BuiltinRuleType, CopyMailSettings } = settingsModule();
    const value = CopyMailSettings.normalize({ rules: [
        { id: '1d682fce-031f-49bb-9df3-d9090bb2317d', name: 'Changed', builtinType: BuiltinRuleType.ADDRESS,
            possibleActions: [], enabledActions: [Action.OPEN_LINK, 'unsupported'], patterns: ['ignored'] },
        { id: '39bcb03c-6e2e-4cb6-a38f-bd4372b8b2ce', name: 'Order', builtinType: null,
            possibleActions: [Action.OPEN_LINK], enabledActions: [Action.COPY, Action.OPEN_LINK], patterns: ['ORDER-\\d+'] }
    ] });
    expect(Array.from(value.rules[0].possibleActions)).toEqual([Action.COPY, Action.OPEN_LINK]);
    expect(Array.from(value.rules[0].enabledActions)).toEqual([Action.OPEN_LINK]);
    expect(value.rules[0].name).toBe('Addresses');
    expect(value.rules[0].patterns).toHaveLength(10);
    expect(Array.from(value.rules[1].possibleActions)).toEqual([Action.COPY]);
    expect(Array.from(value.rules[1].enabledActions)).toEqual([Action.COPY]);
    expect(Array.from(value.rules[1].patterns)).toEqual(['ORDER-\\d+']);
    expect(Object.isFrozen(value)).toBe(false);
    value.rules[1].enabledActions.length = 0;
    expect(value.rules[1].enabledActions).toEqual([]);
});

test('loads legacy settings once, persists stable rule IDs, and notifies only for changes', async () => {
    const mock = storage({ googleMapsLinks: false, copyPatterns: [
        { predefined: 'email', isOn: true, regexes: ['old'], name: 'Email' },
        { predefined: null, isOn: false, regexes: ['ORDER-\\d+'], name: 'Order' }
    ] });
    const { Settings } = settingsModule(mock.chrome);
    const settings = new Settings();
    const revisions = [];
    settings.subscribe((value, revision) => revisions.push([value.rules.length, revision]));
    await settings.load();

    expect(revisions).toEqual([[2, 1]]);
    expect(mock.writes).toHaveLength(1);
    const savedRules = mock.writes[0].websiteSettings.rules;
    expect(savedRules.every(rule => /^[0-9a-f-]{36}$/.test(rule.id))).toBe(true);
    expect(settings.update(settings.value)).toBe(false);
    expect(revisions).toEqual([[2, 1]]);

    const reloaded = new Settings();
    await reloaded.load();
    expect(reloaded.value.rules.map(rule => rule.id)).toEqual(savedRules.map(rule => rule.id));
    expect(mock.writes).toHaveLength(1);
    settings.dispose();
    reloaded.dispose();
});

test('listener failures do not interrupt later subscribers or legacy persistence', async () => {
    const mock = storage({ copyPatterns: [
        { predefined: 'email', isOn: true, regexes: ['legacy'], name: 'Email' }
    ] });
    const warnings = [];
    const logger = { warn(...arguments_) { warnings.push(arguments_); } };
    const { Settings } = settingsModule(mock.chrome, logger);
    const settings = new Settings();
    const revisions = [];
    settings.subscribe(() => { throw new Error('Rendering failed'); });
    settings.subscribe((value, revision) => revisions.push([value.rules.length, revision]));

    await settings.load();

    expect(revisions).toEqual([[2, 1]]);
    expect(mock.writes).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0][0]).toMatch(/subscriber/i);
    expect(warnings[0][1]).toBeInstanceOf(Error);
});

test('legacy rule IDs stay attached after invalid entries are filtered', () => {
    const id = '39bcb03c-6e2e-4cb6-a38f-bd4372b8b2ce';
    const { CopyMailSettings } = settingsModule();

    const value = CopyMailSettings.normalize({ copyPatterns: [
        null,
        { id, predefined: null, isOn: true, regexes: ['ORDER-\\d+'], name: 'Order' }
    ] });

    expect(value.rules).toHaveLength(1);
    expect(value.rules[0].id).toBe(id);
});

test('legacy maps preference retains address links when the copy rule is absent', async () => {
    const mock = storage({ googleMapsLinks: true, copyPatterns: [] });
    const { Action, BuiltinRuleType, Settings } = settingsModule(mock.chrome);
    const settings = new Settings();
    await settings.load();

    const address = settings.value.rules.find(rule => rule.builtinType === BuiltinRuleType.ADDRESS);
    expect(address).toBeTruthy();
    expect(Array.from(address.enabledActions)).toEqual([Action.OPEN_LINK]);
    expect(mock.writes[0].websiteSettings.copyPatterns).toBeUndefined();
    expect(mock.writes[0].websiteSettings.googleMapsLinks).toBeUndefined();
});

test('applies external storage changes and unregisters its listener on disposal', () => {
    const mock = storage(undefined);
    const { Settings } = settingsModule(mock.chrome);
    const settings = new Settings();
    expect(mock.hasListener()).toBe(true);
    mock.change({ copyPatterns: [] });
    expect(settings.value.rules).toHaveLength(0);
    expect(settings.revision).toBe(1);
    settings.dispose();
    expect(mock.hasListener()).toBe(false);
});

test('does not replace a newer storage event when an earlier load finishes', async () => {
    let finishLoad;
    let listener;
    const writes = [];
    const chrome = { storage: {
        local: {
            get() { return new Promise(resolve => { finishLoad = resolve; }); },
            async set(value) { writes.push(value); }
        },
        onChanged: { addListener(value) { listener = value; }, removeListener() {} }
    } };
    const { Settings } = settingsModule(chrome);
    const settings = new Settings();
    const loading = settings.load();
    listener({ websiteSettings: { newValue: { copyPatterns: [] } } }, 'local');
    finishLoad({ websiteSettings: { copyPatterns: [{ predefined: 'email', isOn: true,
        regexes: ['legacy'], name: 'Email' }] } });
    await loading;

    expect(settings.value.rules).toHaveLength(0);
    expect(settings.revision).toBe(1);
    expect(writes).toHaveLength(0);
});

test('save completion does not replace a newer storage event', async () => {
    let finishSave;
    let listener;
    const chrome = { storage: {
        local: { set() { return new Promise(resolve => { finishSave = resolve; }); } },
        onChanged: { addListener(value) { listener = value; } }
    } };
    const { Settings } = settingsModule(chrome);
    const settings = new Settings();
    const saving = settings.save({ ignoreHoverHints: false });
    listener({ websiteSettings: { newValue: { rules: [], ignoreHoverHints: true } } }, 'local');
    finishSave();
    await saving;
    expect(settings.value.rules).toHaveLength(0);
    expect(settings.value.ignoreHoverHints).toBe(true);
});

test('a migration write failure still exposes successfully loaded settings', async () => {
    const chrome = { storage: { local: {
        async get() { return { websiteSettings: { ignoreHoverHints: false } }; },
        async set() { throw new Error('Storage unavailable'); }
    } } };
    const { Settings } = settingsModule(chrome);
    const settings = new Settings();
    await settings.load();
    expect(settings.value.ignoreHoverHints).toBe(false);
    expect(settings.value.rules).toHaveLength(3);
});

test('appearance defaults to system and persists supported choices', async () => {
    const { CopyMailSettings, Settings } = settingsModule();
    expect(CopyMailSettings.normalize().appearance).toBe('system');
    expect(CopyMailSettings.normalize({ appearance: 'invalid' }).appearance).toBe('system');
    const writes = [];
    const settings = new Settings({ set: async value => writes.push(value) });
    for (const appearance of ['system', 'light', 'dark']) {
        await settings.save({ ...settings.value, appearance });
        expect(settings.value.appearance).toBe(appearance);
        expect(writes.at(-1).websiteSettings.appearance).toBe(appearance);
    }
});

test('published settings snapshots cannot be mutated without a revision', () => {
    const { Settings } = settingsModule();
    const settings = new Settings();
    const value = settings.value;
    const revision = settings.revision;

    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.rules)).toBe(true);
    expect(Object.isFrozen(value.rules[0])).toBe(true);
    expect(Object.isFrozen(value.rules[0].enabledActions)).toBe(true);
    expect(() => value.rules.push({})).toThrow();
    expect(() => value.rules[0].patterns.push('changed')).toThrow();
    expect(() => { settings.value = { rules: [] }; }).toThrow();
    expect(() => { settings.revision = 99; }).toThrow();

    expect(settings.value).toBe(value);
    expect(settings.revision).toBe(revision);
});

test('instance website enablement uses the current immutable snapshot', () => {
    const { Settings } = settingsModule();
    const settings = new Settings();
    settings.update({ mode: 'nowhere-but', patterns: ['*.example.com'] });

    expect(settings.isEnabled('mail.example.com')).toBe(true);
    expect(settings.isEnabled('other.test')).toBe(false);
});
