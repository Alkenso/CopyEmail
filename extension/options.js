(() => {
    'use strict';

    const form = document.querySelector('#settings-form');
    const fields = document.querySelector('#settings-fields');
    const patterns = document.querySelector('#patterns');
    const status = document.querySelector('#status');
    const saveButton = form.querySelector('button');
    let savedSettings = CopyMailSettings.normalize();

    function hasUnsavedChanges() {
        try {
            const currentPatterns = CopyMailSettings.parsePatterns(patterns.value);
            return form.elements.mode.value !== savedSettings.mode ||
                currentPatterns.length !== savedSettings.patterns.length ||
                currentPatterns.some(pattern => !savedSettings.patterns.includes(pattern));
        } catch {
            return true;
        }
    }

    function updateDescription() {
        const includeOnly = form.elements.mode.value === CopyMailSettings.Mode.INCLUDE;
        document.querySelector('#mode-description').textContent = includeOnly
            ? 'Show copy icons only on websites matching the list below.'
            : 'Show copy icons everywhere except on websites matching the list below.';
        document.querySelector('#empty-list').textContent = includeOnly
            ? 'An empty list disables CopyEmail everywhere.'
            : 'An empty list enables CopyEmail everywhere.';
    }

    form.addEventListener('input', () => {
        const changed = hasUnsavedChanges();
        status.textContent = changed ? 'Unsaved changes.' : '';
        saveButton.disabled = !changed;
        updateDescription();
    });

    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (fields.disabled || !hasUnsavedChanges()) {
            return;
        }
        try {
            const settings = CopyMailSettings.normalize({
                mode: form.elements.mode.value,
                patterns: CopyMailSettings.parsePatterns(patterns.value)
            });
            fields.disabled = true;
            await chrome.storage.local.set({ [CopyMailSettings.STORAGE_KEY]: settings });
            savedSettings = settings;
            patterns.value = settings.patterns.join('\n');
            status.textContent = 'Settings saved.';
        } catch (error) {
            status.textContent = `Could not save settings. ${error.message}`;
        } finally {
            fields.disabled = false;
            saveButton.disabled = !hasUnsavedChanges();
        }
    });

    async function load() {
        try {
            const stored = await chrome.storage.local.get(CopyMailSettings.STORAGE_KEY);
            const settings = CopyMailSettings.normalize(stored[CopyMailSettings.STORAGE_KEY]);
            savedSettings = settings;
            form.elements.mode.value = settings.mode;
            patterns.value = settings.patterns.join('\n');
            updateDescription();
            saveButton.disabled = true;
            fields.disabled = false;
        } catch {
            status.textContent = 'Could not load settings. Reopen this page to try again.';
            saveButton.disabled = true;
        }
    }

    load();
})();
