const CopyMailPatterns = (() => {
    'use strict';

    function validateRegex(source) {
        if (!source.trim()) throw new Error('Regex is required.');
        return new RegExp(source, /\\[pP]\{/.test(source) ? 'giu' : 'gi');
    }

    /** A pattern finding uses offsets in Scanner-prepared text. */
    class PatternFinding {
        constructor(text, index) {
            this.text = text;
            this.index = index;
            this.value = text.trim();
        }
    }

    class Pattern {
        matches() {
            throw new Error('Pattern.matches must be implemented.');
        }

        starts(text) {
            return this.matches({ text }).some(finding => finding.index === 0);
        }

        // Resolve context only after Scanner has accepted a match and located it.
        valueFor(finding, context) {
            return finding.value;
        }
    }

    class RegexPattern extends Pattern {
        constructor(source) {
            super();
            this.source = source;
            this.expression = validateRegex(source);
        }

        matches(input) {
            return [...input.text.matchAll(this.expression)]
                .filter(match => match[0])
                .map(match => new PatternFinding(match[0], match.index));
        }

        starts(text) {
            const expression = new RegExp(`^(?:${this.expression.source})`, this.expression.flags.replace('g', ''));
            return expression.test(text);
        }
    }

    class OrPattern extends Pattern {
        constructor(patterns) {
            super();
            this.patterns = patterns;
        }

        matches(input) {
            const accepted = [];
            const findings = this.patterns.flatMap(pattern => pattern.matches(input))
                .sort((left, right) => left.index - right.index || right.text.length - left.text.length);
            for (const finding of findings) {
                if (!accepted.some(other => finding.index < other.index + other.text.length &&
                    other.index < finding.index + finding.text.length)) {
                    accepted.push(finding);
                }
            }
            return accepted;
        }

        starts(text) {
            return this.patterns.some(pattern => pattern.starts(text));
        }
    }

    class AddressPattern extends Pattern {
        #geography;
        #onInvalidate;
        #loadingRequested = false;

        constructor(address, parent = null, { geography = null, onInvalidate = () => {} } = {}) {
            super();
            this.address = address;
            this.parent = parent;
            this.#geography = geography;
            this.#onInvalidate = onInvalidate;
        }

        matches(input) {
            const findings = [];
            let offset = 0;
            const collect = end => {
                const part = input.text.slice(offset, end);
                for (const finding of this.address.matches({ ...input, text: part })) {
                    finding.index += offset;
                    findings.push(finding);
                }
            };
            for (const comma of input.text.matchAll(/,[ \t]*/g)) {
                const next = comma.index + comma[0].length;
                if (this.address.starts(input.text.slice(next))) {
                    collect(comma.index);
                    offset = next;
                }
            }
            collect(input.text.length);
            return findings.sort((left, right) => left.index - right.index);
        }

        valueFor(finding, { element, parentElement }) {
            this.#requestGeography();
            const values = [finding.value];
            const contexts = contextLines(element, 5, parentElement);
            if (this.#geography) {
                const local = this.#geography.find(finding.text);
                let parentCity = '';
                for (const context of contexts) {
                    const found = this.#geography.find(context);
                    parentCity ||= found.city;
                    local.country ||= found.country;
                }
                for (const value of [parentCity || local.city, local.country]) {
                    if (value && !this.#geography.contains(finding.text, value)) values.push(value);
                }
            }
            if (this.parent) {
                for (const context of contexts) {
                    const matches = this.parent.matches({ text: context });
                    if (matches.length) {
                        values.push(...matches.map(match => match.value));
                        break;
                    }
                }
            }
            return [...new Set(values)].join(', ');
        }

        #requestGeography() {
            if (this.#loadingRequested || !this.#geography?.load) return;
            this.#loadingRequested = true;
            this.#geography.load().then(() => this.#onInvalidate()).catch(error => {
                console.warn('CopyEmail could not load city names.', error);
            });
        }
    }

    // Inspect each ancestor's context without reading the branch containing the match.
    // List items, hidden content and unrelated address cards must not leak into context.
    function contextLines(element, levels, parentElement) {
        const result = [];
        let branch = element;
        for (let level = 0; level < levels; level++) {
            const parent = parentElement(branch);
            if (!parent || parent === parent.ownerDocument.documentElement) {
                break;
            }
            const lines = [];
            function visit(node) {
                if (node === branch) return;
                if (node.nodeType === Node.TEXT_NODE) {
                    lines.push(node.data);
                } else if (node.nodeType === Node.ELEMENT_NODE &&
                    !node.matches('script,style,noscript,template,input,textarea,select,svg,canvas,li,ul,ol,article,section,main,nav,footer') &&
                    !node.isContentEditable && node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) {
                    // Compact labels may contain inline markup; large subtrees are not labels.
                    if (node.textContent.length <= 160 && !node.querySelector('p,li,ul,ol,article,section,main,[hidden]')) {
                        lines.push(node.textContent);
                    }
                }
            }
            for (const child of parent.childNodes) visit(child);
            result.push(lines.join('\n'));
            branch = parent;
        }
        return result;
    }

    return Object.freeze({ Pattern, PatternFinding, RegexPattern, OrPattern, AddressPattern, validateRegex });
})();
