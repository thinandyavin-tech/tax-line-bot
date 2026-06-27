const cron = require('node-cron');
const { messagingApi } = require('@line/bot-sdk');
const { getAllUserIds } = require('./sheetsService');

function getClient() {
  return new messagingApi.MessagingApiClient({ channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN });
}

async function pushToAll(text) {
  const userIds = await getAllUserIds();
  if (userIds.length === 0) return;

  const client = getClient();
  let sent = 0;

  for (const userId of userIds) {
    try {
      await client.pushMessage({ to: userId, messages: [{ type: 'text', text }] });
      sent++;
      // Stay within LINE API rate limits
      await new Promise(r => setTimeout(r, 150));
    } catch (err) {
      console.error(`[reminder] push failed for ${userId}:`, err.message);
    }
  }

  console.log(`[reminder] Sent to ${sent}/${userIds.length} users`);
}

const MESSAGES = {
  month_start: () => {
    const now = new Date();
    const thMonth = now.toLocaleDateString('th-TH', { month: 'long', timeZone: 'Asia/Bangkok' });
    return `📅 น้องบัญชีขอแจ้งกำหนดสำคัญเดือน${thMonth}ค่ะ

📌 วันที่ 7 — ภ.ง.ด.1/3/53 (หัก ณ ที่จ่าย) กระดาษ
📌 วันที่ 15 — ภ.พ.30 (VAT) กระดาษ
📌 วันที่ 15 — ภ.ง.ด.1/3/53 ออนไลน์
📌 วันที่ 23 — ภ.พ.30 ออนไลน์

💡 มีใบเสร็จใหม่ อย่าลืมกด "ส่งใบเสร็จ" ให้น้องบัญชีด้วยนะคะ 🧾`;
  },
  wht: () => `⏰ แจ้งเตือนจากน้องบัญชีค่ะ
พรุ่งนี้ครบกำหนดยื่น ภ.ง.ด.1/3/53 (หัก ณ ที่จ่าย) วันที่ 7 ค่ะ
อย่าลืมยื่นด้วยนะคะ 🙏`,
  vat: () => `⏰ แจ้งเตือนจากน้องบัญชีค่ะ
พรุ่งนี้ครบกำหนดยื่น ภ.พ.30 (VAT) วันที่ 15 ค่ะ
อย่าลืมยื่นด้วยนะคะ 🙏`,
  vat_online: () => `⏰ แจ้งเตือนจากน้องบัญชีค่ะ
พรุ่งนี้ครบกำหนดยื่น ภ.พ.30 ออนไลน์ และ ภ.ง.ด.1/3/53 ออนไลน์ วันที่ 23 ค่ะ
อย่าลืมยื่นด้วยนะคะ 🙏`,
};

function startReminders() {
  if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) return;

  // 1st of month, 8am Bangkok = 1am UTC
  cron.schedule('0 1 1 * *', () => pushToAll(MESSAGES.month_start()), { timezone: 'UTC' });

  // 6th (day before WHT deadline on 7th)
  cron.schedule('0 1 6 * *', () => pushToAll(MESSAGES.wht()), { timezone: 'UTC' });

  // 14th (day before VAT deadline on 15th)
  cron.schedule('0 1 14 * *', () => pushToAll(MESSAGES.vat()), { timezone: 'UTC' });

  // 22nd (day before online VAT deadline on 23rd)
  cron.schedule('0 1 22 * *', () => pushToAll(MESSAGES.vat_online()), { timezone: 'UTC' });

  console.log('[reminder] Cron jobs scheduled (WHT/VAT deadlines + month-start)');
}

module.exports = { startReminders };
