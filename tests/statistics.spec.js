const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture() {
    let now = Date.parse('2026-11-16T23:59:59Z');
    const local = {};
    let writes = 0;
    let failSave = false;
    const storage = {
        get: async key => ({ [key]: structuredClone(local[key]) }),
        set: async value => {
            if (failSave) throw new Error('Storage unavailable');
            writes++;
            Object.assign(local, structuredClone(value));
        }
    };
    const source = fs.readFileSync('extension/app/settings.js', 'utf8') + '\n' +
        (fs.existsSync('extension/app/statistics.js') ? fs.readFileSync('extension/app/statistics.js', 'utf8') : '');
    const api = vm.runInNewContext(`${source}\n typeof CopyMailStatistics === 'undefined' ? {} : CopyMailStatistics`, {
        Date: class extends Date {
            constructor(...args) { super(...(args.length ? args : [now])); }
            static now() { return now; }
        }
    });
    return {
        api, local,
        create: () => new api.Statistics(storage),
        setDate: value => { now = Date.parse(value); },
        failSave: value => { failSave = value; },
        writes: () => writes
    };
}

test('rolling UTC totals include today and retain separate action counts', async () => {
    const f = fixture();
    const statistics = f.create();
    await statistics.load();
    for (const [date, action] of [
        ['2025-11-16T23:59:59Z', 'copy'], // Outside 365 days.
        ['2025-11-17T00:00:00Z', 'copy'],
        ['2026-10-17T23:59:59Z', 'copy'], // Outside 30 days.
        ['2026-10-18T00:00:00Z', 'copy'],
        ['2026-11-09T23:59:59Z', 'copy'], // Outside 7 days.
        ['2026-11-10T00:00:00Z', 'copy'],
        ['2026-11-16T23:59:59Z', 'openLink']
    ]) {
        f.setDate(date);
        await statistics.increment(action);
    }
    expect([statistics.week(), statistics.month(), statistics.year(), statistics.lifetime()]).toEqual([2, 4, 6, 7]);
    expect(statistics.week('copy')).toBe(1);
    expect(statistics.lifetime('openLink')).toBe(1);
    f.setDate('2026-11-17T00:00:00Z');
    expect(statistics.week()).toBe(1);
    expect(statistics.lifetime()).toBe(7);
});

test('each click immediately persists UTC daily maps without empty days', async () => {
    const f = fixture();
    const statistics = f.create();
    await statistics.load();
    expect(f.writes()).toBe(0);
    f.setDate('2026-11-17T01:00:00+02:00');
    await statistics.increment('copy');
    expect(f.local.actionStatistics).toEqual({ copy: [{ 1794787200: 1 }] });
    expect(f.writes()).toBe(1);
    await statistics.increment('copy');
    expect(f.local.actionStatistics).toEqual({ copy: [{ 1794787200: 2 }] });
    expect(f.writes()).toBe(2);
    f.setDate('2026-11-19T00:00:00Z');
    await statistics.increment('openLink');
    expect(f.writes()).toBe(3);
    expect(f.local.actionStatistics).toEqual({ copy: [{ 1794787200: 2 }], openLink: [{ 1795046400: 1 }] });
});

test('saved clicks survive restarts and the next click retries a failed write', async () => {
    const f = fixture();
    const first = f.create();
    await first.load();
    await first.increment('copy');
    const restarted = f.create();
    await restarted.load();
    expect(restarted.lifetime()).toBe(1);
    f.failSave(true);
    expect(await restarted.increment('copy').catch(error => error.message)).toBe('Storage unavailable');
    expect(f.local.actionStatistics).toEqual({ copy: [{ 1794787200: 1 }] });
    f.failSave(false);
    await restarted.increment('openLink');
    const nextSession = f.create();
    await nextSession.load();
    expect(nextSession.lifetime()).toBe(3);
    expect(f.writes()).toBe(2);
});

test('unknown actions cannot change totals', async () => {
    const statistics = fixture().create();
    await statistics.load();
    expect(await statistics.increment('unknown').catch(error => error.message)).toBe('Unsupported action: unknown');
    expect(statistics.lifetime()).toBe(0);
});
