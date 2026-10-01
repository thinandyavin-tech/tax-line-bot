# Tax LINE Bot

A Thai-language LINE assistant for capturing receipts, tracking payments in Google Sheets, and viewing summaries.

## Features

- Receipt OCR through Google Cloud Vision, with a Groq vision fallback.
- Groq parsing of receipt amounts, dates, and descriptions.
- Google Sheets customer and payment records.
- Payment history, search, yearly summaries, and PDF reports.
- LINE rich menus, experimental tax estimates, and scheduled reminders.

## Quick start

Use Node.js 22.3+ (Node.js 24 LTS recommended). The PDF parser also supports Node.js 20.16+, but not Node.js 18 or 21.

```powershell
git clone https://github.com/thinandyavin-tech/tax-line-bot.git
cd tax-line-bot
npm ci
Copy-Item .env.example .env
```

On macOS/Linux, use `cp .env.example .env`.

Fill in your local `.env`:

| Variable | Purpose |
| --- | --- |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Messaging API token |
| `LINE_CHANNEL_SECRET` | Webhook signature verification |
| `GROQ_API_KEY` | OCR fallback, parsing, and chat; add it because the current template omits it |
| `SPREADSHEET_ID` | Destination Google spreadsheet |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Local service-account JSON file path |
| `GOOGLE_CREDENTIALS_JSON` | Alternative to a key file: service-account JSON in an environment variable |
| `PORT` | Server port, default 3000 |

The template includes `GEMINI_API_KEY`, but the current OCR and assistant services use Groq.

Enable the Google Sheets and Drive APIs for your project, plus Cloud Vision for the primary OCR path. Share the destination spreadsheet with the service account as an editor. The app can create customer and payment tabs during use.

```powershell
npm start
```

Open `http://localhost:3000/health`. A response containing `"status":"ok"` confirms the HTTP server is running; it does not verify external integrations.

Expose the server over HTTPS and set your LINE webhook to `https://YOUR-HOST/webhook`. Enable webhooks in the LINE channel.

## Try it

Add the LINE account as a friend and follow the registration prompts. Select the receipt action, send a sample receipt image, and review the record in Google Sheets. Use the menus for payment history and yearly summaries.

The commands `npm run setup-menu` and `npm run setup-menus` update LINE rich menus. Review the scripts' configuration before running them.

## Deployment

[render.yaml](render.yaml) contains a Render service definition. Add `GROQ_API_KEY` and supply Google credentials through `GOOGLE_CREDENTIALS_JSON` or a securely mounted file; the existing blueprint does not fully configure these.

## Current limitations

- Receipt-image uploads attempt to grant anyone-with-the-link access. Review [driveService.js](src/services/driveService.js) and its owner-email setting before processing private receipts.
- Conversation state and temporary downloads are held in memory and are lost on restart.
- `/status` performs live integration checks and can expose service errors. Restrict access before production use.
- OCR results and tax estimates need checking against original records.
- Evaluate with sample data. Keep credentials and customer records out of Git.

## Source layout

Run `npm test` to exercise PDF text extraction with a generated receipt and a corrupt file. Tests use the real PDF parser and mock AI requests; no credentials or network access are required.

| Path | Responsibility |
| --- | --- |
| `src/index.js` | Express server and LINE webhook |
| `src/handlers/messageHandler.js` | Conversation and receipt workflows |
| `src/services/` | OCR, storage, reports, reminders, and calculations |
| `src/setup/` | Rich-menu setup and images |

