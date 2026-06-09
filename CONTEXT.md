# Discord Donation Alert (Vencord Plugin)

A Vencord userplugin that turns direct messages from chosen people into Twitch-style
"donation" alerts: an on-screen popup, an alert sound, and text-to-speech reading of
the message.

## Language

**Watched User**:
A Discord user the operator has chosen to receive alerts for, identified by their
numeric user ID. Messages from this user can trigger an Alert.
_Avoid_: target, sender, subscriber

**Operator**:
The person running Discord with this plugin installed — i.e. "me". Alerts fire for
messages directed at the Operator.
_Avoid_: me, host, streamer

**Alert**:
The combined reaction to a qualifying message: a banner, an alert sound, and a
text-to-speech reading. One incoming message produces at most one Alert. The banner
may render inside the Discord window, on the Overlay, or both; the sound and TTS
always play from Discord.
_Avoid_: notification, donation, popup (each names only one part of the Alert)

**Overlay Companion**:
A separate desktop (Electron) application, run alongside Discord, that renders the
Alert banner on a monitor the Operator chooses. The plugin forwards Alerts to it over
a localhost connection. It exists because a Vencord plugin can only draw inside the
Discord window.
_Avoid_: overlay app, second app

**Overlay**:
The transparent, always-on-top, click-through window the Overlay Companion paints on
the chosen monitor. It shows the banner and never blocks mouse input.
_Avoid_: window, screen

**Qualifying Message**:
A message that triggers an Alert. Defined as a message sent by a Watched User in a
**1-on-1 direct message channel** with the Operator. Group DMs, server/guild
messages, and the Operator's own messages never qualify.
_Avoid_: mention, ping, DM (ambiguous — group DMs do not qualify)
