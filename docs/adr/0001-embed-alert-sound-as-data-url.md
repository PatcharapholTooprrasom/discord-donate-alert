# Embed the alert sound as a base64 data URL in plugin settings

Discord's renderer runs under a strict Content Security Policy that blocks loading
`file://` audio URLs, so a plugin cannot reliably play a local sound file by path.
Rather than depend on Vencord's native/Node bridge to read bytes at runtime, we let
the user pick a file once via a file picker and store its contents as a base64 `data:`
URL in the plugin settings. This bypasses CSP entirely and survives restarts.

## Consequences

- Settings storage holds the full encoded audio, so a large sound file noticeably
  bloats the settings blob. Keep alert sounds short (a few seconds).
- Changing the sound means re-picking the file, not editing a path string.
