const CopyMailScanner = (() => {
    'use strict';

    const { BuiltinRuleType } = CopyMailSettings;
    const SKIPPED = 'script,style,noscript,template,textarea,input,select,option,svg,canvas';
    const METADATA = '[href^="mailto:" i],[title],[aria-label],[data-email]';

    class Location {
        constructor(element, range) {
            this.element = element;
            this.range = range;
        }
    }

    class Detection {
        constructor(location, rule, value) {
            this.location = location;
            this.rule = rule;
            this.value = value;
        }
    }

    class CompiledRule {
        constructor(rule, actions, pattern) {
            this.rule = rule;
            this.actions = actions;
            this.pattern = pattern;
        }
    }

    class Scanner {
        constructor(settings, { geography = null } = {}) {
            this.settings = settings;
            this.geography = geography;
            this.listeners = new Set();
            this.compiledRules = [];
            this.compiledRevision = null;
        }

        // Page-owned exclusions and root observation are per-scan callbacks, not dependencies.
        scan(root, { isIgnored = () => false, onRoot = () => {} } = {}) {
            this.refreshCompiledRules();
            const detections = [];
            this.collect(root, detections, { isIgnored, onRoot });
            return detections;
        }

        refreshCompiledRules() {
            if (this.compiledRevision === this.settings.revision) return;
            const rules = this.settings.value?.rules || [];
            this.compiledRules = rules.flatMap(rule => {
                const actions = rule.enabledActions;
                if (!actions.length || !rule.name?.trim() || !rule.patterns?.length) return [];
                try {
                    const alternatives = new CopyMailPatterns.OrPattern(
                        rule.patterns.map(source => new CopyMailPatterns.RegexPattern(source)));
                    const pattern = rule.builtinType === BuiltinRuleType.ADDRESS
                        ? new CopyMailPatterns.AddressPattern(alternatives, null, {
                            geography: this.geography, onInvalidate: () => this.invalidate()
                        })
                        : alternatives;
                    return [new CompiledRule(rule, actions, pattern)];
                } catch {
                    return [];
                }
            });
            this.compiledRevision = this.settings.revision;
        }

        subscribe(listener) {
            this.listeners.add(listener);
            return () => this.listeners.delete(listener);
        }

        invalidate() {
            for (const listener of this.listeners) listener();
        }

        collect(root, detections, context, metadataElements = new Set()) {
            if (root.host) context.onRoot(root);
            this.collectMetadata(root, detections, context, metadataElements);
            let text = '';
            let segments = [];

            const flush = () => {
                if (!text || !segments.length) {
                    text = '';
                    segments = [];
                    return;
                }
                const input = { text, segments };
                const accepted = this.ruleMatches(input);
                accepted.sort((left, right) => left.finding.index - right.finding.index);
                for (const item of accepted) {
                    const start = item.finding.index;
                    const end = start + item.finding.text.length;
                    if (/(?:…|\.{3})$/.test(text.slice(0, start)) || /^(?:…|\.{3})/.test(text.slice(end))) continue;
                    const first = segments.find(segment => segment.end > start);
                    const last = segments.find(segment => segment.end >= end);
                    if (!first || !last) continue;
                    const range = (root.ownerDocument || root).createRange();
                    range.setStart(first.node, start - first.start);
                    range.setEnd(last.node, end - last.start);
                    const element = last.node.parentElement || last.node.getRootNode().host;
                    const value = this.findingValue(item.compiled, item.finding, element);
                    detections.push(new Detection(new Location(element, range), item.compiled.rule, value));
                }
                text = '';
                segments = [];
            };

            const visit = node => {
                if (context.isIgnored(node)) return;
                if (node.nodeType === Node.TEXT_NODE) {
                    segments.push({ node, start: text.length, end: text.length + node.length });
                    text += node.data;
                    return;
                }
                if (node.nodeType !== Node.ELEMENT_NODE && node !== root) return;
                if (node.nodeType === Node.ELEMENT_NODE &&
                    (this.isSkipped(node, context) || metadataElements.has(node))) {
                    flush();
                    return;
                }
                const display = node.nodeType === Node.ELEMENT_NODE ? getComputedStyle(node).display : '';
                const boundary = node.nodeName === 'BR' || (display && display !== 'inline' && display !== 'contents');
                if (boundary) flush();
                if (node.shadowRoot) {
                    flush();
                    this.collect(node.shadowRoot, detections, context, metadataElements);
                } else {
                    const assigned = node.nodeName === 'SLOT' ? node.assignedNodes({ flatten: true }) : [];
                    for (const child of assigned.length ? assigned : node.childNodes) visit(child);
                }
                if (boundary) flush();
            };
            visit(root);
            flush();
        }

        collectMetadata(root, detections, context, metadataElements) {
            for (const element of root.querySelectorAll(METADATA)) {
                if (this.isSkipped(element, context) || element.closest(SKIPPED) || element.isContentEditable) continue;
                const match = this.metadataFinding(element);
                if (!match) continue;
                const rawValue = match.finding.value;
                const label = element.textContent.trim();
                if (!this.shortenedLabelMatches(label, rawValue)) continue;
                if ([...element.querySelectorAll(METADATA)]
                    .some(child => this.shortenedLabelMatches(child.textContent.trim(), rawValue))) continue;
                const range = (root.ownerDocument || root).createRange();
                range.selectNodeContents(element);
                if (context.isIgnored(element.lastChild)) range.setEndBefore(element.lastChild);
                const value = this.findingValue(match.compiled, match.finding, element);
                detections.push(new Detection(new Location(element, range), match.compiled.rule, value));
                metadataElements.add(element);
            }
        }

        metadataFinding(element) {
            const href = element.getAttribute('href') || '';
            let recipient = '';
            if (/^mailto:/i.test(href)) {
                try {
                    recipient = decodeURIComponent(href.slice(7).split('?')[0]);
                } catch {
                    // Other metadata can still provide a valid value.
                }
            }
            for (const value of [recipient, element.getAttribute('data-email'),
                element.getAttribute('title'), element.getAttribute('aria-label')]) {
                const matches = this.ruleMatches({ text: value || '' });
                if (matches.length === 1) return matches[0];
            }
            return null;
        }

        ruleMatches(input) {
            const accepted = [];
            for (const compiled of this.compiledRules) {
                for (const finding of compiled.pattern.matches(input)) {
                    if (!accepted.some(item => finding.index < item.finding.index + item.finding.text.length &&
                        item.finding.index < finding.index + finding.text.length)) {
                        accepted.push({ finding, compiled });
                    }
                }
            }
            return accepted;
        }

        findingValue(compiled, finding, element) {
            return compiled.pattern.valueFor(finding, { element, parentElement: this.parentElement });
        }

        shortenedLabelMatches(label, value) {
            if (!/(?:…|\.{3})/.test(label)) return false;
            const parts = label.toLowerCase().split(/…|\.{3}/);
            const target = value.toLowerCase();
            return parts.length === 2 && Boolean(parts[0] || parts[1]) &&
                target.startsWith(parts[0]) && target.endsWith(parts[1]);
        }

        parentElement(element) {
            return element.assignedSlot || element.parentElement || element.getRootNode().host || null;
        }

        isSkipped(element, context) {
            return context.isIgnored(element) || element.matches(SKIPPED) || element.isContentEditable;
        }
    }

    return Object.freeze({ Scanner, Location, Detection, CompiledRule });
})();

