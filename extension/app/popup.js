(() => {
    'use strict';
    const { Settings, Action, BuiltinRuleType } = CopyMailSettings;
    const settings = new Settings();
    const rulesElement = document.querySelector('#rules');
    const addCategory = document.querySelector('#add-category');
    const notice = document.querySelector('#notice');
    let value;
    let saving = false;
    const descriptions = Object.freeze({ [BuiltinRuleType.EMAIL]: 'Detect email addresses on websites', [BuiltinRuleType.PHONE]: 'Recognize phone numbers', [BuiltinRuleType.ADDRESS]: 'Find physical addresses and locations' });
    const symbols = Object.freeze({
        [Action.COPY]: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
        [Action.OPEN_LINK]: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c-5 5-5 13 0 18M12 3c5 5 5 13 0 18"/>'
    });
    const categorySymbols = Object.freeze({
        email: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 6 8 7 8-7"/>',
        phone: '<path d="M8 3H5a2 2 0 0 0-2 2c0 9 7 16 16 16a2 2 0 0 0 2-2v-3l-5-2-2 3a15 15 0 0 1-7-7l3-2-2-5Z"/>',
        address: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
        custom: '<path d="M20 3h-7L3 13a2 2 0 0 0 0 3l5 5a2 2 0 0 0 3 0L21 11V4a1 1 0 0 0-1-1Z"/><circle cx="17" cy="7" r="1"/>'
    });

    function categoryIcon(rule) {
        const tile = document.createElement('div');
        tile.className = 'category-icon';
        tile.setAttribute('aria-hidden', 'true');
        tile.innerHTML = `<svg viewBox="0 0 24 24">${categorySymbols[rule.builtinType] || categorySymbols.custom}</svg>`;
        return tile;
    }

    const actionLabel = action => action === Action.OPEN_LINK ? 'Maps' : 'Copy';
    const subtitle = rule => rule.builtinType ? descriptions[rule.builtinType] : (rule.patterns[0] || 'Custom pattern');

    async function setAction(ruleId, action, enabled, checkbox) {
        if (saving) { checkbox.checked = !enabled; return; }
        saving = true;
        const rule = value.rules.find(item => item.id === ruleId);
        rule.enabledActions = enabled ? [...new Set([...rule.enabledActions, action])] : rule.enabledActions.filter(item => item !== action);
        updateCounts();
        for (const input of document.querySelectorAll('.action input')) input.disabled = true;
        try {
            await settings.save(value);
            value = structuredClone(settings.value);
            notice.hidden = true;
        } catch {
            value = structuredClone(settings.value);
            updateCounts();
            notice.textContent = 'Could not save this change. Try again.';
            notice.hidden = false;
        } finally { saving = false; render(); }
    }

    function actionControl(rule, action) {
        const label = document.createElement('label');
        label.className = 'action';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = rule.enabledActions.includes(action);
        checkbox.setAttribute('aria-label', `${rule.name}: ${actionLabel(action)}`);
        checkbox.addEventListener('change', () => setAction(rule.id, action, checkbox.checked, checkbox));
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('viewBox', '0 0 24 24');
        icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML = symbols[action];
        label.append(checkbox, icon, document.createTextNode(actionLabel(action)));
        return label;
    }

    function drawGroup(name, rules) {
        if (!rules.length) return;
        const section = document.createElement('section');
        const heading = document.createElement('div');
        heading.className = 'group-head';
        heading.innerHTML = `<span class="group-name">${name}</span><span class="count">${rules.length} ${rules.length === 1 ? 'category' : 'categories'}</span>`;
        if (name === 'Custom categories') {
            const meta = document.createElement('span');
            meta.className = 'group-meta';
            meta.append(heading.querySelector('.count'));
            const add = document.createElement('button');
            add.className = 'group-add';
            add.setAttribute('aria-label', 'Add custom category');
            add.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
            add.addEventListener('click', () => addCategory.click());
            meta.append(add);
            heading.append(meta);
        }
        section.append(heading);
        for (const rule of rules) {
            const item = document.createElement('article');
            item.className = 'item';
            const title = document.createElement('div');
            title.className = 'title';
            title.textContent = rule.name;
            const example = document.createElement('div');
            example.className = 'example';
            example.textContent = subtitle(rule);
            const actions = document.createElement('div');
            actions.className = 'actions';
            rule.possibleActions.forEach(action => actions.append(actionControl(rule, action)));
            const content = document.createElement('div');
            content.className = 'item-content';
            content.append(title, example, actions);
            item.append(categoryIcon(rule), content);
            section.append(item);
        }
        rulesElement.append(section);
    }

    function render() {
        if (!value) return;
        document.documentElement.dataset.appearance = value.appearance;
        rulesElement.replaceChildren();
        drawGroup('Built-in', value.rules.filter(rule => rule.builtinType));
        drawGroup('Custom categories', value.rules.filter(rule => !rule.builtinType));
        updateCounts();
    }

    function updateCounts() {
        const enabled = value.rules.reduce((sum, rule) => sum + rule.enabledActions.length, 0);
        document.querySelector('#enabled-count').textContent = `${enabled} ${enabled === 1 ? 'action' : 'actions'} enabled`;
        document.querySelector('#category-count').textContent = `${value.rules.length} ${value.rules.length === 1 ? 'category' : 'categories'}`;
    }

    function openOptions(hash = '') {
        chrome.runtime.openOptionsPage().then(() => {
            if (hash) chrome.tabs?.create?.({ url: chrome.runtime.getURL(`app/options.html${hash}`) });
            window.close();
        });
    }

    document.querySelector('#open-settings').addEventListener('click', () => openOptions());
    addCategory.addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('app/options.html#new-rule') });
        window.close();
    });

    async function load() {
        try { await settings.load(); value = structuredClone(settings.value); render(); }
        catch { notice.textContent = 'Could not load settings. Reopen this popup to try again.'; notice.hidden = false; }
    }
    settings.subscribe(next => {
        if (!saving) {
            value = structuredClone(next);
            render();
        }
    });
    window.addEventListener('pagehide', () => settings.dispose(), { once: true });
    load();
})();
