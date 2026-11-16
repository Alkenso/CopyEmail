// Composition root: runtime dependencies are wired here, not discovered by consumers.
(() => {
    'use strict';

    const settings = new CopyMailSettings.Settings(
        globalThis.chrome?.storage?.local, globalThis.chrome?.storage?.onChanged);
    const scanner = new CopyMailScanner.Scanner(settings, { geography: CopyMailGeography });
    const services = new CopyMailServices.ServiceCollection();
    const statistics = {
        increment(action) {
            globalThis.chrome?.runtime?.sendMessage(new CopyMailStatistics.IncrementMessage(action))
                ?.then(response => {
                    if (response?.error) console.warn('CopyEmail could not record action.', response.error);
                }).catch(error => console.warn('CopyEmail could not record action.', error));
        }
    };
    const augmenter = new PageAugmenter(settings, scanner, services, statistics);
    augmenter.start().catch(error => console.warn('CopyEmail could not start page actions.', error));
})();
