const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const vm = require('node:vm');

test('services prepare copy and Maps values without executing actions', () => {
    const source = fs.readFileSync('extension/services.js', 'utf8');
    const services = vm.runInNewContext(`const Action = { COPY: 'copy', OPEN_LINK: 'openLink' }; ${source}; new ServiceCollection()`);
    const value = '10 Main Street, Łódź & Warsaw';
    const commands = services.commands({ rule: { builtinType: 'address', enabledActions: ['copy', 'openLink'] }, value });
    expect(commands.map(command => ({ ...command }))).toEqual([
        { action: 'copy', value },
        { action: 'openLink', value: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(value)}` }
    ]);
    expect(() => services.commands({ rule: { builtinType: null, enabledActions: ['openLink'] }, value })).toThrow('Unsupported action');
});
