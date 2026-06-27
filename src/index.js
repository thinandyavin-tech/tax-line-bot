require('dotenv').config();

const express = require('express');
const line = require('@line/bot-sdk');
const Groq = require('groq-sdk');
const { handleEvent } = require('./handlers/messageHandler');

const app = express();
const PORT = process.env.PORT || 3000;

const lineConfig = { channelSecret: process.env.LINE_CHANNEL_SECRET };

app.post('/webhook', line.middleware(lineConfig), async (req, res) => {
  res.sendStatus(200);
  const events = req.body.events ?? [];
  for (const event of events) {
    try {
      await handleEvent(event);
    } catch (err) {
      console.error('[webhook] unhandled error:', err.message, err.stack);
    }
  }
});

// Hit this URL to confirm all services are working
app.get('/status', async (_req, res) => {
  const results = {};

  // Check env vars
  results.envVars = {
    LINE_TOKEN: !!process.env.LINE_CHANNEL_ACCESS_TOKEN,
    LINE_SECRET: !!process.env.LINE_CHANNEL_SECRET,
    GROQ_API_KEY: !!process.env.GROQ_API_KEY,
    SPREADSHEET_ID: !!process.env.SPREADSHEET_ID,
    GOOGLE_CREDS: !!(process.env.GOOGLE_CREDENTIALS_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_KEY),
  };

  // Test Groq
  try {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const r = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 5,
    });
    results.groq = { ok: true, reply: r.choices[0].message.content };
  } catch (err) {
    results.groq = { ok: false, error: err.message };
  }

  // Test Google Sheets
  try {
    const { getRecentPaymentsForUser } = require('./services/sheetsService');
    await getRecentPaymentsForUser('test', 1);
    results.sheets = { ok: true };
  } catch (err) {
    results.sheets = { ok: false, error: err.message };
  }

  res.json(results);
});

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// Keep-alive: ping our own public URL every 14 min so Render free tier stays warm
const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
setInterval(() => {
  const mod = SELF_URL.startsWith('https') ? require('https') : require('http');
  mod.get(`${SELF_URL}/health`, () => {}).on('error', () => {});
}, 14 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`Tax LINE Bot running on port ${PORT}`);
  // Start monthly deadline reminder cron jobs
  try {
    const { startReminders } = require('./services/reminderService');
    startReminders();
  } catch (err) {
    console.error('[reminder] Failed to start:', err.message);
  }
});
