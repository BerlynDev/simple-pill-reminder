# Pill Reminder Bot 💊

A personal WhatsApp bot that sends scheduled pill reminders and tracks adherence.

## Features
- Configurable pill schedule via `pills.json`
- WhatsApp reminders at the configured times
- Re-sends until you confirm with "YES"
- Logs every response to `history.json`

## Setup
1. `npm install`
2. Copy `.env.example` → `.env` and fill in your WhatsApp number
3. Copy `pills.example.json` → `pills.json` and add your medications
4. `node index.js`
5. Scan the QR code with WhatsApp on first run

## Tech
Built with [whatsapp-web.js](https://wwebjs.dev/) on Node.js.