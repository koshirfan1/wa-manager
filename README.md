# WA Manager (Step 1: multi-account inbox)

Electron + Baileys + React/Vite.

## Run
    npm install
    npm run dev

1. Click **Add account**, name it, scan the QR from WhatsApp > Linked devices.
2. Add as many accounts as you want; each has its own auth folder in the app's userData/sessions.
3. Incoming and outgoing 1:1 text messages show in the inbox.

## Notes
- Unofficial library: test on a secondary number first.
- Messages are kept in memory only (last 500 per account). SQLite persistence comes in step 2.
- Groups, media and history sync are skipped on purpose for now.

## Next steps
2. Availability mode + AI reply (draft mode first, blocklist, delays)
3. Google Sheet daily outreach queue (10/day)
