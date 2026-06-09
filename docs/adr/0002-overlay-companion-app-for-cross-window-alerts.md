# Use a separate companion app for alerts outside the Discord window

A Vencord plugin runs in Discord's renderer and can only draw inside the Discord
window — it cannot create a transparent, always-on-top, click-through overlay over
other apps or a chosen monitor. To show the Alert banner on a monitor the Operator
picks, we ship a **separate Electron companion app** that owns the Overlay window. The
plugin detects the Qualifying Message and forwards the Alert to the companion over a
**localhost HTTP** call made from the plugin's `native.ts` (main process) — the
renderer can't reach `http://localhost` because Discord's CSP blocks it.

## Considered alternatives

- **Renderer `fetch`/WebSocket to localhost** — blocked by Discord's CSP. Rejected;
  the native (main-process) call is why `native.ts` exists.
- **Spawning an overlay window from the plugin** — Vencord's plugin/native APIs don't
  expose `BrowserWindow`, so a plugin cannot create the overlay itself.

## Consequences

- The Operator must run a second app alongside Discord.
- The Overlay will not appear over games running in **exclusive** fullscreen (same
  limitation as Discord's own game overlay); borderless/windowed fullscreen works.
- Sound and TTS still play from the plugin; only the visual banner is forwarded.
