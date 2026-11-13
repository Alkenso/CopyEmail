(() => {
    'use strict';
    const { Settings, Action, BuiltinRuleType } = CopyMailSettings;
    const settings = new Settings();
    const form = document.querySelector('#settings-form');
    const fields = document.querySelector('#settings-fields');
    const rows = document.querySelector('#copy-patterns');
    const patterns = document.querySelector('#patterns');
    const appearance = document.querySelector('#appearance');
    const ignoreHoverHints = document.querySelector('#ignore-hover-hints');
    const status = document.querySelector('#status');
    const saveButton = form.querySelector('button[type=submit]');
    const dialog = document.querySelector('#rule-dialog');
    const ruleForm = document.querySelector('#rule-form');
    const ruleName = document.querySelector('#rule-name');
    const rulePatterns = document.querySelector('#rule-patterns');
    const ruleError = document.querySelector('#rule-error');
    const ruleId = document.querySelector('#rule-id');
    const reloadButton = document.querySelector('#reload-settings');
    let savedValue;
    let draft;
    let externalValue;
    let loaded = false;
    let saving = false;
    const descriptions = Object.freeze({ [BuiltinRuleType.EMAIL]: 'Detect email addresses on websites', [BuiltinRuleType.PHONE]: 'Recognize phone numbers', [BuiltinRuleType.ADDRESS]: 'Find physical addresses and locations' });
    const copy = value => structuredClone(value);
    const actionLabel = action => action === Action.OPEN_LINK ? 'Maps' : 'Copy';
    const actionIcon = action => action === Action.OPEN_LINK
        ? '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c-5 5-5 13 0 18M12 3c5 5 5 13 0 18"/>'
        : '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>';

    function createAction(rule, action) {
        const label = document.createElement('label');
        label.className = 'action-check';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = rule.enabledActions.includes(action);
        input.setAttribute('aria-label', `${rule.name}: ${actionLabel(action)}`);
        input.addEventListener('change', () => {
            rule.enabledActions = input.checked ? [...new Set([...rule.enabledActions, action])] : rule.enabledActions.filter(item => item !== action);
            markChanged();
        });
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('viewBox', '0 0 24 24');
        icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML = actionIcon(action);
        label.append(input, icon, document.createTextNode(actionLabel(action)));
        return label;
    }

    function iconButton(label, path, className, listener) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `icon-button ${className || ''}`.trim();
        button.setAttribute('aria-label', label);
        button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
        button.addEventListener('click', listener);
        return button;
    }

    function ruleSubtitle(rule) {
        if (rule.builtinType) return descriptions[rule.builtinType];
        const first = rule.patterns[0] || '';
        return rule.patterns.length > 1 ? `${first}  +${rule.patterns.length - 1} more` : first;
    }

    function ruleIcon(rule) {
        const paths = {
            [BuiltinRuleType.EMAIL]: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>',
            [BuiltinRuleType.PHONE]: '<path d="M5.5 3.5 9 7l-2 2.5a15 15 0 0 0 7.5 7.5l2.5-2 3.5 3.5-1.7 2.1c-.7.8-1.8 1.2-2.9.9A18.5 18.5 0 0 1 2.5 8.1c-.3-1.1.1-2.2.9-2.9l2.1-1.7Z"/>',
            [BuiltinRuleType.ADDRESS]: '<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>'
        };
        const tag = '<path d="M20 13 13 20l-9-9V4h7l9 9Z"/><circle cx="8.5" cy="8.5" r="1"/>';
        const icon = document.createElement('span');
        icon.className = 'rule-icon';
        icon.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[rule.builtinType] || tag}</svg>`;
        return icon;
    }

    function renderGroup(name, rules) {
        if (!rules.length) return;
        const heading = document.createElement('div');
        heading.className = 'rule-group-heading';
        heading.innerHTML = `<span>${name}</span><span>${rules.length} ${rules.length === 1 ? 'category' : 'categories'}</span>`;
        rows.append(heading);
        for (const rule of rules) {
            const row = document.createElement('article');
            row.className = 'rule-row';
            row.dataset.ruleId = rule.id;
            const description = document.createElement('div');
            description.className = 'rule-copy';
            const title = document.createElement('div');
            title.className = 'rule-name';
            title.textContent = rule.name;
            const subtitle = document.createElement('div');
            subtitle.className = 'rule-pattern';
            subtitle.textContent = ruleSubtitle(rule);
            subtitle.title = subtitle.textContent;
            description.append(title, subtitle);
            const actions = document.createElement('div');
            actions.className = 'rule-actions';
            rule.possibleActions.forEach(action => actions.append(createAction(rule, action)));
            description.append(actions);
            const controls = document.createElement('div');
            controls.className = 'row-controls';
            if (!rule.builtinType) {
                controls.append(
                    iconButton('Edit category', '<path d="m4 16-.7 4 4-.7L18.7 7.9l-3.6-3.6L4 16Z"/><path d="m13.8 5.6 3.6 3.6"/>', '', () => openRuleDialog(rule)),
                    iconButton('Delete category', '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>', 'danger', () => { draft.rules = draft.rules.filter(item => item.id !== rule.id); renderRules(); markChanged(); })
                );
            }
            row.append(ruleIcon(rule), description, controls);
            rows.append(row);
        }
    }

    function renderRules() {
        rows.replaceChildren();
        renderGroup('Built-in', draft.rules.filter(rule => rule.builtinType));
        renderGroup('Custom', draft.rules.filter(rule => !rule.builtinType));
    }

    function readForm() {
        const next = copy(draft);
        next.mode = form.elements.mode.value;
        next.patterns = CopyMailSettings.parsePatterns(patterns.value);
        next.appearance = appearance.value;
        next.ignoreHoverHints = ignoreHoverHints.checked;
        return CopyMailSettings.normalize(next);
    }

    function isChanged() {
        try { return JSON.stringify(readForm()) !== JSON.stringify(savedValue); }
        catch { return true; }
    }

    function markChanged() {
        let valid = true;
        try { CopyMailSettings.parsePatterns(patterns.value); patterns.setCustomValidity(''); patterns.removeAttribute('aria-invalid'); }
        catch (error) { valid = false; patterns.setCustomValidity(error.message); patterns.setAttribute('aria-invalid', 'true'); }
        const changed = isChanged();
        status.textContent = changed ? 'Unsaved changes.' : '';
        saveButton.disabled = !valid || !changed || Boolean(externalValue);
        updateDescription();
    }

    function updateDescription() {
        const includeOnly = form.elements.mode.value === CopyMailSettings.Mode.INCLUDE;
        document.querySelector('#mode-description').textContent = includeOnly ? 'Show actions only on websites matching this list.' : 'Show actions everywhere except on websites matching this list.';
        document.querySelector('#empty-list').textContent = includeOnly ? 'An empty list disables CopyEmail everywhere.' : 'An empty list enables CopyEmail everywhere.';
    }

    function openRuleDialog(rule) {
        ruleId.value = rule?.id || '';
        ruleName.value = rule?.name || '';
        rulePatterns.value = rule?.patterns.join('\n') || '';
        ruleError.textContent = '';
        rulePatterns.removeAttribute('aria-invalid');
        document.querySelector('#rule-dialog-title').textContent = rule ? 'Edit custom category' : 'New custom category';
        dialog.showModal();
        ruleName.focus();
    }

    function validateRule() {
        const sources = rulePatterns.value.split(/\r?\n/).filter(line => line.trim());
        let error = '';
        if (!ruleName.value.trim()) error = 'Category name is required.';
        else if (!sources.length) error = 'At least one regex is required.';
        else for (let index = 0; index < sources.length; index++) {
            try { CopyMailPatterns.validateRegex(sources[index]); }
            catch (failure) { error = `Line ${index + 1}: ${failure.message}`; break; }
        }
        ruleError.textContent = error;
        rulePatterns.setAttribute('aria-invalid', String(Boolean(error)));
        return error ? null : sources;
    }

    function selectTab(tab) {
        for (const item of document.querySelectorAll('[role="tab"]')) {
            const selected = item === tab;
            item.setAttribute('aria-selected', String(selected));
            document.getElementById(item.getAttribute('aria-controls')).hidden = !selected;
        }
    }

    function applyValue(next) {
        savedValue = copy(next);
        draft = copy(next);
        form.elements.mode.value = draft.mode;
        patterns.value = draft.patterns.join('\n');
        ignoreHoverHints.checked = draft.ignoreHoverHints;
        appearance.value = draft.appearance;
        document.documentElement.dataset.appearance = draft.appearance;
        externalValue = null;
        reloadButton.hidden = true;
        updateDescription();
        renderRules();
        saveButton.disabled = true;
    }

    appearance.addEventListener('change', () => {
        document.documentElement.dataset.appearance = appearance.value;
        markChanged();
    });
    form.addEventListener('input', markChanged);
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (fields.disabled || saveButton.disabled) return;
        try {
            saving = true;
            fields.disabled = true;
            await settings.save(readForm());
            applyValue(settings.value);
            status.textContent = 'Settings saved.';
            document.querySelector('#header-status').classList.add('visible');
            saveButton.disabled = true;
        } catch (error) { status.textContent = `Could not save settings. ${error.message}`; }
        finally { saving = false; fields.disabled = false; }
    });
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    for (const tab of tabs) {
        tab.addEventListener('click', () => selectTab(tab));
        tab.addEventListener('keydown', event => {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
            event.preventDefault();
            const direction = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1;
            const next = tabs[(tabs.indexOf(tab) + direction + tabs.length) % tabs.length];
            selectTab(next);
            next.focus();
        });
    }
    document.querySelector('#add-pattern').addEventListener('click', () => openRuleDialog());
    document.querySelector('#close-rule').addEventListener('click', () => dialog.close());
    document.querySelector('#cancel-rule').addEventListener('click', () => dialog.close());
    reloadButton.addEventListener('click', () => {
        if (!externalValue) return;
        applyValue(externalValue);
        status.textContent = 'Reloaded saved settings.';
    });
    ruleForm.addEventListener('submit', event => {
        event.preventDefault();
        const sources = validateRule();
        if (!sources) return;
        const existing = draft.rules.find(rule => rule.id === ruleId.value);
        if (existing) { existing.name = ruleName.value.trim(); existing.patterns = sources; }
        else draft.rules.push({ id: crypto.randomUUID(), name: ruleName.value.trim(), possibleActions: [Action.COPY], enabledActions: [Action.COPY], builtinType: null, patterns: sources });
        dialog.close();
        renderRules();
        markChanged();
    });

    async function load() {
        try {
            await settings.load();
            applyValue(settings.value);
            fields.disabled = false;
            loaded = true;
            if (location.hash === '#new-rule') openRuleDialog();
        } catch { status.textContent = 'Could not load settings. Reopen this page to try again.'; saveButton.disabled = true; }
    }
    settings.subscribe(next => {
        if (!loaded || saving) return;
        if (isChanged()) {
            externalValue = copy(next);
            reloadButton.hidden = false;
            saveButton.disabled = true;
            status.textContent = 'Settings changed in another view. Reload before saving.';
        } else {
            applyValue(next);
            status.textContent = 'Updated from another view.';
        }
    });
    window.addEventListener('pagehide', () => settings.dispose(), { once: true });
    load();
})();
