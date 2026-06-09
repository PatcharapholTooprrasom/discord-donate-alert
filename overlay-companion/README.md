# Donation Alert — Overlay Companion

A tiny Electron app that shows the DonationAlert banner on a **monitor you choose**, as
a transparent, always-on-top, click-through overlay. The Vencord plugin forwards alerts
to it over `localhost`.

Why a separate app? A Vencord plugin can only draw inside the Discord window — it can't
make an overlay over your games/desktop. See
[`../docs/adr/0002-overlay-companion-app-for-cross-window-alerts.md`](../docs/adr/0002-overlay-companion-app-for-cross-window-alerts.md).

## Run it

```powershell
pnpm --dir "D:\code\discordDonation\overlay-companion" start
```

(Electron is already installed.) A small **control window** opens:

- **Monitor** — click the monitor you want the overlay on. It moves immediately.
- **Click-through** — leave on so the overlay never blocks clicks on your game.
- **Port** — must match the plugin's *Overlay port* setting (default **2387**).
- **Test alert** — fires a banner straight to the overlay (doesn't involve Discord).
- **Quit overlay** — stops the app. *Closing the control window leaves the overlay
  running.*

## Connect the plugin to it

In Discord → **Settings → Vencord → Plugins → DonationAlert** (cog):

1. Turn on **"Also send the alert to the Overlay Companion app."**
2. Set **Overlay port** to match the companion (default 2387).
3. Optionally turn off **"Show the banner inside the Discord window"** so the banner
   only appears on your chosen monitor.

Then click **Trigger test alert** in the plugin settings — it should appear on the
overlay monitor (this exercises the full path: plugin → main process → companion).

## Notes & limits

- **Exclusive-fullscreen games** won't show the overlay (same as Discord's own overlay).
  Use *borderless* / *windowed fullscreen* in the game's video settings.
- Sound and TTS still play from Discord; the companion only draws the banner.
- The overlay is click-through and never takes focus, so it can't be interacted with —
  use the control window for everything.

## Auto-start with Windows (optional)

Create a shortcut that runs the start command, and drop it in
`shell:startup` (Win+R → `shell:startup`). Point the shortcut target at:

```
powershell -WindowStyle Hidden -Command "pnpm --dir 'D:\code\discordDonation\overlay-companion' start"
```
