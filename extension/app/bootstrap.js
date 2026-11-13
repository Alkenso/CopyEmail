// Composition root: runtime dependencies are wired here, not discovered by consumers.
(() => {
    'use strict';

    const settings = new CopyMailSettings.Settings(
        globalThis.chrome?.storage?.local, globalThis.chrome?.storage?.onChanged);
    const scanner = new CopyMailScanner.Scanner(settings, { geography: CopyMailGeography });
    const services = new CopyMailServices.ServiceCollection();
    const augmenter = new PageAugmenter(settings, scanner, services);
    augmenter.start().catch(error => console.warn('CopyEmail could not start page actions.', error));
})();
