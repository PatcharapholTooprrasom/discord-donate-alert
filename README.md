# DonationAlert — Vencord userplugin

Turns **1-on-1 DMs from chosen people** into Twitch-style "donation" alerts:

- an animated banner slides in over Discord,
- an alert **sound** plays (your own file),
- the message is read aloud with **text-to-speech**.

Alerts queue one-at-a-time during bursts, long messages are truncated for TTS, and
the queue is capped so a spammer can't flood you.

The design decisions behind this live in [`CONTEXT.md`](./CONTEXT.md) and
[`docs/adr/`](./docs/adr).

---

## What this is (and isn't)

Vencord userplugins are **not** drag-and-drop `.zip` files. They are TypeScript that
must be compiled into Vencord. That means you build Vencord **from source** once, drop
this plugin into it, and inject the build into your Discord. After that, updating the
plugin is just an edit + rebuild.

> If you're on the normal "Vencord installer" build, you'll be replacing it with this
> dev build. That's expected and reversible (`pnpm uninject` restores stock Discord).

---

## 1. Install the prerequisites

You need **Git**, **Node.js (v18+)**, and **pnpm**.

```powershell
# Check what you already have
node --version
git --version

# Install Node from https://nodejs.org if missing, then enable pnpm:
corepack enable
corepack prepare pnpm@latest --activate
pnpm --version
```

## 2. Clone and set up Vencord

```powershell
cd $HOME
git clone https://github.com/Vendicated/Vencord
cd Vencord
pnpm install
```

## 3. Add this plugin

Vencord loads private plugins from `src/userplugins`. Copy the **`DonationAlert`
folder** (the one containing `index.tsx`) into there:

```
Vencord/
└── src/
    └── userplugins/
        └── DonationAlert/
            └── index.tsx
```

PowerShell, assuming this repo is at `D:\code\discordDonation`:

```powershell
New-Item -ItemType Directory -Force "$HOME\Vencord\src\userplugins" | Out-Null
Copy-Item -Recurse -Force "D:\code\discordDonation\DonationAlert" "$HOME\Vencord\src\userplugins\DonationAlert"
```

## 4. Build and inject

Fully close Discord first (quit from the tray, not just the window).

```powershell
cd $HOME\Vencord
pnpm build
pnpm inject
```

`pnpm inject` will ask which Discord install to patch (Stable / PTB / Canary). Pick
yours, then start Discord again.

## 5. Enable & configure

1. Discord → **Settings → Vencord → Plugins**.
2. Find **DonationAlert**, toggle it on, and open its settings (cog).
3. Fill in:
   - **Watched user IDs** — comma/space separated. (Enable Discord *Developer Mode*
     under Settings → Advanced, then right-click a user → **Copy User ID**.)
   - **Alert sound** — click *Choose sound file…* and pick a short audio clip.
   - **TTS engine / online voice** — Online (natural Google voices, incl. Thai auto-detection) or Offline (system voices), plus rate/volume.
4. Click **Trigger test alert** to preview everything without waiting for a real DM.

## Updating the plugin later

Edit `src/userplugins/DonationAlert/index.tsx`, then:

```powershell
cd $HOME\Vencord
pnpm build
```

Reload Discord with **Ctrl+R** (or fully restart). No need to re-inject.

## Uninstalling

```powershell
cd $HOME\Vencord
pnpm uninject   # restores stock Discord
```

---

## Settings reference

| Setting | What it does |
|---|---|
| Watched user IDs | Who triggers alerts. Only their **1-on-1 DMs** count. |
| Read message aloud | Toggle TTS on/off. |
| TTS rate / volume | Speed and loudness of the spoken voice. |
| Max characters read aloud | Truncates long messages **for TTS only** (banner shows more). |
| Alert sound volume | Loudness of the chime. |
| Banner duration | How long the banner stays (waits for TTS if TTS is longer). |
| Queue cap | Max queued alerts; extras during a flood are dropped. |
| Alert sound | Pick a local audio file (stored inside settings — keep it short). |
| TTS engine | **Online** = natural Google voices (needs internet; sends the message text to Google). **Offline** = your robotic system voices. |
| Online voice | Default online language: English (US/UK/AU) or Thai. **Thai text is auto-detected and always spoken in Thai**, whatever this is set to. |
| TTS voice (offline) | Choose from your installed OS voices (used only in Offline mode). |
| Trigger test alert | Fire a sample alert to tune things. |

## Notes & limitations

- The banner is drawn **inside the Discord window**, so it's only visible while Discord
  is open/visible. The **sound and TTS still play** even when Discord is minimized,
  because the renderer keeps running.
- Only **1-on-1 DMs** trigger alerts — not group DMs, not server messages, and never
  your own messages. (This is deliberate; see `CONTEXT.md`.)
- Image/sticker/link-only messages still show a banner + sound; TTS says
  "sent an attachment" or is skipped if there's truly nothing to read.
- The alert sound is stored as a base64 data URL inside the plugin settings (Discord's
  CSP blocks loading raw `file://` paths). Use a short clip; see
  [ADR-0001](./docs/adr/0001-embed-alert-sound-as-data-url.md).
