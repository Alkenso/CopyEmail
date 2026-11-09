'use strict';

class PageAugmenter {
    constructor(settings, scanner, services) {
        this.settings = settings;
        this.scanner = scanner;
        this.services = services;
        this.handleCopyInteraction = this.handleCopyInteraction.bind(this);
        this.handlePointerOver = this.handlePointerOver.bind(this);
        this.handlePointerOut = this.handlePointerOut.bind(this);
        this.handleActivation = this.handleActivation.bind(this);
        this.handleMutations = this.handleMutations.bind(this);
        this.positionButtons = this.positionButtons.bind(this);
        this.scheduleLayout = this.scheduleLayout.bind(this);
        this.scan = this.scan.bind(this);
        this.scheduleScan = this.scheduleScan.bind(this);

        this.started = false;
        this.eventController = null;
        this.unsubscribeSettings = null;
        this.unsubscribeScanner = null;
        this.ignoreHoverHints = false;
        this.lastHoverTime = -Infinity;
        this.hoveredElements = [];
        this.hoverActive = false;
        this.hoverHints = new WeakSet();
        this.activatedHints = new WeakSet();
        this.Status = Object.freeze({COPY: 'copy', COPIED: 'copied', ERROR: 'error', MAP: 'map'});
        this.ICONS = Object.freeze({
            [this.Status.MAP]:
                '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
            [this.Status.COPY]:
                '<rect x="8" y="8" width="12" height="12" rx="2" fill="white"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
            [this.Status.COPIED]: '<path d="m5 12 4 4L19 6"/>',
            [this.Status.ERROR]: '<path d="m6 6 12 12M6 18 18 6"/>'
        });
        this.host = document.createElement('copymail-overlay');
        this.host.style.cssText =
            'all:initial!important;position:fixed!important;top:0!important;left:0!important;width:0!important;height:0!important;overflow:visible!important;pointer-events:none!important;z-index:2147483647!important;';
        this.shadow = this.host.attachShadow({mode: 'open'});
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
        this.shadow.append(style);
        this.records = new Map();
        this.spacers = new WeakSet();
        this.copyActions = new WeakMap();
        this.buttonResetTimers = new Map();
        this.nextNodeId = 0;
        this.nodeIds = new WeakMap();
        this.scanTimer = 0;
        this.layoutFrame = 0;
        this.layoutTimer = 0;
        this.enabled = false;
        this.observedRoots = new Set();
        this.observer = new MutationObserver(this.handleMutations);
    }

    async start() {
        if (this.started) return;

        this.started = true;
        this.installEventListeners();
        const {signal} = this.eventController;

        try {
            await this.settings.load();
            if (signal.aborted) return;
            this.unsubscribeSettings = this.settings.subscribe(nextValue => this.applySettings(nextValue));
            this.unsubscribeScanner = this.scanner.subscribe(this.scheduleScan);
            this.applySettings(this.settings.value);
        } catch (error) {
            if (!signal.aborted) this.dispose();
            throw error;
        }
    }

    dispose() {
        this.started = false;
        this.eventController?.abort();
        this.eventController = null;
        this.unsubscribeSettings?.();
        this.unsubscribeSettings = null;
        this.unsubscribeScanner?.();
        this.unsubscribeScanner = null;
        this.setEnabled(false);
    }

    installEventListeners() {
        this.eventController = new AbortController();
        const signal = this.eventController.signal;
        const capture = {capture: true, signal};

        for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick']) {
            window.addEventListener(type, this.handleCopyInteraction, capture);
        }
        window.addEventListener('pointerover', this.handlePointerOver, capture);
        window.addEventListener('pointerout', this.handlePointerOut, capture);
        window.addEventListener('pointerdown', this.handleActivation, capture);
        window.addEventListener('keydown', this.handleActivation, capture);
        window.addEventListener('scroll', this.scheduleLayout, capture);
        window.addEventListener('resize', this.scheduleLayout, {signal});
        window.addEventListener('load', this.scheduleScan, capture);
        document.addEventListener('visibilitychange', this.scheduleScan, {signal});
        document.fonts?.addEventListener('loadingdone', this.scheduleLayout, {signal});
    }

    handlePointerOver(event) {
        if (!this.enabled || !event.isTrusted || event.pointerType !== 'mouse') return;

        this.lastHoverTime = performance.now();
        this.hoverActive = true;
        this.hoveredElements = event.composedPath().filter(node => node instanceof Element);
        if (this.ignoreHoverHints) this.scheduleScan();
        this.scheduleLayout();
    }

    handlePointerOut(event) {
        if (event.isTrusted && event.pointerType === 'mouse') this.hoverActive = false;
    }

    handleActivation() {
        this.lastHoverTime = -Infinity;
        // A hover preview may become a persistent popup after activation.
        this.activatedHints = this.hoverHints;
        this.hoverHints = new WeakSet();
        this.scheduleScan();
    }

    handleMutations(mutations) {
        const hasPageMutation = mutations.some(
            mutation => mutation.target !== this.host &&
                (mutation.type !== 'childList' ||
                 [...mutation.addedNodes, ...mutation.removedNodes].some(node => node !== this.host)));
        if (hasPageMutation) this.scheduleScan();
    }

    parentElement(element) {
        return element.assignedSlot || element.parentElement || element.getRootNode().host || null;
    }

    addCandidate(candidates, range, value, element, rule) {
        const node = range.startContainer;
        if (!this.nodeIds.has(node)) {
            this.nodeIds.set(node, ++this.nextNodeId);
        }
        const key = `${this.nodeIds.get(node)}:${range.startOffset}:${rule.id}:${value}`;
        const candidate = {range, value, element, rule};
        candidates.set(key, candidate);
        return candidate;
    }

    setStatus(button, value, status) {
        button.dataset.status = status;
        button.title = status === this.Status.COPIED ? 'Copied!' :
            status === this.Status.ERROR             ? 'Copy failed. Click to retry.' :
                                                       `Copy ${value}`;
        // SVG markup is static; detected values are never interpolated into HTML.
        button.innerHTML =
            `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${
                this.ICONS[status]}</svg>`;
    }

    legacyCopy(value) {
        const focused = this.shadow.activeElement || document.activeElement;
        const selection = document.getSelection();
        const ranges = selection ?
            Array.from({length: selection.rangeCount}, (_, index) => selection.getRangeAt(index).cloneRange()) :
            [];
        const textarea = document.createElement('textarea');
        textarea.value = value;
        this.shadow.append(textarea);
        try {
            textarea.focus({preventScroll: true});
            textarea.select();
            if (!document.execCommand('copy')) {
                throw new Error('Clipboard write was rejected');
            }
        } finally {
            textarea.remove();
            focused?.focus({preventScroll: true});
            if (selection) {
                selection.removeAllRanges();
                for (const range of ranges) {
                    selection.addRange(range);
                }
            }
        }
    }

    async copyValue(value) {
        if (navigator.clipboard?.writeText) {
            try {
                await navigator.clipboard.writeText(value);
                return;
            } catch {
                // HTTP pages and restricted frames can still support legacy copying.
            }
        }
        this.legacyCopy(value);
    }

    createButton(value, command) {
        if (command.action === CopyMailSettings.Action.OPEN_LINK) {
            const link = document.createElement('a');
            link.hidden = true;
            link.href = command.value;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            this.setStatus(link, value, this.Status.MAP);
            link.title = `Open in Google Maps: ${value}`;
            link.setAttribute('aria-label', link.title);
            this.shadow.append(link);
            return link;
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.hidden = true;
        button.setAttribute('aria-label', `Copy ${value}`);
        this.setStatus(button, value, this.Status.COPY);
        this.copyActions.set(button, async () => {
            this.clearButtonResetTimer(button);
            let status = this.Status.COPIED;
            try {
                await this.copyValue(command.value);
            } catch {
                status = this.Status.ERROR;
            }
            if (!this.enabled || !button.isConnected) return;
            this.setStatus(button, value, status);
            // Another pending copy may have completed while this write was awaiting.
            this.clearButtonResetTimer(button);
            const timer = setTimeout(() => {
                this.buttonResetTimers.delete(button);
                if (this.enabled && button.isConnected) {
                    this.setStatus(button, value, this.Status.COPY);
                }
            }, 1500);
            this.buttonResetTimers.set(button, timer);
        });
        this.shadow.append(button);
        return button;
    }

    clearButtonResetTimer(button) {
        clearTimeout(this.buttonResetTimers.get(button));
        this.buttonResetTimers.delete(button);
    }

    removeControl(control) {
        if (!control) return;
        this.clearButtonResetTimer(control);
        control.remove();
    }

    handleCopyInteraction(event) {
        const button = event.composedPath().find(node => this.copyActions.has(node));
        if (!button) {
            return;
        }
        // The overlay is outside page popups. Intercept before document capture
        // handlers treat it as an outside click, and keep focus in the popup.
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.type === 'click' && event.isTrusted) {
            this.copyActions.get(button)();
        }
    }

    isUncovered(element, x, y) {
        for (let current = element; current;) {
            const root = current.getRootNode();
            // Ignore our own button when it is clamped inward at the viewport edge.
            const hit = root.elementsFromPoint(x, y).find(candidate => candidate !== this.host);
            if (!hit || !(current.contains(hit) || hit.contains(current))) {
                return false;
            }
            current = root.host;
        }
        return true;
    }

    visibleRect(range, element) {
        if (!element.isConnected || !element.checkVisibility({checkOpacity: true, checkVisibilityCSS: true})) {
            return null;
        }
        let left = 0;
        let top = 0;
        let right = document.documentElement.clientWidth;
        let bottom = window.innerHeight;
        for (let ancestor = element; ancestor; ancestor = this.parentElement(ancestor)) {
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
            const line = rectangles.filter(
                other => Math.abs(other.top - rect.top) < 1 && Math.abs(other.bottom - rect.bottom) < 1);
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
            if (this.isUncovered(element, x, y)) {
                return clipped;
            }
        }
        return null;
    }

    positionButtons() {
        this.layoutFrame = 0;
        for (const record of this.records.values()) {
            const hoverHint = this.isHoverHint(record, record);
            const rect = this.ignoreHoverHints && hoverHint ? null : this.visibleRect(record.range, record.element);
            if (record.button) record.button.hidden = !rect;
            if (record.mapLink) record.mapLink.hidden = !rect;
            if (rect) {
                // Stay at the visible trailing edge, including text-overflow: ellipsis.
                const x = Math.min(
                    rect.right + 3, document.documentElement.clientWidth - (record.button && record.mapLink ? 43 : 20));
                const y = Math.max(0, Math.min((rect.top + rect.bottom) / 2 - 10, window.innerHeight - 20));
                if (record.button) record.button.style.transform = `translate(${x}px, ${y}px)`;
                if (record.mapLink)
                    record.mapLink.style.transform = `translate(${x + (record.button ? 23 : 0)}px, ${y}px)`;
            }
        }
    }

    scheduleLayout() {
        if (this.enabled && !this.layoutFrame) {
            this.layoutFrame = requestAnimationFrame(this.positionButtons);
        }
    }

    reserveButtonSpace(range, element, hasMultipleActions) {
        const width = hasMultipleActions ? 49 : 26;
        const end = range.endContainer;
        const next = end.nodeType === Node.TEXT_NODE ? range.endOffset === end.length ? end.nextSibling : null :
                                                       end.childNodes[range.endOffset];
        if (this.spacers.has(next)) {
            next.style.setProperty('padding-left', `${width}px`, 'important');
            return next;
        }
        const rect = this.visibleRect(range, element);
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
        if (![...following.getClientRects()].some(
                part => part.left < rect.right + width - 3 && part.right > rect.right + 3 && part.top < rect.bottom &&
                    part.bottom > rect.top)) {
            return null;
        }
        const spacer = document.createElement('span');
        spacer.setAttribute('aria-hidden', 'true');
        spacer.style.cssText =
            'all:initial!important;display:inline!important;white-space:inherit!important;padding-left:26px!important;font-size:0!important;line-height:0!important;pointer-events:none!important;';
        spacer.style.setProperty('padding-left', `${width}px`, 'important');
        this.spacers.add(spacer);
        const insertion = range.cloneRange();
        insertion.collapse(false);
        insertion.insertNode(spacer);
        range.setEndBefore(spacer);
        return spacer;
    }

    isHoverHint(candidate, previous) {
        // Delayed previews still belong to the hover while the pointer stays on its trigger.
        // Pointer/key activation clears lastHoverTime so click-opened popups remain usable.
        const activeHover =
            this.lastHoverTime !== -Infinity && (performance.now() - this.lastHoverTime < 1500 || this.hoverActive);
        const appearedOnHover = activeHover && (!previous || (previous.button || previous.mapLink).hidden) &&
            Boolean(this.visibleRect(candidate.range, candidate.element));
        for (let element = candidate.element; element; element = this.parentElement(element)) {
            if (this.activatedHints.has(element)) {
                if (element.checkVisibility({checkOpacity: true, checkVisibilityCSS: true})) {
                    return false;
                }
                this.activatedHints.delete(element);
            }
            if (this.hoverHints.has(element) || element.matches('[role="tooltip"],tool-tip,[popover="hint"]')) {
                return true;
            }
            if (appearedOnHover && !this.hoveredElements.includes(element) &&
                /^(absolute|fixed)$/.test(getComputedStyle(element).position)) {
                this.hoverHints.add(element);
                return true;
            }
        }
        return false;
    }

    scan() {
        this.scanTimer = 0;
        if (!this.enabled) {
            return;
        }
        if (!this.host.isConnected) {
            document.documentElement.append(this.host);
        }
        const previouslyObservedRoots = new Set(this.observedRoots);
        const scannedRoots = new Set();
        let scanCompleted = false;
        this.observer.disconnect();
        this.observedRoots.clear();
        try {
            const collected = new Map();
            const detections = this.scanner.scan(document.body || document.documentElement, {
                isIgnored: node => node === this.host || this.spacers.has(node),
                onRoot: root => scannedRoots.add(root)
            });
            for (const detection of detections) {
                this.addCandidate(
                    collected, detection.location.range, detection.value, detection.location.element, detection.rule);
            }
            for (const [key, candidate] of collected) {
                const hoverHint = this.isHoverHint(candidate, this.records.get(key));
                if (this.ignoreHoverHints && hoverHint) {
                    collected.delete(key);
                }
            }
            // Prepare all commands before inserting spacers or replacing existing controls.
            for (const candidate of collected.values()) {
                candidate.commands = this.services.commands({rule: candidate.rule, value: candidate.value});
            }
            // Work backwards so splitting a text node preserves earlier match offsets.
            for (const candidate of [...collected.values()].reverse()) {
                candidate.spacer = this.reserveButtonSpace(
                    candidate.range, candidate.element, candidate.commands.length > 1);
            }
            const candidates = new Map();
            for (const candidate of collected.values()) {
                // Inserting spacers can split the start nodes of subsequent matches.
                const record =
                    this.addCandidate(candidates, candidate.range, candidate.value, candidate.element, candidate.rule);
                record.spacer = candidate.spacer;
                record.commands = candidate.commands;
            }
            const retainedSpacers = new Set();
            for (const [key, candidate] of candidates) {
                retainedSpacers.add(candidate.spacer);
                for (const command of candidate.commands) {
                    if (command.action === CopyMailSettings.Action.COPY) {
                        candidate.button = this.records.get(key)?.button || this.createButton(candidate.value, command);
                    } else {
                        candidate.mapLink =
                            this.records.get(key)?.mapLink || this.createButton(candidate.value, command);
                        candidate.button?.after(candidate.mapLink);
                    }
                }
            }
            for (const [key, record] of this.records) {
                if (!candidates.get(key)?.button) this.removeControl(record.button);
                if (!candidates.get(key)?.mapLink) this.removeControl(record.mapLink);
                if (!retainedSpacers.has(record.spacer)) record.spacer?.remove();
            }
            this.records = candidates;
            this.scheduleLayout();
            scanCompleted = true;
        } finally {
            // Spacer insertion must not trigger another scan, including in shadow roots.
            this.observer.disconnect();
            this.observedRoots.clear();
            if (this.enabled) {
                this.observeRoot(document.documentElement);
                const roots = scanCompleted ? scannedRoots : previouslyObservedRoots;
                for (const root of roots) {
                    if (root.isConnected) this.observeRoot(root);
                }
            }
        }
    }

    scheduleScan() {
        if (this.enabled && !this.scanTimer) {
            this.scanTimer = setTimeout(this.scan, 100);
        }
    }

    observeRoot(root) {
        if (!this.observedRoots.has(root)) {
            this.observedRoots.add(root);
            this.observer.observe(root, {
                subtree: true,
                childList: true,
                characterData: true,
                attributes: true,
                attributeFilter:
                    ['href', 'title', 'aria-label', 'data-email', 'class', 'style', 'hidden', 'open', 'contenteditable']
            });
        }
    }

    applySettings(value) {
        this.ignoreHoverHints = value.ignoreHoverHints;
        // All frames follow the website in the address bar, even across origins.
        const ancestors = location.ancestorOrigins;
        const pageUrl = ancestors.length ? ancestors[ancestors.length - 1] : location.href;
        let hostname = '';
        try {
            hostname = new URL(pageUrl).hostname;
        } catch {
            // Opaque documents have no matchable hostname.
        }
        const shouldEnable = this.settings.isEnabled(hostname);
        if (this.enabled === shouldEnable) {
            if (this.enabled) {
                this.scan();
            }
            return;
        }
        this.setEnabled(shouldEnable);
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        if (enabled) {
            this.scan();
            // Covers layout-only changes without rescanning text.
            this.layoutTimer = setInterval(() => {
                if (!document.hidden) {
                    this.scheduleLayout();
                }
            }, 500);
            return;
        }

        this.observer.disconnect();
        this.observedRoots.clear();
        clearTimeout(this.scanTimer);
        cancelAnimationFrame(this.layoutFrame);
        clearInterval(this.layoutTimer);
        this.scanTimer = 0;
        this.layoutFrame = 0;
        this.layoutTimer = 0;
        for (const timer of this.buttonResetTimers.values()) clearTimeout(timer);
        this.buttonResetTimers.clear();
        for (const record of this.records.values()) {
            this.removeControl(record.button);
            this.removeControl(record.mapLink);
            record.spacer?.remove();
        }
        this.records.clear();
        this.host.remove();
    }
}
