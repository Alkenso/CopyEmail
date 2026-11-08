const CopyMailScanner = (() => {
    'use strict';

    const SKIPPED = 'script,style,noscript,template,textarea,input,select,option,svg,canvas';
    const METADATA = '[href^="mailto:" i],[title],[aria-label],[data-email]';

    class Location {
        constructor(element, range) {
            this.element = element;
            this.range = range;
        }
    }

    class Finding {
        constructor(location, value) {
            this.location = location;
            this.value = value;
        }
    }

    class Detection extends Finding {
        constructor(location, rule, value) {
            super(location, value);
            this.rule = rule;
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
        constructor(settings, options = {}) {
            this.settings = settings;
            this.options = options;
            this.compiledRules = [];
            this.compiledRevision = null;
            this.geographyRequested = false;
        }

        scan(root) {
            this.refreshCompiledRules();
            const detections = [];
            this.collect(root, detections);
            return detections;
        }

        refreshCompiledRules() {
            if (this.compiledRevision === this.settings.revision) return;
            const rules = this.settings.value?.rules || [];
            this.compiledRules = rules.flatMap(rule => {
                const possible = new Set(rule.possibleActions || []);
                const actions = [...new Set(rule.enabledActions || [])].filter(action => possible.has(action));
                if (!actions.length || !rule.name?.trim() || !rule.patterns?.length) return [];
                try {
                    const alternatives = new CopyMailParser.OrPattern(
                        rule.patterns.map(source => new CopyMailParser.RegexPattern(source)));
                    const geography = this.options.geography ||
                        (typeof CopyMailGeography !== 'undefined' ? CopyMailGeography : null);
                    const pattern = rule.builtinType === 'address'
                        ? new CopyMailParser.AddressPattern(alternatives, null, geography)
                        : alternatives;
                    return [new CompiledRule(rule, actions, pattern)];
                } catch {
                    return [];
                }
            });
            this.compiledRevision = this.settings.revision;
        }

        requestGeographyIfNeeded(pattern) {
            if (this.geographyRequested || !(pattern instanceof CopyMailParser.AddressPattern)) return;
            const geography = this.options.geography ||
                (typeof CopyMailGeography !== 'undefined' ? CopyMailGeography : null);
            if (!geography?.load) return;
            this.geographyRequested = true;
            geography.load().then(() => this.options.onInvalidate?.()).catch(error => {
                console.warn('CopyEmail could not load city names.', error);
            });
        }

        collect(root, detections, metadataElements = new Set()) {
            if (root.host) this.options.observeRoot?.(root);
            this.collectMetadata(root, detections, metadataElements);
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
                    const range = document.createRange();
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
                if (this.options.isSpacer?.(node)) return;
                if (node.nodeType === Node.TEXT_NODE) {
                    segments.push({ node, start: text.length, end: text.length + node.length });
                    text += node.data;
                    return;
                }
                if (node.nodeType !== Node.ELEMENT_NODE && node !== root) return;
                if (node.nodeType === Node.ELEMENT_NODE &&
                    (this.isSkipped(node) || metadataElements.has(node))) {
                    flush();
                    return;
                }
                const display = node.nodeType === Node.ELEMENT_NODE ? getComputedStyle(node).display : '';
                const boundary = node.nodeName === 'BR' || (display && display !== 'inline' && display !== 'contents');
                if (boundary) flush();
                if (node.shadowRoot) {
                    flush();
                    this.collect(node.shadowRoot, detections, metadataElements);
                } else {
                    const assigned = node.nodeName === 'SLOT' ? node.assignedNodes({ flatten: true }) : [];
                    for (const child of assigned.length ? assigned : node.childNodes) visit(child);
                }
                if (boundary) flush();
            };
            visit(root);
            flush();
        }

        collectMetadata(root, detections, metadataElements) {
            for (const element of root.querySelectorAll(METADATA)) {
                if (this.isSkipped(element) || element.closest(SKIPPED) || element.isContentEditable) continue;
                const match = this.metadataFinding(element);
                if (!match) continue;
                const rawValue = match.finding.value;
                const label = element.textContent.trim();
                if (!this.shortenedLabelMatches(label, rawValue)) continue;
                if ([...element.querySelectorAll(METADATA)]
                    .some(child => this.shortenedLabelMatches(child.textContent.trim(), rawValue))) continue;
                const range = document.createRange();
                range.selectNodeContents(element);
                if (this.options.isSpacer?.(element.lastChild)) range.setEndBefore(element.lastChild);
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
            if (!(compiled.pattern instanceof CopyMailParser.AddressPattern)) return finding.value;
            this.requestGeographyIfNeeded(compiled.pattern);
            return compiled.pattern.enrich(finding, element, this.parentElement.bind(this));
        }

        shortenedLabelMatches(label, value) {
            if (!/(?:…|\.{3})/.test(label)) return false;
            const parts = label.toLowerCase().split(/…|\.{3}/);
            const target = value.toLowerCase();
            return parts.length === 2 && Boolean(parts[0] || parts[1]) &&
                target.startsWith(parts[0]) && target.endsWith(parts[1]);
        }

        parentElement(element) {
            return this.options.parentElement?.(element) ||
                element.assignedSlot || element.parentElement || element.getRootNode().host || null;
        }

        isSkipped(element) {
            return this.options.isSkipped?.(element) ??
                (element.matches(SKIPPED) || element.isContentEditable);
        }
    }

    return Object.freeze({ Scanner, Location, Finding, Detection, CompiledRule,
        Pattern: CopyMailParser.Pattern,
        RegexPattern: CopyMailParser.RegexPattern,
        OrPattern: CopyMailParser.OrPattern,
        AddressPattern: CopyMailParser.AddressPattern });
})();

