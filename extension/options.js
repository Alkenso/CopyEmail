(() => {
    'use strict';

    const form = document.querySelector('#settings-form');
    const fields = document.querySelector('#settings-fields');
    const patterns = document.querySelector('#patterns');
    const ignoreHoverHints = document.querySelector('#ignore-hover-hints');
    const googleMapsLinks = document.querySelector('#google-maps-links');
    const status = document.querySelector('#status');
    const saveButton = form.querySelector('button[type=submit]');
    let savedSettings = CopyMailSettings.normalize();

    const rows = document.querySelector('#copy-patterns');
    const addButton = document.querySelector('#add-pattern');

    function readCopyPatterns() {
        return CopyMailSettings.normalize({ copyPatterns: [...rows.children].map(row => ({
            predefined: row.dataset.predefined || null,
            isOn: row.querySelector('[type=checkbox]').checked,
            regexes: row.querySelector('[data-regexes]').value.split(/\r?\n/),
            name: row.querySelector('[data-name]').value
        })) }).copyPatterns;
    }

    function validateRows() {
        let valid = true;
        for (const row of rows.children) {
            const name = row.querySelector('[data-name]');
            const nameError = name.value.trim() ? '' : 'Rule name is required.';
            name.setCustomValidity(nameError);
            name.setAttribute('aria-invalid', String(Boolean(nameError)));
            name.parentElement.querySelector('.name-error').textContent = nameError;
            const input = row.querySelector('[data-regexes]');
            let error = '';
            try {
                const lines = input.value.split(/\r?\n/);
                if (!lines.some(line => line.trim())) throw new Error('At least one regex is required.');
                lines.forEach((line, index) => {
                    if (!line.trim()) return;
                    try { CopyMailSettings.validateRegex(line); }
                    catch (failure) { throw new Error(`Line ${index + 1}: ${failure.message}`); }
                });
            } catch (failure) {
                error = failure.message;
            }
            input.setCustomValidity(error);
            input.setAttribute('aria-invalid', String(Boolean(error)));
            input.title = error;
            input.parentElement.querySelector('.regex-error').textContent = error;
            valid &&= !nameError && !error;
        }
        addButton.disabled = !valid;
        return valid;
    }

    function addRow(pattern) {
        const row = document.createElement('tr');
        row.dataset.predefined = pattern.predefined || '';
        row.innerHTML = '<td><input type="checkbox" aria-label="Rule enabled"></td><td><textarea data-regexes aria-label="Regexes" rows="3" spellcheck="false" required></textarea><small class="regex-error"></small></td><td><input data-name aria-label="Name" required><small class="name-error"></small></td><td><button type="button" class="remove-pattern" aria-label="Remove rule"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg></button></td>';
        row.querySelector('[type=checkbox]').checked = pattern.isOn;
        row.querySelector('[data-regexes]').value = pattern.regexes.join('\n');
        row.querySelector('[data-name]').value = pattern.name;
        if (pattern.predefined) {
            row.querySelector('[data-regexes]').readOnly = true;
            row.querySelector('[data-name]').readOnly = true;
            row.querySelector('button').remove();
        } else {
            row.querySelector('button').addEventListener('click', () => {
                row.remove();
                form.dispatchEvent(new Event('input'));
            });
        }
        rows.append(row);
    }

    addButton.addEventListener('click', () => {
        if (!validateRows()) {
            return;
        }
        addRow({ isOn: true, regexes: [''], name: '' });
        rows.lastElementChild.querySelector('[data-name]').focus();
        form.dispatchEvent(new Event('input'));
    });
    for (const tab of document.querySelectorAll('[role=tab]')) {
        tab.addEventListener('click', () => {
            for (const item of document.querySelectorAll('[role=tab]')) {
                item.setAttribute('aria-selected', String(item === tab));
                document.getElementById(item.getAttribute('aria-controls')).hidden = item !== tab;
            }
        });
    }

    function hasUnsavedChanges() {
        try {
            const currentPatterns = CopyMailSettings.parsePatterns(patterns.value);
            return JSON.stringify(readCopyPatterns()) !== JSON.stringify(savedSettings.copyPatterns) ||
                ignoreHoverHints.checked !== savedSettings.ignoreHoverHints ||
                googleMapsLinks.checked !== savedSettings.googleMapsLinks ||
                form.elements.mode.value !== savedSettings.mode ||
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
        saveButton.disabled = !validateRows() || !changed;
        updateDescription();
    });

    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (fields.disabled || !validateRows() || !hasUnsavedChanges()) {
            return;
        }
        try {
            const settings = CopyMailSettings.normalize({
                mode: form.elements.mode.value,
                patterns: CopyMailSettings.parsePatterns(patterns.value),
                copyPatterns: readCopyPatterns(),
                ignoreHoverHints: ignoreHoverHints.checked,
                googleMapsLinks: googleMapsLinks.checked
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
            saveButton.disabled = !validateRows() || !hasUnsavedChanges();
        }
    });

    async function load() {
        try {
            const stored = await chrome.storage.local.get(CopyMailSettings.STORAGE_KEY);
            const settings = CopyMailSettings.normalize(stored[CopyMailSettings.STORAGE_KEY]);
            savedSettings = settings;
            settings.copyPatterns.forEach(addRow);
            validateRows();
            form.elements.mode.value = settings.mode;
            patterns.value = settings.patterns.join('\n');
            updateDescription();
            ignoreHoverHints.checked = settings.ignoreHoverHints;
            googleMapsLinks.checked = settings.googleMapsLinks;
            saveButton.disabled = true;
            fields.disabled = false;
        } catch {
            status.textContent = 'Could not load settings. Reopen this page to try again.';
            saveButton.disabled = true;
        }
    }

    load();
})();
