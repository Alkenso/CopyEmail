const CopyMailParser = (() => {
    'use strict';

    const Action = Object.freeze({ COPY: 'copy', MAP: 'map' });

    /** A match keeps its DOM offsets separate from the enriched action value. */
    class Match {
        constructor(text, index, pattern) {
            this.text = text;
            this.index = index;
            this.pattern = pattern;
        }
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
    }

    class RegexPattern extends Pattern {
        constructor(source) {
            super();
            this.source = source;
            this.expression = CopyMailSettings.validateRegex(source);
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
            return this.patterns.some(pattern => pattern.starts?.(text));
        }
    }

    class AddressPattern extends Pattern {
        constructor(address, parent = null, geography = null) {
            super();
            this.address = address;
            this.parent = parent;
            this.geography = geography;
            this.parentLevels = 5;
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
                if (this.address.starts?.(input.text.slice(next))) {
                    collect(comma.index);
                    offset = next;
                }
            }
            collect(input.text.length);
            return findings.sort((left, right) => left.index - right.index);
        }

        enrich(finding, element, parentElement) {
            const values = [finding.value];
            const contexts = contextLines(element, this.parentLevels, parentElement);
            if (this.geography) {
                const local = this.geography.find(finding.text);
                let parentCity = '';
                for (const context of contexts) {
                    const found = this.geography.find(context);
                    parentCity ||= found.city;
                    local.country ||= found.country;
                }
                for (const value of [parentCity || local.city, local.country]) {
                    if (value && !this.geography.contains(finding.text, value)) values.push(value);
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
    }

    function compile(patterns) {
        return patterns.filter(pattern => pattern.isOn && typeof pattern.name === 'string' && pattern.name.trim()).flatMap(pattern => {
            try {
                const alternatives = new OrPattern(pattern.regexes.map(source => new RegexPattern(source)));
                const parentPattern = pattern.parentRegex ? new RegexPattern(pattern.parentRegex) : null;
                return [{ ...pattern,
                    runtimePattern: pattern.action === Action.MAP ? new AddressPattern(alternatives) : alternatives,
                    parentPattern,
                    parentExpression: parentPattern?.expression || null }];
            } catch {
                return [];
            }
        });
    }

    function find(text, patterns) {
        const accepted = [];
        for (const pattern of patterns) {
            for (const finding of pattern.runtimePattern.matches({ text })) {
                if (!accepted.some(other => finding.index < other.index + other.text.length &&
                    other.index < finding.index + finding.text.length)) {
                    accepted.push(new Match(finding.text, finding.index, pattern));
                }
            }
        }
        return accepted.sort((a, b) => a.index - b.index);
    }

    // Inspect each ancestor's context without reading the branch containing the match.
    // List items, hidden content and unrelated address cards must not leak into context.
    function contextLines(element, levels, parentElement) {
        const result = [];
        let branch = element;
        for (let level = 0; level < levels; level++) {
            const parent = parentElement(branch);
            if (!parent || parent === document.documentElement) {
                break;
            }
            const lines = [];
            function visit(node) {
                if (node === branch) return;
                if (node.nodeType === Node.TEXT_NODE) {
                    lines.push(node.data);
                } else if (node.nodeType === Node.ELEMENT_NODE &&
                    !node.matches('script,style,noscript,template,input,textarea,select,svg,canvas,li,ul,ol,article,section,main,nav,footer,copymail-overlay') &&
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

    function enrich(match, element, parentElement, geography) {
        const pattern = match.pattern;
        if (!pattern.parentLevels || !(pattern.runtimePattern instanceof AddressPattern)) return match.text.trim();
        const adapter = new AddressPattern(pattern.runtimePattern.address, pattern.parentPattern,
            pattern.action === Action.MAP ? geography : null);
        adapter.parentLevels = pattern.parentLevels;
        return adapter.enrich(new PatternFinding(match.text, match.index), element, parentElement);
    }

    return Object.freeze({ Action, Pattern, PatternFinding, RegexPattern, OrPattern, AddressPattern,
        compile, find, enrich, contextLines });
})();
