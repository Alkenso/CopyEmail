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

    function compile(patterns) {
        return patterns.filter(pattern => pattern.isOn).flatMap(pattern => {
            try {
                return [{ ...pattern, expression: CopyMailSettings.validateRegex(pattern.regex),
                    parentExpression: pattern.parentRegex ? CopyMailSettings.validateRegex(pattern.parentRegex) : null }];
            } catch {
                return [];
            }
        });
    }

    function find(text, patterns) {
        const accepted = [];
        for (const pattern of patterns) {
            for (const match of text.matchAll(pattern.expression)) {
                if (match[0] && !accepted.some(other => match.index < other.index + other.text.length &&
                    other.index < match.index + match[0].length)) {
                    accepted.push(new Match(match[0], match.index, pattern));
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
        const values = [match.text.trim()];
        const pattern = match.pattern;
        if (!pattern.parentLevels) return values[0];
        const contexts = contextLines(element, pattern.parentLevels, parentElement);
        if (pattern.action === Action.MAP && geography) {
            const local = geography.find(match.text);
            for (const context of contexts) {
                const found = geography.find(context);
                local.city ||= found.city;
                local.country ||= found.country;
            }
            for (const value of [local.city, local.country]) {
                if (value && !geography.contains(match.text, value)) values.push(value);
            }
        }
        if (pattern.parentExpression) {
            for (const context of contexts) {
                const matches = [...context.matchAll(pattern.parentExpression)].map(item => item[0].trim()).filter(Boolean);
                if (matches.length) {
                    values.push(...matches);
                    break;
                }
            }
        }
        return [...new Set(values)].join(', ');
    }

    return Object.freeze({ Action, compile, find, enrich });
})();
