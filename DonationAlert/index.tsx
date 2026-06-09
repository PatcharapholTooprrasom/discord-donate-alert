/*
 * DonationAlert — a Vencord userplugin
 *
 * Turns 1-on-1 DMs from chosen people into Twitch-style "donation" alerts:
 * an animated on-screen banner, an alert sound, and a text-to-speech reading.
 *
 * See CONTEXT.md and docs/adr/ in the repo for the design decisions behind this.
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import type { PluginNative } from "@utils/types";
import { Button, ChannelStore, Forms, React, UserStore } from "@webpack/common";

// Runs in the main process (see native.ts) — used to POST alerts to the Overlay
// Companion app over localhost, which bypasses Discord's renderer CSP.
const Native = VencordNative.pluginHelpers.DonationAlert as PluginNative<typeof import("./native")>;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const settings = definePluginSettings({
    watchedUserIds: {
        type: OptionType.STRING,
        description: "User IDs to watch, separated by commas or spaces. A 1-on-1 DM from any of these users triggers an alert.",
        default: "",
        placeholder: "123456789012345678, 987654321098765432"
    },
    ttsEnabled: {
        type: OptionType.BOOLEAN,
        description: "Read the message aloud with text-to-speech.",
        default: true
    },
    ttsEngine: {
        type: OptionType.SELECT,
        description: "Online = natural voices via Google TTS (needs internet, sends the message text to Google). Offline = your robotic system voices.",
        options: [
            { label: "Online natural voice (recommended)", value: "online", default: true },
            { label: "Offline system voice (robotic)", value: "offline" }
        ]
    },
    onlineVoice: {
        type: OptionType.SELECT,
        description: "Online language/voice (Google TTS). Pick 'ไทย Thai' to read EVERYTHING (including English text) with a Thai accent. Thai text is always spoken in Thai regardless of this setting.",
        options: [
            { label: "ไทย Thai — reads all text with a Thai accent", value: "th", default: true },
            { label: "English (US) — natural female", value: "en" },
            { label: "English (UK)", value: "en-GB" },
            { label: "English (AU)", value: "en-AU" }
        ]
    },
    ttsRate: {
        type: OptionType.SLIDER,
        description: "Reading speed (applies to both online and offline voices; 1 = normal).",
        markers: [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2],
        default: 1
    },
    ttsMaxSeconds: {
        type: OptionType.SLIDER,
        description: "Maximum time (seconds) to read a single message aloud. Reading is cut off after this.",
        markers: [3, 5, 8, 10, 15, 20, 30],
        default: 10,
        stickToMarkers: true
    },
    ttsVolume: {
        type: OptionType.SLIDER,
        description: "TTS volume.",
        markers: [0, 0.25, 0.5, 0.75, 1],
        default: 1
    },
    ttsMaxChars: {
        type: OptionType.SLIDER,
        description: "Max characters read aloud (longer messages are truncated for TTS only).",
        markers: [50, 100, 150, 200, 300, 500],
        default: 200,
        stickToMarkers: true
    },
    soundVolume: {
        type: OptionType.SLIDER,
        description: "Alert sound volume.",
        markers: [0, 0.25, 0.5, 0.75, 1],
        default: 0.7
    },
    bannerDurationSec: {
        type: OptionType.SLIDER,
        description: "How long the banner stays on screen (seconds). If TTS is longer, the banner waits for it.",
        markers: [3, 4, 5, 6, 8, 10],
        default: 6,
        stickToMarkers: true
    },
    queueCap: {
        type: OptionType.SLIDER,
        description: "Max number of alerts queued at once. Extra messages during a flood are dropped.",
        markers: [1, 3, 5, 10],
        default: 5,
        stickToMarkers: true
    },
    bannerStyle: {
        type: OptionType.SELECT,
        description: "Outline = bold text with a colored outline, no box (best over gameplay). Card = gradient box with avatar.",
        options: [
            { label: "Outline text (over gameplay)", value: "outline", default: true },
            { label: "Card (gradient box + avatar)", value: "card" }
        ]
    },
    showInDiscordBanner: {
        type: OptionType.BOOLEAN,
        description: "Show the banner inside the Discord window.",
        default: true
    },
    forwardToOverlay: {
        type: OptionType.BOOLEAN,
        description: "Also send the alert to the Overlay Companion app (shows the banner on a monitor you pick). Requires the companion app to be running.",
        default: false
    },
    overlayPort: {
        type: OptionType.NUMBER,
        description: "Localhost port the Overlay Companion listens on (must match the companion's port).",
        default: 2387
    },

    // ---- Persisted-but-not-rendered values (driven by the components below) ----
    selectedVoiceURI: { type: OptionType.CUSTOM, default: "" },
    soundDataUrl: { type: OptionType.CUSTOM, default: "" },
    soundFileName: { type: OptionType.CUSTOM, default: "" },
    bannerColor1: { type: OptionType.CUSTOM, default: "#5865f2" },
    bannerColor2: { type: OptionType.CUSTOM, default: "#9b59ff" },
    bannerTextColor: { type: OptionType.CUSTOM, default: "#ffffff" },
    bannerOutlineColor: { type: OptionType.CUSTOM, default: "#ff36c4" },

    // ---- Custom UI ----
    sound: {
        type: OptionType.COMPONENT,
        component: () => <SoundPicker />
    },
    voice: {
        type: OptionType.COMPONENT,
        component: () => <VoicePicker />
    },
    colors: {
        type: OptionType.COMPONENT,
        component: () => <ColorPicker />
    },
    test: {
        type: OptionType.COMPONENT,
        component: () => (
            <div>
                <Forms.FormTitle tag="h5">Test</Forms.FormTitle>
                <Forms.FormText style={{ marginBottom: 8 }}>
                    Fire a sample alert to tune the sound, voice, rate and volume.
                </Forms.FormText>
                <Button onClick={triggerTestAlert}>Trigger test alert</Button>
            </div>
        )
    }
});

// ---------------------------------------------------------------------------
// Watched-user parsing
// ---------------------------------------------------------------------------

function parseWatchedIds(): Set<string> {
    return new Set(
        (settings.store.watchedUserIds || "")
            .split(/[\s,]+/)
            .map(s => s.trim())
            .filter(s => /^\d+$/.test(s))
    );
}

// ---------------------------------------------------------------------------
// Avatar + text helpers
// ---------------------------------------------------------------------------

function avatarUrl(author: any): string {
    if (author?.avatar) {
        const ext = String(author.avatar).startsWith("a_") ? "gif" : "png";
        return `https://cdn.discordapp.com/avatars/${author.id}/${author.avatar}.${ext}?size=128`;
    }
    let idx = 0;
    try {
        if (author?.discriminator && author.discriminator !== "0") {
            idx = Number(author.discriminator) % 5;
        } else {
            idx = Number((BigInt(author.id) >> 22n) % 6n);
        }
    } catch {
        idx = 0;
    }
    return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
}

function displayName(author: any): string {
    return author?.global_name || author?.globalName || author?.username || "Someone";
}

/** Cleaned, length-capped text suitable for speaking. Returns "" when nothing should be read. */
function buildTtsText(message: any): string {
    let text = String(message?.content || "");
    text = text
        .replace(/<a?:(\w+):\d+>/g, " $1 ")   // custom emoji -> its name
        .replace(/<@!?\d+>/g, " ")             // user mention
        .replace(/<@&\d+>/g, " ")              // role mention
        .replace(/<#\d+>/g, " ")               // channel mention
        .replace(/https?:\/\/\S+/gi, " ")      // urls
        .replace(/\s+/g, " ")
        .trim();

    if (!text) {
        const hasMedia =
            message?.attachments?.length ||
            message?.sticker_items?.length ||
            message?.stickerItems?.length ||
            message?.embeds?.length;
        return hasMedia ? "sent an attachment" : "";
    }

    const max = Number(settings.store.ttsMaxChars) || 200;
    return text.length > max ? text.slice(0, max) : text;
}

/** Text shown on the banner (kept readable, not stripped). */
function buildDisplayText(message: any): string {
    let c = String(message?.content || "").replace(/\s+/g, " ").trim();
    if (!c) {
        if (message?.sticker_items?.length || message?.stickerItems?.length) c = "🏷️ sent a sticker";
        else if (message?.attachments?.length) c = "📎 sent an attachment";
        else if (message?.embeds?.length) c = "🔗 sent a link";
        else c = "(no text)";
    }
    return c.length > 280 ? c.slice(0, 280) + "…" : c;
}

// ---------------------------------------------------------------------------
// Alert queue
// ---------------------------------------------------------------------------

interface Alert {
    name: string;
    avatarUrl: string;
    displayText: string;
    ttsText: string;
}

const queue: Alert[] = [];
let playing = false;

function enqueueAlert(alert: Alert) {
    if (queue.length >= (Number(settings.store.queueCap) || 5)) return; // drop during a flood
    queue.push(alert);
    void processQueue();
}

async function processQueue() {
    if (playing) return;
    playing = true;
    try {
        while (queue.length) {
            const alert = queue.shift()!;
            await playAlert(alert);
        }
    } finally {
        playing = false;
    }
}

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function playAlert(alert: Alert) {
    const durationMs = (Number(settings.store.bannerDurationSec) || 6) * 1000;

    if (settings.store.showInDiscordBanner) showBanner(alert);

    if (settings.store.forwardToOverlay) {
        try {
            await Native?.sendAlert?.(
                Number(settings.store.overlayPort) || 2387,
                JSON.stringify({
                    name: alert.name,
                    displayText: alert.displayText,
                    avatarUrl: alert.avatarUrl,
                    durationMs,
                    style: settings.store.bannerStyle || "outline",
                    color1: settings.store.bannerColor1 || "#5865f2",
                    color2: settings.store.bannerColor2 || "#9b59ff",
                    textColor: settings.store.bannerTextColor || "#ffffff",
                    outlineColor: settings.store.bannerOutlineColor || "#ff36c4"
                })
            );
        } catch (e) {
            console.error("[DonationAlert] overlay forward failed", e);
        }
    }

    playSound();
    // Stage stays until BOTH the banner timer and the TTS have finished.
    await Promise.all([wait(durationMs), speak(alert.ttsText)]);

    if (settings.store.showInDiscordBanner) hideBanner();
    await wait(550); // let the slide-out finish before the next alert
}

// ---------------------------------------------------------------------------
// Sound
// ---------------------------------------------------------------------------

function playSound() {
    const src = settings.store.soundDataUrl;
    if (!src) return;
    try {
        const audio = new Audio(src);
        audio.volume = Number(settings.store.soundVolume);
        audio.play().catch(() => { /* autoplay/format issues are non-fatal */ });
    } catch (e) {
        console.error("[DonationAlert] sound error", e);
    }
}

// ---------------------------------------------------------------------------
// Text-to-speech (Web Speech API)
// ---------------------------------------------------------------------------

function playAudioUrl(url: string, volume: number, rate: number, maxMs: number): Promise<void> {
    return new Promise<void>(resolve => {
        try {
            const audio = new Audio(url);
            audio.volume = Math.max(0, Math.min(1, Number(volume)));
            try {
                audio.playbackRate = Math.max(0.5, Math.min(4, Number(rate) || 1));
                (audio as any).preservesPitch = true; // keep voice natural at faster speeds
            } catch { /* older engines */ }
            let done = false;
            const finish = () => {
                if (done) return;
                done = true;
                try { audio.pause(); } catch { /* ignore */ }
                resolve();
            };
            audio.onended = finish;
            audio.onerror = finish;
            audio.play().catch(finish);
            setTimeout(finish, Math.max(1000, maxMs)); // hard cap on reading time
        } catch {
            resolve();
        }
    });
}

// Detects Thai characters (Unicode block U+0E00–U+0E7F).
const THAI_RE = /[฀-๿]/;
const isThai = (text: string) => THAI_RE.test(text);

function speakWebSpeech(text: string): Promise<void> {
    return new Promise<void>(resolve => {
        if (!window.speechSynthesis) return resolve();
        try {
            const u = new SpeechSynthesisUtterance(text);
            u.rate = Number(settings.store.ttsRate) || 1;
            u.volume = Number(settings.store.ttsVolume);

            const voices = window.speechSynthesis.getVoices();
            // For Thai text, prefer an installed Thai voice if one exists.
            const thaiVoice = isThai(text) ? voices.find(v => v.lang?.toLowerCase().startsWith("th")) : undefined;
            const uri = settings.store.selectedVoiceURI;
            const chosen = thaiVoice || (uri ? voices.find(v => v.voiceURI === uri) : undefined);
            if (chosen) {
                u.voice = chosen;
                u.lang = chosen.lang;
            }

            let done = false;
            const finish = () => { if (!done) { done = true; resolve(); } };
            u.onend = finish;
            u.onerror = finish;
            window.speechSynthesis.speak(u);
            const maxMs = (Number(settings.store.ttsMaxSeconds) || 10) * 1000;
            setTimeout(() => {
                try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
                finish();
            }, maxMs); // hard cap on reading time
        } catch {
            resolve();
        }
    });
}

async function speak(text: string): Promise<void> {
    if (!settings.store.ttsEnabled || !text) return;

    if (settings.store.ttsEngine === "online") {
        try {
            // Thai text is always spoken in Thai; otherwise use the chosen language.
            const lang = isThai(text) ? "th" : (settings.store.onlineVoice || "en");
            const dataUrl = await Native?.fetchTtsGoogle?.(lang, text);
            if (dataUrl) {
                await playAudioUrl(
                    dataUrl,
                    Number(settings.store.ttsVolume),
                    Number(settings.store.ttsRate) || 1,
                    (Number(settings.store.ttsMaxSeconds) || 10) * 1000
                );
                return;
            }
        } catch (e) {
            console.error("[DonationAlert] online TTS failed, falling back to system voice", e);
        }
        // fell through — online failed, use offline as a fallback
    }

    return speakWebSpeech(text);
}

// ---------------------------------------------------------------------------
// Banner (plain DOM — robust against Discord/React internals changing)
// ---------------------------------------------------------------------------

const ROOT_ID = "donation-alert-root";
const STYLE_ID = "donation-alert-style";

const STYLE = `
#${ROOT_ID} {
    position: fixed; top: 24px; left: 0; right: 0;
    display: flex; justify-content: center;
    z-index: 100000; pointer-events: none;
}
#${ROOT_ID} .da-banner {
    display: flex; align-items: center; gap: 14px;
    min-width: 320px; max-width: 560px;
    padding: 16px 20px; border-radius: 14px;
    background: linear-gradient(135deg, #5865f2, #9b59ff);
    color: #fff; box-shadow: 0 8px 30px rgba(0,0,0,.45);
    font-family: var(--font-primary, "gg sans", sans-serif);
    transform: translateY(-160%); opacity: 0;
    transition: transform .45s cubic-bezier(.2,.8,.3,1), opacity .45s ease;
}
#${ROOT_ID} .da-banner.da-visible { transform: translateY(0); opacity: 1; }
#${ROOT_ID} .da-avatar {
    width: 56px; height: 56px; border-radius: 50%;
    flex: 0 0 auto; border: 2px solid rgba(255,255,255,.7); object-fit: cover;
}
#${ROOT_ID} .da-body { display: flex; flex-direction: column; overflow: hidden; }
#${ROOT_ID} .da-tag {
    font-size: 11px; text-transform: uppercase; letter-spacing: .08em;
    opacity: .85; margin-bottom: 4px;
}
#${ROOT_ID} .da-name { font-weight: 700; font-size: 16px; margin-bottom: 2px; }
#${ROOT_ID} .da-msg {
    font-size: 14px; opacity: .96; word-break: break-word;
    max-height: 84px; overflow: hidden;
}
#${ROOT_ID} .da-banner.da-outline {
    background: none !important; box-shadow: none !important;
    padding: 0; display: block; text-align: center; max-width: 80%;
}
#${ROOT_ID} .da-oname {
    font-weight: 900; font-size: 30px; line-height: 1.15;
    margin-bottom: 4px; word-break: break-word;
}
#${ROOT_ID} .da-omsg {
    font-weight: 800; font-size: 20px; line-height: 1.2;
    word-break: break-word; max-height: 120px; overflow: hidden;
}
`;

// Builds a solid text outline (+ soft drop shadow) out of layered text-shadows —
// works everywhere, unlike -webkit-text-stroke which renders text hollow.
function outlineShadow(color: string, size: number): string {
    const shadows: string[] = [];
    for (let dx = -size; dx <= size; dx++) {
        for (let dy = -size; dy <= size; dy++) {
            if (dx || dy) shadows.push(`${dx}px ${dy}px 0 ${color}`);
        }
    }
    shadows.push("0 3px 8px rgba(0,0,0,.55)");
    return shadows.join(", ");
}

function ensureRoot(): HTMLElement {
    if (!document.getElementById(STYLE_ID)) {
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = STYLE;
        document.head.appendChild(style);
    }
    let root = document.getElementById(ROOT_ID);
    if (!root) {
        root = document.createElement("div");
        root.id = ROOT_ID;
        document.body.appendChild(root);
    }
    return root;
}

function showBanner(alert: Alert) {
    const root = ensureRoot();
    root.innerHTML = "";

    const style = settings.store.bannerStyle || "outline";
    const tc = settings.store.bannerTextColor || "#ffffff";
    const oc = settings.store.bannerOutlineColor || "#ff36c4";

    const banner = document.createElement("div");
    banner.className = "da-banner";

    if (style === "outline") {
        banner.classList.add("da-outline");

        const name = document.createElement("div");
        name.className = "da-oname";
        name.textContent = alert.name;
        name.style.color = tc;
        name.style.textShadow = outlineShadow(oc, 2); // accent outline on the name

        const msg = document.createElement("div");
        msg.className = "da-omsg";
        msg.textContent = alert.displayText;
        msg.style.color = tc;
        msg.style.textShadow = outlineShadow("#14143c", 2); // dark outline keeps the message readable

        banner.append(name, msg);
    } else {
        banner.style.background = `linear-gradient(135deg, ${settings.store.bannerColor1 || "#5865f2"}, ${settings.store.bannerColor2 || "#9b59ff"})`;
        banner.style.color = tc;

        const img = document.createElement("img");
        img.className = "da-avatar";
        img.src = alert.avatarUrl;
        img.onerror = () => { img.src = "https://cdn.discordapp.com/embed/avatars/0.png"; };

        const body = document.createElement("div");
        body.className = "da-body";

        const tag = document.createElement("div");
        tag.className = "da-tag";
        tag.textContent = "New message!";

        const name = document.createElement("div");
        name.className = "da-name";
        name.textContent = alert.name;

        const msg = document.createElement("div");
        msg.className = "da-msg";
        msg.textContent = alert.displayText;

        body.append(tag, name, msg);
        banner.append(img, body);
    }

    root.append(banner);

    void banner.offsetWidth; // force reflow so the transition plays
    banner.classList.add("da-visible");
}

function hideBanner() {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    const banner = root.querySelector(".da-banner");
    if (banner) banner.classList.remove("da-visible");
    setTimeout(() => {
        const r = document.getElementById(ROOT_ID);
        if (r) r.innerHTML = "";
    }, 500);
}

function teardownBanner() {
    document.getElementById(ROOT_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();
}

// ---------------------------------------------------------------------------
// Test alert
// ---------------------------------------------------------------------------

function triggerTestAlert() {
    const me: any = UserStore.getCurrentUser();
    enqueueAlert({
        name: me ? displayName({ global_name: me.globalName, username: me.username }) : "Test User",
        avatarUrl: me?.getAvatarURL?.(undefined, 128) ?? "https://cdn.discordapp.com/embed/avatars/0.png",
        displayText: "This is a test donation alert! 🎉 Thanks for trying the plugin.",
        ttsText: "This is a test donation alert! Thanks for trying the plugin."
    });
}

// ---------------------------------------------------------------------------
// Settings components
// ---------------------------------------------------------------------------

function SoundPicker() {
    const [name, setName] = React.useState(settings.store.soundFileName || "");
    const inputRef = React.useRef<HTMLInputElement>(null);

    return (
        <div style={{ marginBottom: 8 }}>
            <Forms.FormTitle tag="h5">Alert sound</Forms.FormTitle>
            <Forms.FormText style={{ marginBottom: 8 }}>
                {name ? `Current sound: ${name}` : "No sound selected — the banner and TTS will still play."}
            </Forms.FormText>
            <input
                ref={inputRef}
                type="file"
                accept="audio/*"
                style={{ display: "none" }}
                onChange={e => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                        settings.store.soundDataUrl = String(reader.result);
                        settings.store.soundFileName = file.name;
                        setName(file.name);
                    };
                    reader.readAsDataURL(file); // stored as a data: URL — see ADR-0001
                }}
            />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Button onClick={() => inputRef.current?.click()}>Choose sound file…</Button>
                <Button onClick={playSound} disabled={!settings.store.soundDataUrl}>Preview</Button>
                <Button
                    color={Button.Colors.RED}
                    disabled={!name}
                    onClick={() => {
                        settings.store.soundDataUrl = "";
                        settings.store.soundFileName = "";
                        setName("");
                    }}
                >
                    Clear
                </Button>
            </div>
        </div>
    );
}

function ColorPicker() {
    const [c1, setC1] = React.useState(settings.store.bannerColor1 || "#5865f2");
    const [c2, setC2] = React.useState(settings.store.bannerColor2 || "#9b59ff");
    const [tc, setTc] = React.useState(settings.store.bannerTextColor || "#ffffff");
    const [oc, setOc] = React.useState(settings.store.bannerOutlineColor || "#ff36c4");

    const field = (label: string, value: string, set: (v: string) => void, key: string) => (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <input
                type="color"
                value={value}
                style={{ width: 44, height: 28, padding: 0, border: "none", background: "none", cursor: "pointer" }}
                onChange={e => {
                    set(e.target.value);
                    (settings.store as any)[key] = e.target.value;
                }}
            />
            <span>{label}</span>
        </div>
    );

    // text-shadow outline preview (matches the "outline" banner style)
    const ring = (color: string) =>
        ["-2px -2px", "2px -2px", "-2px 2px", "2px 2px", "0 -2px", "0 2px", "-2px 0", "2px 0"]
            .map(o => `${o} 0 ${color}`).join(", ") + ", 0 3px 8px rgba(0,0,0,.55)";

    return (
        <div style={{ marginBottom: 8 }}>
            <Forms.FormTitle tag="h5">Banner colors</Forms.FormTitle>
            <Forms.FormText style={{ marginBottom: 8 }}>
                Text & outline colors are used by the <b>Outline</b> style; gradient colors by the <b>Card</b> style.
            </Forms.FormText>
            {field("Text color", tc, setTc, "bannerTextColor")}
            {field("Text border / outline color", oc, setOc, "bannerOutlineColor")}
            {field("Gradient start (card style)", c1, setC1, "bannerColor1")}
            {field("Gradient end (card style)", c2, setC2, "bannerColor2")}
            <div style={{ marginTop: 10, padding: 16, borderRadius: 12, background: "#11131a", textAlign: "center" }}>
                <div style={{ color: tc, fontWeight: 900, fontSize: 24, textShadow: ring(oc) }}>Five เปย์ให้ ฿20</div>
                <div style={{ color: tc, fontWeight: 800, fontSize: 16, marginTop: 4, textShadow: ring("#14143c") }}>
                    ขอบคุณสำหรับการสนับสนุน
                </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <Button
                    size={Button.Sizes?.SMALL}
                    onClick={() => {
                        setC1("#5865f2"); setC2("#9b59ff"); setTc("#ffffff"); setOc("#ff36c4");
                        settings.store.bannerColor1 = "#5865f2";
                        settings.store.bannerColor2 = "#9b59ff";
                        settings.store.bannerTextColor = "#ffffff";
                        settings.store.bannerOutlineColor = "#ff36c4";
                    }}
                >
                    Reset to default
                </Button>
            </div>
        </div>
    );
}

function VoicePicker() {
    const [voices, setVoices] = React.useState<SpeechSynthesisVoice[]>([]);
    const [val, setVal] = React.useState(settings.store.selectedVoiceURI || "");

    React.useEffect(() => {
        if (!window.speechSynthesis) return;
        const load = () => setVoices(window.speechSynthesis.getVoices());
        load();
        window.speechSynthesis.addEventListener("voiceschanged", load);
        return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
    }, []);

    return (
        <div style={{ marginBottom: 8 }}>
            <Forms.FormTitle tag="h5">TTS voice</Forms.FormTitle>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <select
                    value={val}
                    onChange={e => {
                        setVal(e.target.value);
                        settings.store.selectedVoiceURI = e.target.value;
                    }}
                    style={{
                        background: "var(--input-background, #1e1f22)",
                        color: "var(--text-normal, #dbdee1)",
                        border: "1px solid var(--input-border, #4f535c)",
                        borderRadius: 4,
                        padding: "6px 8px",
                        minWidth: 240
                    }}
                >
                    <option value="">System default</option>
                    {voices.map(v => (
                        <option key={v.voiceURI} value={v.voiceURI}>
                            {v.name} ({v.lang})
                        </option>
                    ))}
                </select>
                <Button onClick={() => speak("Hello, this is a voice preview.")}>Preview voice</Button>
            </div>
            {!voices.length && (
                <Forms.FormText style={{ marginTop: 6 }}>
                    No system voices detected. Install voices in your OS settings, then reopen this panel.
                </Forms.FormText>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export default definePlugin({
    name: "DonationAlert",
    description: "Twitch-style donation alerts (banner + sound + TTS) when chosen users DM you.",
    authors: [{ name: "bigno", id: 0n }],
    settings,

    flux: {
        MESSAGE_CREATE({ message, channelId }: { message: any; channelId: string; }) {
            try {
                if (!message?.author) return;

                const me: any = UserStore.getCurrentUser();
                if (!me) return;
                if (message.author.id === me.id) return; // never alert on our own messages

                const watched = parseWatchedIds();
                if (!watched.has(String(message.author.id))) return;

                const channel: any = ChannelStore.getChannel(channelId);
                if (!channel) return;
                const isDM = typeof channel.isDM === "function" ? channel.isDM() : channel.type === 1;
                if (!isDM) return; // 1-on-1 DMs only — group DMs and guild messages excluded

                enqueueAlert({
                    name: displayName(message.author),
                    avatarUrl: avatarUrl(message.author),
                    displayText: buildDisplayText(message),
                    ttsText: buildTtsText(message)
                });
            } catch (e) {
                console.error("[DonationAlert] MESSAGE_CREATE handler error", e);
            }
        }
    },

    start() {
        ensureRoot();
    },

    stop() {
        queue.length = 0;
        playing = false;
        try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
        teardownBanner();
    }
});
