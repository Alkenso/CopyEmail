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

Open CopyEmail's **Options** from Chrome's extensions menu.

- **All sites except…** — enabled everywhere except websites in the list.
- **Only these sites** — enabled only on websites in the list.

Enter one hostname pattern per line, without `https://`, paths, or ports. Matching ignores case. Only two wildcards are supported:

- `*` matches zero or more characters.
- `?` matches exactly one character.

For example, `example.com` matches that website, while `*.example.com` matches its subdomains. Add both to cover both. Click **Save settings** to apply changes immediately to open tabs.

The third tab, **Settings**, includes **Ignore hover hints**. It is enabled by default and skips copy icons in detected tooltips and temporary hints shown on hover. Change it and click **Save Settings** to apply your preference.

## Privacy and limits

Recognition runs locally, with no analytics or remote lookup requests. Clicking a globe link opens Google Maps with the detected address. Only website settings are stored. CopyEmail writes to the clipboard when you click a copy icon; it never reads the clipboard or stores email addresses.

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
in a new tab. The Settings tab’s **Google Maps links for addresses** checkbox is on
by default; turn it off to keep only the copy button. Compact city/country labels in up to five ancestors enrich the query;
nearest labels win, ambiguous labels are omitted, and already-present names are
not appended again. Missing context is left out; this is pattern recognition,
not postal-address verification or geocoding. Unrecognized formats can use a custom regex.

Custom rules require a name and one or more regexes, entered one per line.
The regexes are matched with OR semantics; overlapping alternatives produce one
match, preferring the longer one. Existing single-regex settings migrate automatically.
The **Addresses** checkbox in Patterns controls address copy buttons only.
**Google Maps links for addresses** in Settings controls globe links independently.
Both on shows Copy then Globe; either can be used alone, and both off hides both.
Address context lookup remains built in and checks up to five parent levels.

`extension/data/cities.txt` contains 347,334 lowercase, unique, sorted names from
34,205 GeoNames cities15000 records, including alternate names and translations.
It loads once per page/frame when an address needs context, and is reused on rescans. Country names are generated
once per frame using browser translations and kept in a sorted-insertion Set.
See `extension/data/README.md` for attribution, licensing and regeneration.
