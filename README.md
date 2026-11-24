# WA Manager (Step 1: multi-account inbox)

Electron + Baileys + React/Vite.

## Run
    npm install
    npm run dev

1. Click **Add account**, name it, scan the QR from WhatsApp > Linked devices.
2. Add as many accounts as you want; each has its own auth folder in the app's userData/sessions.
3. Incoming and outgoing 1:1 text messages show in the inbox.

## Make an installer
    npm run dist
Creates the installer in `release/` (Windows .exe on Windows, .dmg on Mac, AppImage on Linux). Build on the system you want to install on.

## Notes
- Unofficial library: test on a secondary number first.
- Messages are saved to messages.json in the app's userData folder (last 500 per account).
- Away mode: needs a Claude API key (Settings). Drafts only, you approve each one. API key is stored encrypted via the OS keychain when available.
- Groups, media and history sync are skipped on purpose for now.

## Outreach (Google Sheet queue)
1. Google Cloud: create a service account, enable the Google Sheets API, download its JSON key.
2. Share your sheet with the service account's email as Editor.
3. In the app: Outreach tab, paste the sheet link, tabs and key, pick the account, write your message versions, Preview, then Start.
- Reads the `WhatsApp link` column for the number, only rows with Status "Not contacted" and WhatsApp works "WA WOrking".
- Writes Sent / Invalid / Replied / Opted out into the first `Status` column.
- Warm-up: 3/day, then 5/day, then your limit. Random 3-15 min gaps, working hours in the clinics' time zone.
- Anyone who replies STOP is skipped forever. Replies from contacted numbers are marked in the sheet and logged.

## Also included
- Away mode schedule (Settings), desktop notifications and unread badges for new messages.

## Possible next steps
- SQLite instead of messages.json, group chats and media, tray icon.
