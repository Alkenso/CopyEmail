# CopyEmail

CopyEmail is a Chrome extension that adds a subtle copy icon beside email addresses on web pages. Click it to copy the address to your clipboard.

## Why use it?

Selecting an email address manually is awkward, clicking an email link often opens a mail app, and shortened addresses can hide the part you need. CopyEmail makes copying a one-click action and copies the full address when the page provides it—even if the displayed text is clipped or shortened.

## What it does

- Places a semitransparent copy icon at the visible end of an email address.
- Shows a check mark after copying.
- Follows scrolling and dynamically updated page content.
- Lets you choose which websites show copy icons.

## Install

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select this project's `extension` folder.
3. Refresh any already-open pages.

No build step is required. After updating the extension files, reload CopyEmail and refresh your tabs.

## Website settings

Click CopyEmail’s toolbar icon to view categories and toggle their actions. Changes apply immediately. Open the gear button for full settings and custom-rule editing.

- **All sites except…** — enabled everywhere except websites in the list.
- **Only these sites** — enabled only on websites in the list.

Enter one hostname pattern per line, without `https://`, paths, or ports. Matching ignores case. Only two wildcards are supported:

- `*` matches zero or more characters.
- `?` matches exactly one character.

For example, `example.com` matches that website, while `*.example.com` matches its subdomains. Add both to cover both. Click **Save settings** to apply changes immediately to open tabs.

The settings page includes **Ignore hover hints**. It is enabled by default and skips copy icons in detected tooltips and temporary hints shown on hover. Change it and click **Save Settings** to apply your preference.

The **General** settings include **Appearance**: System (default), Light, or Dark. System follows your device’s color scheme. Changes preview immediately; click **Save settings** to apply the preference to the popup and other open settings views.

## Privacy and limits

Recognition runs locally, with no analytics or remote lookup requests. Clicking a globe link opens Google Maps with the detected address. Only extension preferences and matching rules are stored. CopyEmail writes to the clipboard when you click a copy icon; it never reads the clipboard or stores email addresses.

A shortened address can be copied in full only if the page exposes the complete value. Editable fields, image text, and Chrome's protected pages are not supported.

## Development

Requires Node.js and Google Chrome. The extension uses Manifest V3 and has no runtime dependencies.

```sh
npm ci
npx playwright install chromium
npm test
npm run check
```

## Address lookup

The enabled Addresses rule contains ten format families covering US/UK, European,
Japanese, Chinese, Korean, Indian and Singaporean address layouts.
See [address format coverage and sources](docs/address-formats.md) for examples and limits. A copy button followed by a globe appears beside each match. The globe opens Google Maps
in a new tab. The address rule’s **Maps** action is on
by default; turn it off to keep only the copy button. Compact city/country labels in up to five ancestors enrich the query;
nearest labels win, ambiguous labels are omitted, and already-present names are
not appended again. Missing context is left out; this is pattern recognition,
not postal-address verification or geocoding. Unrecognized formats can use a custom regex.

Custom rules require a name and one or more regexes, entered one per line.
The regexes are matched with OR semantics; overlapping alternatives produce one
match, preferring the longer one. Existing single-regex settings migrate automatically.
The address rule’s **Copy** and **Maps** checkboxes control their actions independently.
Both on shows Copy then Globe; either can be used alone, and both off hides both.
Address context lookup remains built in and checks up to five parent levels.

`extension/data/cities.txt` contains 347,334 lowercase, unique, sorted names from
34,205 GeoNames cities15000 records, including alternate names and translations.
It loads once per page/frame when an address needs context, and is reused on rescans. Country names are generated
once per frame using browser translations and kept in a sorted-insertion Set.
See `extension/data/README.md` for attribution, licensing and regeneration.

## Architecture

The content-script composition root is [`bootstrap.js`](extension/bootstrap.js). It creates
`Settings`, injects it and the geography provider into `Scanner`, then passes settings,
scanner, and services to `PageAugmenter`. The manifest loads these plain scripts in
dependency order; no module loader or build step is required.

| Component | Responsibility | Dependencies |
| --- | --- | --- |
| [`Settings`](extension/settings.js) | Normalize and migrate preferences, persist changes, publish immutable snapshots and revisions | Storage and storage-change events |
| [`Scanner`](extension/scanner.js) | Traverse text and metadata, compile enabled rules when the settings revision changes, return detections with DOM ranges | Settings, pattern classes, injected geography provider |
| [`Pattern`](extension/patterns.js) | Match text; resolve the full value after the scanner locates an accepted match | Regex/OR composition; AddressPattern optionally uses geography and a parent pattern |
| [`ServiceCollection`](extension/services.js) | Convert a detection into Copy or Google Maps commands without executing them | Action and builtin-rule types |
| [`PageAugmenter`](extension/content.js) | Observe the page, render and position controls, execute clipboard actions, and manage DOM changes | Settings, Scanner, ServiceCollection |

Rules contain `id`, `name`, `possibleActions`, `enabledActions`, `builtinType`, and
`patterns`. A compiled rule keeps the rule, its nonempty enabled-action list, and
its composed pattern. A detection contains `{ location: { element, range }, rule, value }`;
a command contains `{ action, value }`. Legacy preferences are accepted only at the
settings boundary; runtime consumers use the modern rule model.

Patterns return text offsets from `matches({ text })`. Their `valueFor(finding, context)`
step resolves the final value once Scanner knows its DOM location. AddressPattern owns
parent-context lookup and lazy geography loading, independent of enabled actions.
Scanner publishes invalidation when asynchronous context becomes available. Its
per-scan callbacks exclude page-owned controls and report shadow roots; PageAugmenter
owns their observation. Scanner and patterns never modify the page.

`PageAugmenter.start()` loads settings and starts subscriptions and page listeners.
`dispose()` releases its subscriptions, listeners, observers, timers, controls, and
spacers. Injected dependencies remain owned by the caller. Popup and options views
use the same Settings model, with mutable editing drafts separate from its snapshots.
