const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './tests',
    // Clipboard tests share the operating system clipboard.
    workers: 1,
    use: {
        channel: 'chrome',
        viewport: { width: 1000, height: 700 }
    }
});
