# Crafty Atelier

An unofficial, Crafty+-focused fork of [Reactive Volcano App](https://github.com/firsttris/reactive-volcano-app), with additional battery tools, automatic connection on Android and customizable appearance.

**[Open Crafty Atelier](https://finalize721.github.io/phoenix-crafty/)** · [Deutsch](README_de.md) · [Original project](https://github.com/firsttris/reactive-volcano-app)

[![GitHub Pages](https://github.com/Finalize721/phoenix-crafty/actions/workflows/pages.yml/badge.svg?branch=main)](https://github.com/Finalize721/phoenix-crafty/actions/workflows/pages.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)

## What's different from upstream?

| Feature | Description |
|---|---|
| Android auto-connect | Automatically attempts to connect to the last authorized device when the app starts in Android Chrome. Retrying the known device is preferred over opening the chooser again. |
| Charging ETA | Estimated remaining time and completion time to 99%, using locally recorded battery history and live observations. Historical preview is also available when charging is unconfirmed. |
| Battery diagnostics | Export battery observations, prediction traces and estimator diagnostics as JSON for troubleshooting. |
| Charge notification | Browser notification at 99% when supported and authorized. |
| Low-battery actions | Enable an experimental Crafty+ locate-signal warning and automatic heater shutdown at a configurable battery threshold (1–99%, default 15%). Both are off by default. |
| Experimental session extension | Opt-in, bounded attempts to reset the supported five-minute auto-off timer (15, 30, 45 or 60 minutes), with timer readback checks. |
| Appearance | Three color palettes, custom base/accent colors, persistent light/dark mode and updated startup artwork/icons. |
| History & reliability | Configurable history retention, fresh Bluetooth telemetry on returning to the foreground, and more detailed charging observation checks. |

The fork builds on upstream's existing device controls, session history, remembered-device support and automatic reconnection after a dropped connection. It is primarily developed and exercised with Crafty+; other upstream-supported devices have not been independently validated for this fork.

## Getting started

1. Open [Crafty Atelier](https://finalize721.github.io/phoenix-crafty/) in Chrome on Android.
2. Switch on the Crafty+ and ensure another app or phone is not already connected.
3. Select the device in the browser's Bluetooth chooser on your first connection.
4. Optionally install the PWA from the browser menu. The app can start offline once its assets are cached.

### Remembering the device across app restarts

If Chrome repeatedly asks you to select the same device, open:

`chrome://flags/#enable-web-bluetooth-new-permissions-backend`

Enable **Use the new permissions backend for Web Bluetooth**, if the flag exists in your browser version, restart Chrome and authorize your device again. This has worked on the maintainer's Android device. Availability depends on the browser/version.

The app remembers the device ID locally, then uses `navigator.bluetooth.getDevices()` to retrieve the browser-authorized device. The permission itself is controlled by Chrome. Automatic connection requires the device to be reachable and cannot bypass browser permissions.

## Battery and session features

- **Charging ETA:** estimates are experimental, not a guarantee of actual completion time. The app infers charging from observed battery changes; it does not have a confirmed charger-connected signal. Missing or delayed Bluetooth data can affect predictions.
- **Low-battery actions:** in Crafty+ settings, choose the threshold and enable either action. A downward threshold crossing during an active heating session triggers the enabled actions once the target temperature has been reached and fresh device readings have been checked. Changing the threshold rearms detection without immediately triggering an action. An intentional restart below the threshold is not automatically shut down again. The optional experimental device warning requests the existing locate signal once, not phone vibration. Its duration, vibration pattern and effect on heating depend on firmware and have not been verified on hardware; it may interrupt heating. The former phone-warning preference is not automatically migrated.
- **Session extension:** requires an active heater, target temperature reached, a 300-second device timeout and a visible app. It attempts to reapply that timeout every 30 seconds, stopping on failed readback, loss of eligibility, disconnect, backgrounding or timeout. Whether the firmware accepts a reset must be confirmed on the device. It never turns the heater on automatically; stopping leaves the normal device timer running.

All automatic actions are app-side and require a running app and active Bluetooth connection. Android can suspend or terminate the browser in the background. Do not rely on these features as safety mechanisms or leave the device unattended.

Battery history and preferences are stored in the browser. The diagnostic export is local and can contain device identifiers and timestamps; review it before sharing.

## Development

Requires [Bun](https://bun.sh/) (see `packageManager` in package.json).

```bash
git clone https://github.com/Finalize721/phoenix-crafty.git
cd phoenix-crafty
bun install --frozen-lockfile
bun run dev
```

```bash
bun run test
bun run build
```

Pull requests run automated tests and a production build; pushes to main publish the app to GitHub Pages.

*Development note: All fork-specific changes have been developed through chat-driven AI assistance ("vibe coding"), without independent human code review. Automated tests, AI-assisted checks and occasional hands-on testing are not a substitute for human review or comprehensive hardware validation. Treat the additions as experimental.*

## Upstream and license

Crafty Atelier is based on [Reactive Volcano App](https://github.com/firsttris/reactive-volcano-app) by Tristan Teufel and contributors. See the [original README](https://github.com/firsttris/reactive-volcano-app#readme) and [upstream documentation](https://firsttris.github.io/reactive-volcano-app/docs/) for the broader device feature matrix, platform support, self-hosting and protocol details. Those resources describe upstream, not necessarily every fork-specific feature.

Licensed under [AGPL-3.0](LICENSE); original copyright and license retained. This is an independent, unofficial project, not affiliated with or endorsed by Storz & Bickel GmbH. CRAFTY, VOLCANO, VENTY, VEAZY and STORZ & BICKEL are trademarks of their respective owner. Provided as is, without warranty. Use at your own risk.
