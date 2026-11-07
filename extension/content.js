(() => {
    'use strict';

    let activePatterns = [];
    let geographyRequested = false;
    let ignoreHoverHints = false;
    let googleMapsLinks = true;
    let copyAddresses = true;
    let lastHoverTime = -Infinity;
    let hoveredElements = [];
    let hoverActive = false;
    let hoverHints = new WeakSet();
    let activatedHints = new WeakSet();
    const SKIPPED = 'script,style,noscript,template,textarea,input,select,option,svg,canvas';
    const METADATA = '[href^="mailto:" i],[title],[aria-label],[data-email]';
    const Status = Object.freeze({ COPY: 'copy', COPIED: 'copied', ERROR: 'error', MAP: 'map' });
    const ICONS = Object.freeze({
        [Status.MAP]: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
        [Status.COPY]: '<rect x="8" y="8" width="12" height="12" rx="2" fill="white"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
        [Status.COPIED]: '<path d="m5 12 4 4L19 6"/>',
        [Status.ERROR]: '<path d="m6 6 12 12M6 18 18 6"/>'
    });

    const host = document.createElement('copymail-overlay');
    host.style.cssText = 'all:initial!important;position:fixed!important;top:0!important;left:0!important;width:0!important;height:0!important;overflow:visible!important;pointer-events:none!important;z-index:2147483647!important;';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
        button, a {
            all: initial;
            box-sizing: border-box;
            position: absolute;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 20px;
            height: 20px;
            padding: 2px;
            border-radius: 4px;
            background: transparent;
            color: #202020;
            color-scheme: light dark;
            cursor: pointer;
            pointer-events: auto;
        }
        :is(button, a):focus-visible { outline: 2px solid Highlight; outline-offset: 2px; }
        :is(button, a)[hidden] { display: none; }
        button[data-status="copied"] { color: #16803c; opacity: 1; }
        button[data-status="error"] { color: #c53030; opacity: 1; }
        svg {
            display: block;
            width: 16px;
            height: 16px;
            pointer-events: none;
            filter: drop-shadow(1px 0 0 white) drop-shadow(-1px 0 0 white)
                drop-shadow(0 1px 0 white) drop-shadow(0 -1px 0 white);
        }
        textarea { position: fixed; top: 0; left: 0; opacity: 0; pointer-events: none; }
    `;
    shadow.append(style);

    let records = new Map();
    const spacers = new WeakSet();
    const copyActions = new WeakMap();
    let nextNodeId = 0;
    const nodeIds = new WeakMap();
    let scanTimer = 0;
    let layoutFrame = 0;
    let layoutTimer = 0;
    let enabled = false;
    const observedRoots = new Set();

    function parentElement(element) {
        return element.assignedSlot || element.parentElement || element.getRootNode().host || null;
    }

    function isSkipped(element) {
        return element === host || element.matches(SKIPPED) || element.isContentEditable;
    }

    function enrichMatch(match, element) {
        if (match.pattern.action === CopyMailParser.Action.MAP && match.pattern.parentLevels && !geographyRequested) {
            geographyRequested = true;
            CopyMailGeography.load().then(scheduleScan).catch(error => {
                console.warn('CopyEmail could not load city names.', error);
            });
        }
        return CopyMailParser.enrich(match, element, parentElement, CopyMailGeography);
    }

    function emailMatches(value) {
        return CopyMailParser.find(value, activePatterns);
    }

    function metadataEmail(element) {
        const href = element.getAttribute('href') || '';
        let recipient = '';
        if (/^mailto:/i.test(href)) {
            try {
                recipient = decodeURIComponent(href.slice(7).split('?')[0]);
            } catch {
                // A malformed link must not prevent other page addresses from working.
            }
        }
        for (const value of [recipient, element.getAttribute('data-email'), element.getAttribute('title'), element.getAttribute('aria-label')]) {
            const matches = emailMatches(value || '');
            if (matches.length === 1) {
                return matches[0];
            }
        }
        return null;
    }

    function shortenedLabelMatches(label, email) {
        if (!/(?:…|\.{3})/.test(label)) {
            return false;
        }
        const parts = label.toLowerCase().split(/…|\.{3}/);
        const address = email.toLowerCase();
        return parts.length === 2 && Boolean(parts[0] || parts[1]) &&
            address.startsWith(parts[0]) && address.endsWith(parts[1]);
    }

    function addCandidate(candidates, range, email, element, action = CopyMailParser.Action.COPY) {
        const node = range.startContainer;
        if (!nodeIds.has(node)) {
            nodeIds.set(node, ++nextNodeId);
        }
        const key = `${nodeIds.get(node)}:${range.startOffset}:${action}:${email}`;
        const candidate = { range, email, element, action };
        candidates.set(key, candidate);
        return candidate;
    }

    function collectCandidates(root, candidates, metadataElements = new Set()) {
        if (root.host) {
            observeRoot(root);
        }
        for (const element of root.querySelectorAll(METADATA)) {
            if (isSkipped(element) || element.closest(SKIPPED) || element.isContentEditable) {
                continue;
            }
            const match = metadataEmail(element);
            const email = match?.text;
            const label = element.textContent.trim();
            if (email && shortenedLabelMatches(label, email)) {
                // Only the innermost label gets an icon when metadata is repeated.
                if ([...element.querySelectorAll(METADATA)].some(child => shortenedLabelMatches(child.textContent.trim(), email))) {
                    continue;
                }
                const range = document.createRange();
                range.selectNodeContents(element);
                if (spacers.has(element.lastChild)) {
                    range.setEndBefore(element.lastChild);
                }
                addCandidate(candidates, range, enrichMatch(match, element), element, match.pattern.action);
                metadataElements.add(element);
            }
        }

        let text = '';
        let segments = [];
        function flush() {
            for (const match of emailMatches(text)) {
                const start = match.index;
                const end = start + match.text.length;
                if (/(?:…|\.{3})$/.test(text.slice(0, start)) || /^(?:…|\.{3})/.test(text.slice(end))) {
                    continue;
                }
                const first = segments.find(segment => segment.end > start);
                const last = segments.find(segment => segment.end >= end);
                const range = document.createRange();
                range.setStart(first.node, start - first.start);
                range.setEnd(last.node, end - last.start);
                const element = last.node.parentElement || last.node.getRootNode().host;
                const value = enrichMatch(match, element);
                addCandidate(candidates, range, value, element, match.pattern.action);
            }
            text = '';
            segments = [];
        }

        function visit(node) {
            if (spacers.has(node)) {
                return;
            }
            if (node.nodeType === Node.TEXT_NODE) {
                segments.push({ node, start: text.length, end: text.length + node.length });
                text += node.data;
                return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE && node !== root) {
                return;
            }
            if (node.nodeType === Node.ELEMENT_NODE && (isSkipped(node) || metadataElements.has(node))) {
                flush();
                return;
            }
            const display = node.nodeType === Node.ELEMENT_NODE ? getComputedStyle(node).display : '';
            const boundary = node.nodeName === 'BR' || (display && display !== 'inline' && display !== 'contents');
            if (boundary) {
                flush();
            }
            if (node.shadowRoot) {
                flush();
                collectCandidates(node.shadowRoot, candidates, metadataElements);
            } else {
                const assigned = node.nodeName === 'SLOT' ? node.assignedNodes({ flatten: true }) : [];
                for (const child of assigned.length ? assigned : node.childNodes) {
                    visit(child);
                }
            }
            if (boundary) {
                flush();
            }
        }
        visit(root);
        flush();
    }

    function setStatus(button, email, status) {
        button.dataset.status = status;
        button.title = status === Status.COPIED ? 'Copied!' : status === Status.ERROR ? 'Copy failed. Click to retry.' : `Copy ${email}`;
        // SVG markup is static; email addresses are never interpolated into HTML.
        button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[status]}</svg>`;
    }

    function legacyCopy(email) {
        const focused = shadow.activeElement || document.activeElement;
        const selection = document.getSelection();
        const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : [];
        const textarea = document.createElement('textarea');
        textarea.value = email;
        shadow.append(textarea);
        try {
            textarea.focus({ preventScroll: true });
            textarea.select();
            if (!document.execCommand('copy')) {
                throw new Error('Clipboard write was rejected');
            }
        } finally {
            textarea.remove();
            focused?.focus({ preventScroll: true });
            if (selection) {
                selection.removeAllRanges();
                for (const range of ranges) {
                    selection.addRange(range);
                }
            }
        }
    }

    async function copyEmail(email) {
        if (navigator.clipboard?.writeText) {
            try {
                await navigator.clipboard.writeText(email);
                return;
            } catch {
                // HTTP pages and restricted frames can still support legacy copying.
            }
        }
        legacyCopy(email);
    }

    function createButton(email, action) {
        if (action === CopyMailParser.Action.MAP) {
            const link = document.createElement('a');
            link.hidden = true;
            link.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(email)}`;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            setStatus(link, email, Status.MAP);
            link.title = `Open in Google Maps: ${email}`;
            link.setAttribute('aria-label', link.title);
            shadow.append(link);
            return link;
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.hidden = true;
        button.setAttribute('aria-label', `Copy ${email}`);
        setStatus(button, email, Status.COPY);
        let resetTimer = 0;
        copyActions.set(button, async () => {
            clearTimeout(resetTimer);
            try {
                await copyEmail(email);
                setStatus(button, email, Status.COPIED);
            } catch {
                setStatus(button, email, Status.ERROR);
            }
            resetTimer = setTimeout(() => setStatus(button, email, Status.COPY), 1500);
        });
        shadow.append(button);
        return button;
    }

    function handleCopyInteraction(event) {
        const button = event.composedPath().find(node => copyActions.has(node));
        if (!button) {
            return;
        }
        // The overlay is outside page popups. Intercept before document capture
        // handlers treat it as an outside click, and keep focus in the popup.
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.type === 'click' && event.isTrusted) {
            copyActions.get(button)();
        }
    }

    function isUncovered(element, x, y) {
        for (let current = element; current;) {
            const root = current.getRootNode();
            // Ignore our own button when it is clamped inward at the viewport edge.
            const hit = root.elementsFromPoint(x, y).find(candidate => candidate !== host);
            if (!hit || !(current.contains(hit) || hit.contains(current))) {
                return false;
            }
            current = root.host;
        }
        return true;
    }

    function visibleRect(range, element) {
        if (!element.isConnected || !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) {
            return null;
        }
        let left = 0;
        let top = 0;
        let right = document.documentElement.clientWidth;
        let bottom = window.innerHeight;
        for (let ancestor = element; ancestor; ancestor = parentElement(ancestor)) {
            const computed = getComputedStyle(ancestor);
            if (computed.visibility !== 'visible' || Number(computed.opacity) === 0) {
                return null;
            }
            const clipsX = /hidden|clip|scroll|auto/.test(computed.overflowX);
            const clipsY = /hidden|clip|scroll|auto/.test(computed.overflowY);
            if (clipsX || clipsY) {
                const box = ancestor.getBoundingClientRect();
                if (clipsX) {
                    left = Math.max(left, box.left + ancestor.clientLeft);
                    right = Math.min(right, box.left + ancestor.clientLeft + ancestor.clientWidth);
                }
                if (clipsY) {
                    top = Math.max(top, box.top + ancestor.clientTop);
                    bottom = Math.min(bottom, box.top + ancestor.clientTop + ancestor.clientHeight);
                }
            }
        }
        const rectangles = [...range.getClientRects()];
        for (let index = rectangles.length - 1; index >= 0; index--) {
            const rect = rectangles[index];
            // Chromium reports both full and ellipsized text rectangles on one line.
            const line = rectangles.filter(other => Math.abs(other.top - rect.top) < 1 && Math.abs(other.bottom - rect.bottom) < 1);
            const clipped = {
                left: Math.max(left, Math.min(...line.map(part => part.left))),
                right: Math.min(right, Math.max(...line.map(part => part.right))),
                top: Math.max(top, rect.top),
                bottom: Math.min(bottom, rect.bottom)
            };
            if (clipped.right - clipped.left < 2 || clipped.bottom - clipped.top < 2) {
                continue;
            }
            const x = clipped.right - 1;
            const y = (clipped.top + clipped.bottom) / 2;
            if (isUncovered(element, x, y)) {
                return clipped;
            }
        }
        return null;
    }

    function positionButtons() {
        layoutFrame = 0;
        for (const record of records.values()) {
            const hoverHint = isHoverHint(record, record);
            const rect = ignoreHoverHints && hoverHint ? null : visibleRect(record.range, record.element);
            if (record.button) record.button.hidden = !rect;
            if (record.mapLink) record.mapLink.hidden = !rect;
            if (rect) {
                // Stay at the visible trailing edge, including text-overflow: ellipsis.
                const x = Math.min(rect.right + 3, document.documentElement.clientWidth - (record.button && record.mapLink ? 43 : 20));
                const y = Math.max(0, Math.min((rect.top + rect.bottom) / 2 - 10, window.innerHeight - 20));
                if (record.button) record.button.style.transform = `translate(${x}px, ${y}px)`;
                if (record.mapLink) record.mapLink.style.transform = `translate(${x + (record.button ? 23 : 0)}px, ${y}px)`;
            }
        }
    }

    function scheduleLayout() {
        if (enabled && !layoutFrame) {
            layoutFrame = requestAnimationFrame(positionButtons);
        }
    }

    function reserveButtonSpace(range, element, hasMapLink) {
        const width = hasMapLink ? 49 : 26;
        const end = range.endContainer;
        const next = end.nodeType === Node.TEXT_NODE
            ? (range.endOffset === end.length ? end.nextSibling : null)
            : end.childNodes[range.endOffset];
        if (spacers.has(next)) {
            next.style.setProperty('padding-left', `${width}px`, 'important');
            return next;
        }
        const rect = visibleRect(range, element);
        if (!rect) {
            return null;
        }
        let container = end.nodeType === Node.TEXT_NODE ? end.parentNode : end;
        while (container.parentElement && /^(inline|contents)$/.test(getComputedStyle(container).display)) {
            container = container.parentElement;
        }
        const following = range.cloneRange();
        following.collapse(false);
        following.setEnd(container, container.childNodes.length);
        if (![...following.getClientRects()].some(part => part.left < rect.right + width - 3 &&
            part.right > rect.right + 3 && part.top < rect.bottom && part.bottom > rect.top)) {
            return null;
        }
        const spacer = document.createElement('span');
        spacer.setAttribute('aria-hidden', 'true');
        spacer.style.cssText = 'all:initial!important;display:inline!important;padding-left:26px!important;font-size:0!important;line-height:0!important;pointer-events:none!important;';
        spacer.style.setProperty('padding-left', `${width}px`, 'important');
        spacers.add(spacer);
        const insertion = range.cloneRange();
        insertion.collapse(false);
        insertion.insertNode(spacer);
        range.setEndBefore(spacer);
        return spacer;
    }

    function isHoverHint(candidate, previous) {
        // Delayed previews still belong to the hover while the pointer stays on its trigger.
        // Pointer/key activation clears lastHoverTime so click-opened popups remain usable.
        const activeHover = lastHoverTime !== -Infinity &&
            (performance.now() - lastHoverTime < 1500 || hoverActive);
        const appearedOnHover = activeHover && (!previous || (previous.button || previous.mapLink).hidden) &&
            Boolean(visibleRect(candidate.range, candidate.element));
        for (let element = candidate.element; element; element = parentElement(element)) {
            if (activatedHints.has(element)) {
                if (element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) {
                    return false;
                }
                activatedHints.delete(element);
            }
            if (hoverHints.has(element) || element.matches('[role="tooltip"],tool-tip,[popover="hint"]')) {
                return true;
            }
            if (appearedOnHover && !hoveredElements.includes(element) &&
                /^(absolute|fixed)$/.test(getComputedStyle(element).position)) {
                hoverHints.add(element);
                return true;
            }
        }
        return false;
    }

    function scan() {
        scanTimer = 0;
        if (!enabled) {
            return;
        }
        if (!host.isConnected) {
            document.documentElement.append(host);
        }
        observer.disconnect();
        observedRoots.clear();
        const collected = new Map();
        collectCandidates(document.body || document.documentElement, collected);
        for (const [key, candidate] of collected) {
            const hoverHint = isHoverHint(candidate, records.get(key));
            if (ignoreHoverHints && hoverHint) {
                collected.delete(key);
            }
        }
        // Work backwards so splitting a text node preserves earlier match offsets.
        for (const candidate of [...collected.values()].reverse()) {
            candidate.spacer = reserveButtonSpace(candidate.range, candidate.element, copyAddresses && googleMapsLinks && candidate.action === CopyMailParser.Action.MAP);
        }
        const candidates = new Map();
        for (const candidate of collected.values()) {
            // Inserting spacers can split the start nodes of subsequent matches.
            const record = addCandidate(candidates, candidate.range, candidate.email, candidate.element, candidate.action);
            record.spacer = candidate.spacer;
        }
        const retainedSpacers = new Set();
        for (const [key, candidate] of candidates) {
            retainedSpacers.add(candidate.spacer);
            if (candidate.action !== CopyMailParser.Action.MAP || copyAddresses) {
                candidate.button = records.get(key)?.button || createButton(candidate.email, CopyMailParser.Action.COPY);
            }
            if (googleMapsLinks && candidate.action === CopyMailParser.Action.MAP) {
                candidate.mapLink = records.get(key)?.mapLink || createButton(candidate.email, CopyMailParser.Action.MAP);
                candidate.button?.after(candidate.mapLink);
            }
        }
        for (const [key, record] of records) {
            if (!candidates.has(key)) {
                record.button?.remove();
                record.mapLink?.remove();
            }
            if (!candidates.get(key)?.button) record.button?.remove();
            if (!candidates.get(key)?.mapLink) record.mapLink?.remove();
            if (!retainedSpacers.has(record.spacer)) {
                record.spacer?.remove();
            }
        }
        records = candidates;
        // Spacer insertion must not trigger another scan, including in shadow roots.
        const roots = [...observedRoots];
        observer.disconnect();
        observedRoots.clear();
        observeRoot(document.documentElement);
        for (const root of roots) {
            observeRoot(root);
        }
        scheduleLayout();
    }

    function scheduleScan() {
        if (enabled && !scanTimer) {
            scanTimer = setTimeout(scan, 100);
        }
    }

    const observer = new MutationObserver(mutations => {
        if (mutations.some(mutation => mutation.target !== host &&
            (mutation.type !== 'childList' || [...mutation.addedNodes, ...mutation.removedNodes].some(node => node !== host)))) {
            scheduleScan();
        }
    });

    function observeRoot(root) {
        if (!observedRoots.has(root)) {
            observedRoots.add(root);
            observer.observe(root, {
                subtree: true,
                childList: true,
                characterData: true,
                attributes: true,
                attributeFilter: ['href', 'title', 'aria-label', 'data-email', 'class', 'style', 'hidden', 'open', 'contenteditable']
            });
        }
    }

    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick']) {
        window.addEventListener(type, handleCopyInteraction, true);
    }
    window.addEventListener('pointerover', event => {
        if (enabled && event.isTrusted && event.pointerType === 'mouse') {
            lastHoverTime = performance.now();
            hoverActive = true;
            hoveredElements = event.composedPath().filter(node => node instanceof Element);
            if (ignoreHoverHints) {
                scheduleScan();
            }
            scheduleLayout();
        }
    }, true);
    window.addEventListener('pointerout', event => {
        if (event.isTrusted && event.pointerType === 'mouse') hoverActive = false;
    }, true);
    for (const type of ['pointerdown', 'keydown']) {
        window.addEventListener(type, () => {
            lastHoverTime = -Infinity;
            // A hover preview may become a persistent popup after activation.
            activatedHints = hoverHints;
            hoverHints = new WeakSet();
            scheduleScan();
        }, true);
    }
    window.addEventListener('scroll', scheduleLayout, true);
    window.addEventListener('resize', scheduleLayout);
    window.addEventListener('load', scheduleScan, true);
    document.addEventListener('visibilitychange', scheduleScan);
    document.fonts?.addEventListener('loadingdone', scheduleLayout);
    function applySettings(value) {
        const settings = CopyMailSettings.normalize(value);
        ignoreHoverHints = settings.ignoreHoverHints;
        googleMapsLinks = settings.googleMapsLinks;
        copyAddresses = settings.copyPatterns.some(pattern => pattern.predefined === 'address' && pattern.isOn);
        const detectionPatterns = [...settings.copyPatterns];
        if (googleMapsLinks && !detectionPatterns.some(pattern => pattern.predefined === 'address')) {
            detectionPatterns.push(CopyMailSettings.normalize().copyPatterns.find(pattern => pattern.predefined === 'address'));
        }
        activePatterns = CopyMailParser.compile(detectionPatterns.map(pattern => pattern.predefined === 'address'
            ? { ...pattern, isOn: copyAddresses || googleMapsLinks } : pattern));
        // All frames follow the website in the address bar, even across origins.
        const ancestors = location.ancestorOrigins;
        const pageUrl = ancestors.length ? ancestors[ancestors.length - 1] : location.href;
        let hostname = '';
        try {
            hostname = new URL(pageUrl).hostname;
        } catch {
            // Opaque documents have no matchable hostname.
        }
        const shouldEnable = CopyMailSettings.isEnabled(settings, hostname);
        if (enabled === shouldEnable) {
            if (enabled) {
                scan();
            }
            return;
        }
        enabled = shouldEnable;
        if (enabled) {
            scan();
            // Covers layout-only changes without rescanning text.
            layoutTimer = setInterval(() => {
                if (!document.hidden) {
                    scheduleLayout();
                }
            }, 500);
        } else {
            observer.disconnect();
            observedRoots.clear();
            clearTimeout(scanTimer);
            cancelAnimationFrame(layoutFrame);
            clearInterval(layoutTimer);
            scanTimer = 0;
            layoutFrame = 0;
            for (const record of records.values()) {
                record.button?.remove();
                record.mapLink?.remove();
                record.spacer?.remove();
            }
            records.clear();
            host.remove();
        }
    }

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        let settingsChanged = false;
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && Object.hasOwn(changes, CopyMailSettings.STORAGE_KEY)) {
                settingsChanged = true;
                applySettings(changes[CopyMailSettings.STORAGE_KEY].newValue);
            }
        });
        chrome.storage.local.get(CopyMailSettings.STORAGE_KEY).then(stored => {
            if (!settingsChanged) {
                applySettings(stored[CopyMailSettings.STORAGE_KEY]);
            }
        }).catch(() => {
            console.warn('CopyEmail could not load website settings. Reload the page to try again.');
        });
    } else {
        applySettings();
    }
})();
