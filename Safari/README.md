# CopyEmail for Safari

The Xcode project contains SwiftUI macOS and iOS/iPadOS apps and a Safari Web
Extension target for each platform. The apps provide setup steps, usage guidance,
and expandable troubleshooting. The macOS app also checks the extension's status
and opens Safari's extension settings. Both apps use the SwiftUI app lifecycle;
there are no wrapper web views, HTML resources, delegates, or storyboards.

## Open and build

Use **Xcode 27.2 or newer**. The project uses Xcode 27.2's JSON-based
`project.xcproj` format, not the legacy `project.pbxproj` format.

From the repository root:

```sh
open Safari/CopyEmail/CopyEmail.xcodeproj
```

Choose `CopyEmail (macOS)` with **My Mac**, or `CopyEmail (iOS)` with an iPhone
or iPad Simulator. Deployment targets are macOS 15.6 and iOS/iPadOS 18.5 for
both the containing apps and their extensions.

Unsigned build checks, without a development team:

```sh
xcodebuild -project Safari/CopyEmail/CopyEmail.xcodeproj \
    -scheme 'CopyEmail (macOS)' -configuration Debug \
    -destination 'generic/platform=macOS' \
    -derivedDataPath /tmp/CopyEmail-Safari-macOS \
    CODE_SIGNING_ALLOWED=NO build

xcodebuild -project Safari/CopyEmail/CopyEmail.xcodeproj \
    -scheme 'CopyEmail (iOS)' -configuration Debug \
    -destination 'generic/platform=iOS Simulator' \
    -derivedDataPath /tmp/CopyEmail-Safari-iOS \
    CODE_SIGNING_ALLOWED=NO build
```

The app bundle identifier is `dev.alkenso.CopyEmail` on both platforms; the
extension identifier is `dev.alkenso.CopyEmail.Extension`. All four targets use
marketing version `1.3.0`, matching `extension/manifest.json`, and build number
`1`. When releasing a new version, update the manifest and all four native
targets together.

## Signing and enabling

The project leaves the development team unset. For a signed run, select your
team under **Signing & Capabilities** for both the app and extension targets of
the chosen platform. Keep automatic signing enabled. Device installation needs
a valid development certificate and provisioning profiles; distribution needs
the appropriate signing setup. App Store submission is outside this project setup.

For a local command-line device build, keep the project portable by supplying
`DEVELOPMENT_TEAM=YOUR_TEAM_ID` and `-allowProvisioningUpdates` to `xcodebuild`
instead of saving a team in the project. Select the device with
`-destination 'id=YOUR_DEVICE_UDID'` and omit `CODE_SIGNING_ALLOWED=NO`.

### macOS

1. Build and run the containing app.
2. Click **Quit and Open Safari Settings…**. In Safari Settings → Extensions,
   enable CopyEmail and grant access to the websites you want to use.
3. Refresh existing tabs, then open CopyEmail from Safari's toolbar.

For local extension testing, Safari may require **Allow unsigned extensions**.
In Safari 26.5 this is under **Safari Settings → Developer**; older Safari
versions expose it in the Develop menu. To expose developer controls, use Safari
Settings → Advanced → Show features for web developers. Authentication and
extension activation may require a physical click: Safari can reject automated
activation. This is a local testing setting, not a substitute for signing a
distributed app. An unsigned build succeeding does not prove activation.

In the macOS 26.5.1 test VM, an ad-hoc-signed app was registered but Safari did
not list its extension, even with unsigned extensions allowed. An Apple
Development signature worked. A portable command-line build can supply the
team without saving it in the project:

```sh
xcodebuild -project Safari/CopyEmail/CopyEmail.xcodeproj \
    -scheme 'CopyEmail (macOS)' -configuration Debug \
    -destination 'generic/platform=macOS' \
    -derivedDataPath /tmp/CopyEmail-Safari-signed \
    DEVELOPMENT_TEAM=YOUR_TEAM_ID CODE_SIGN_IDENTITY='Apple Development' build
```

Run the resulting containing app before enabling or testing the extension.

### iOS and iPadOS

1. Run the iOS scheme on a Simulator or a connected device with Developer Mode
   enabled and the required signing setup.
2. Open Settings → Apps → Safari → Extensions → CopyEmail and enable it.
3. In Safari, use the page menu → Manage Extensions as needed, and grant website
   access to CopyEmail. Open the extension from the page menu to reach its popup.
4. Refresh the page after enabling the extension or changing website access.

CopyEmail's own website filters further restrict Safari's permissions; they
cannot grant access that Safari has denied.

## Shared extension resources

`../extension/` is the only source for the browser extension's JavaScript, HTML,
CSS, manifest, icons, and city data. Both native extension targets reference it
using repository-relative paths. The `data` and `icons` directory references
preserve their layout, including `data/cities.txt`. No extension source tree is
copied into `Safari/`.

Edit the original files and rebuild the selected scheme. If adding a new
top-level file, add its existing file reference to both extension targets'
Resources phases. New files inside the referenced `data` and `icons` folders
are included with those folders. Chrome still loads `extension/` directly.

Native app artwork was produced by Apple's converter from the existing
extension icon. The shared asset catalog supplies the app icons and SwiftUI
header artwork; the extension's HTML, CSS, and JavaScript stay in `extension/`.

The starting project was generated from the repository root with:

```sh
xcrun safari-web-extension-converter extension \
    --project-location Safari \
    --app-name CopyEmail \
    --bundle-identifier dev.alkenso.CopyEmail \
    --swift --no-open --no-prompt
```

`--copy-resources` is deliberately omitted. See Apple's
[packaging documentation](https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari).
Do not regenerate over this project without preserving deployment targets,
versions, and wrapper instruction changes.

## Safari compatibility and verification

### SwiftUI wrapper verification (2026-11-13)

- The development-signed iOS app built, installed, and launched on
  **iPhone AlkTest 18.5** (iPhone 12 Pro Max).
- A temporary XCTest UI runner passed its combined wrapper test with zero
  failures: native setup content, no web views, scrolling, troubleshooting
  expansion/collapse, and landscape rotation. Device screenshots were inspected.
- Source, project, and built-bundle checks confirmed removal of legacy wrapper
  resources and storyboard configuration. Signing settings remain portable;
  the development team used for verification is not saved in the project.
- macOS was not built or tested in this change. Safari extension behavior was
  not retested; these checks cover the containing app's SwiftUI interface.

### Browser compatibility

The Xcode 27.2 converter warns that `match_about_blank` and
`match_origin_as_fallback` are unsupported. These manifest keys remain in the
shared manifest for Chrome. Safari may therefore omit matching in `about:blank`
and origin-fallback frames. Regular HTTP/HTTPS content-script matching still
uses the shared manifest. Do not assume Safari supports `file:` pages or other
protected pages merely because Chrome accepts the manifest's match patterns.

The existing browser API paths use `chrome.storage.local`,
`chrome.storage.onChanged`, `chrome.runtime.getURL`,
`chrome.runtime.openOptionsPage`, and `chrome.tabs.create`; copying uses the
Clipboard API with an `execCommand('copy')` fallback. No Safari-specific
JavaScript fork has been introduced. Build/resource verification alone does
not validate those APIs at runtime.

Run the existing JavaScript checks from the repository root:

```sh
npm ci
npx playwright install chromium
npm run check
npm test
```

The built extension resource roots for the commands above are:

- macOS: `/tmp/CopyEmail-Safari-macOS/Build/Products/Debug/CopyEmail.app/Contents/PlugIns/CopyEmail Extension.appex/Contents/Resources/`
- iOS Simulator: `/tmp/CopyEmail-Safari-iOS/Build/Products/Debug-iphonesimulator/CopyEmail.app/PlugIns/CopyEmail Extension.appex/`

For each platform, compare all files under `extension/` with the corresponding
bundle paths, especially `manifest.json`, the content scripts, popup/options
assets, `icons/`, and `data/cities.txt`. To check rebuild propagation, temporarily
add a harmless CSS comment to `extension/popup.css`, rebuild both schemes,
confirm the comment reaches both bundles, then restore the file and rebuild.

Before release, smoke-test each platform in Safari:

- Enable the extension, grant access, and verify behavior on an allowed site.
- Copy an email and paste it to verify the full value.
- Use address Copy and Maps, including city/country enrichment.
- Open the popup, settings, and new-category editor.
- Save preferences, reload pages, and reopen Safari to confirm persistence.
- Select System, Light, and Dark appearance and confirm popup/settings changes.
- Add or change page content dynamically and verify controls update.
- Check normal frames separately from the unsupported fallback-frame cases.

Record native build results separately from actual Safari runtime results,
including device OS, signing, permission, and simulator limitations.

### Initial verification (2026-11-08)

- Xcode 27.2 unsigned Debug builds passed for macOS and iOS Simulator. An
  unsigned Release iOS Simulator build also passed.
- All 21 shared resource files matched the built macOS, Simulator, and signed
  device extension bundles byte-for-byte. A temporary CSS edit propagated to
  both platform bundles on rebuild; the source was restored and rebuilt.
- `npm run check` passed; the existing Chrome regression suite passed all 101 tests.
- A development-signed build was installed and launched on an iPhone 12 Pro Max
  running iOS 18.5. A device screenshot confirmed the artwork and enabling
  instructions. The development team was supplied only on the build command.
- Safari on iOS 27.2 Simulator enabled CopyEmail, granted access to a local test
  website, displayed the popup categories and default settings, and
  rendered inline email Copy and address Copy/Maps controls.
- Follow-up XCTest UI checks ran in real Safari on the iOS 18.5 iPhone; the final
  combined run passed all four tests with zero failures. They
  verified website access, popup loading, email copying by pasting the exact
  value, copying dynamically inserted email text, and copying an address
  enriched with a city from its parent section (`10 Downing Street, London`).
- The Maps action launched the installed Google Maps app with that query and
  displayed the Downing Street result. Popup → settings and Add custom category
  → editor navigation worked. Saving an action preference survived terminating
  and reopening Safari; a popup toggle updated controls on an already-open page.
- Dark, Light, and System appearance each saved and survived a Safari restart.
  Screenshots confirmed the popup's dark and light rendering. Tests restored
  the original action defaults and System appearance afterward.
- These device checks used a local HTTP fixture and a temporary, separately
  signed XCTest runner. They do not establish coverage of every website,
  HTTPS-only clipboard behavior, frames, private browsing, iPad layouts, or
  other iOS versions.

### macOS Safari runtime verification (2026-11-08)

Tested Safari 26.5 on macOS 26.5.1 in the VM, using `vm-computer` for GUI
interaction and SSH for deployment. The app was built with an Apple Development
signature; the team remains unset in the project. The user authenticated the
unsigned-extension setting and manually enabled CopyEmail, then website access
was granted only to the local HTTP fixture at `127.0.0.1`.

- The containing app loaded its instructions and opened Safari's extension
  settings. The enabled extension displayed inline email and address controls.
- Email copying, dynamically inserted email copying, and enriched address
  copying passed by pasting the exact values into a textarea. The address was
  `10 Downing Street, London`.
- Maps opened a new Safari tab with the enriched query and displayed the correct
  Downing Street result in Google Maps.
- The popup, Categories/Websites/General settings, and Add custom category
  editor opened. The editor was cancelled without creating a category.
- Disabling Email Copy in the popup removed controls from the already-open page.
  The preference survived quitting and reopening Safari; re-enabling it in
  settings and saving also survived a restart.
- Light and Dark preferences survived Safari restarts. Popup colors were
  correct. Testing found that the settings page resolved CSS `light-dark()` to
  the system's dark colors even with computed `color-scheme: light`. Explicit
  Light/Dark palette overrides in the shared `options.css` fixed this without
  changing the palette or System behavior. The rebuilt app rendered both modes
  correctly; a previously failing background-color assertion passed with
  `rgb(248, 250, 252)` in Light mode. Original actions and System appearance were
  restored afterward.
- After the CSS fix, `npm run check` and all 101 Chrome regression tests passed.
  Unsigned macOS, development-signed macOS, and unsigned iOS Simulator Debug
  builds passed. All 21 shared files matched those bundles and the VM-installed
  app byte-for-byte.

These are fixture-based runtime checks, not coverage of every website, frames,
private browsing, or older macOS versions. The VM used a dark system appearance;
live OS appearance switching was not tested. The earlier iPhone checks predate
the CSS fix; its final iOS Simulator build was verified, but the updated CSS was
not retested on the physical iPhone during this macOS session.
