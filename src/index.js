require('dotenv').config();

const express = require('express');
const line = require('@line/bot-sdk');
const { handleEvent } = require('./handlers/messageHandler');

const app = express();
const PORT = process.env.PORT || 3000;

const lineConfig = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

// LINE webhook — must use raw body for signature verification
app.post('/webhook', line.middleware(lineConfig), async (req, res) => {
  res.sendStatus(200); // Respond immediately; process async

  const events = req.body.events ?? [];
  await Promise.all(events.map(handleEvent));
});

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`Tax LINE Bot running on port ${PORT}`);
  console.log(`Webhook URL: https://<your-domain>/webhook`);
});
