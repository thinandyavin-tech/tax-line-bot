const { extractReceiptData } = require('../services/ocrService');
const { appendPayment, getYearSummaryForUser, getRecentPaymentsForUser } = require('../services/sheetsService');
const { getUserProfile, getMessageImageBuffer, replyText, replyMessages } = require('../services/lineService');

// In-memory state: tracks which users are waiting to send a receipt image
const userStates = new Map();

const THAI_MONTHS = [
  '', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

function formatAmount(n) {
  return Number(n).toLocaleString('th-TH');
}

function monthLabel(yyyyMm) {
  const [, m] = yyyyMm.split('-');
  return THAI_MONTHS[parseInt(m, 10)] || yyyyMm;
}

async function handlePostback(event) {
  const { replyToken, source, postback } = event;
  const userId = source.userId;
  const data = postback.data;

  if (data === 'action=send_receipt') {
    userStates.set(userId, 'awaiting_receipt');
    await replyText(
      replyToken,
      '📎 กรุณาส่งรูปภาพใบเสร็จหรือใบแจ้งยอดการชำระเงินของคุณ\n\nPlease send a photo of your receipt or payment statement.',
    );
    return;
  }

  if (data === 'action=year_summary') {
    const year = new Date().getFullYear();
    const { total, byMonth, count } = await getYearSummaryForUser(userId, year);

    if (count === 0) {
      await replyText(replyToken, `ยังไม่มีข้อมูลการชำระในปี ${year + 543}\n\nNo payment records found for ${year}.`);
      return;
    }

    const monthLines = Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([ym, amt]) => `  ${monthLabel(ym)}: ฿${formatAmount(amt)}`)
      .join('\n');

    const msg = `📊 สรุปการชำระปี ${year + 543} (${year})\n\n${monthLines}\n\n─────────────────\n💰 รวมทั้งหมด: ฿${formatAmount(total)}\n(${count} รายการ)`;
    await replyText(replyToken, msg);
    return;
  }

  if (data === 'action=payment_history') {
    const recent = await getRecentPaymentsForUser(userId, 10);

    if (recent.length === 0) {
      await replyText(replyToken, 'ยังไม่มีประวัติการชำระเงิน\n\nNo payment history found.');
      return;
    }

    const lines = recent.map((row, i) => {
      const name = row[1] || 'ไม่ระบุ';
      const amount = row[2] ? `฿${formatAmount(row[2])}` : '-';
      const date = row[3] || '-';
      const desc = row[4] || '-';
      return `${i + 1}. ${date}\n   ${name} — ${amount}\n   ${desc}`;
    });

    const msg = `📋 ประวัติการชำระล่าสุด\n\n${lines.join('\n\n')}`;
    await replyText(replyToken, msg);
    return;
  }
}

async function handleImage(event) {
  const { replyToken, source, message } = event;
  const userId = source.userId;

  if (userStates.get(userId) !== 'awaiting_receipt') {
    await replyText(
      replyToken,
      'กรุณากดปุ่ม "ส่งใบเสร็จ" ก่อนส่งรูปภาพ\n\nPlease tap "Send Receipt" first, then send your image.',
    );
    return;
  }

  userStates.delete(userId);

  await replyText(replyToken, '⏳ กำลังอ่านใบเสร็จของคุณ... กรุณารอสักครู่\n\nReading your receipt, please wait...');

  try {
    const imageBuffer = await getMessageImageBuffer(message.id);
    const data = await extractReceiptData(imageBuffer, message.contentProvider?.type === 'external' ? 'image/jpeg' : 'image/jpeg');

    const profile = await getUserProfile(userId);
    const displayName = data.payerName || profile.displayName;

    await appendPayment({
      userId,
      displayName,
      amount: data.amount,
      date: data.date,
      description: data.description,
      messageId: message.id,
    });

    const amountStr = data.amount != null ? `฿${formatAmount(data.amount)}` : 'ไม่ระบุจำนวน';
    const dateStr = data.date || 'ไม่ระบุวันที่';
    const descStr = data.description || 'ไม่ระบุรายละเอียด';

    const confirm = [
      '✅ บันทึกสำเร็จ!',
      '',
      `👤 ชื่อ: ${displayName}`,
      `💰 จำนวน: ${amountStr}`,
      `📅 วันที่: ${dateStr}`,
      `📝 รายละเอียด: ${descStr}`,
      '',
      'ข้อมูลถูกบันทึกลง Google Sheets แล้ว',
    ].join('\n');

    // Use push since replyToken was already used above
    const { messagingApi } = require('@line/bot-sdk');
    const pushClient = new messagingApi.MessagingApiClient({
      channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    });
    await pushClient.pushMessage({
      to: userId,
      messages: [{ type: 'text', text: confirm }],
    });
  } catch (err) {
    console.error('OCR error:', err.message);

    const pushClient = new (require('@line/bot-sdk').messagingApi.MessagingApiClient)({
      channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    });
    await pushClient.pushMessage({
      to: userId,
      messages: [{
        type: 'text',
        text: '❌ ไม่สามารถอ่านใบเสร็จได้\n\nกรุณาลองอีกครั้งด้วยรูปที่ชัดขึ้น หรือพิมพ์ข้อมูลด้วยตัวเอง:\n"ชำระ [จำนวน] บาท [วันที่] [รายละเอียด]"\n\nCould not read the receipt. Please try again with a clearer image.',
      }],
    });
    // Return to awaiting state so they can retry
    userStates.set(userId, 'awaiting_receipt');
  }
}

async function handleTextMessage(event) {
  const { replyToken, source, message } = event;
  const userId = source.userId;
  const text = message.text.trim();

  // Manual entry format: "ชำระ 2000 บาท 2026-06-27 ค่าภาษีเงินได้"
  const manualPattern = /ชำระ\s+([\d,]+)\s*บาท\s*(\d{4}-\d{2}-\d{2})?\s*(.*)?/i;
  const match = text.match(manualPattern);

  if (match && userStates.get(userId) === 'awaiting_receipt') {
    userStates.delete(userId);
    const amount = parseFloat(match[1].replace(/,/g, ''));
    const date = match[2] || new Date().toISOString().slice(0, 10);
    const description = match[3]?.trim() || 'ป้อนด้วยตัวเอง';

    const profile = await getUserProfile(userId);
    await appendPayment({ userId, displayName: profile.displayName, amount, date, description, messageId: null });

    await replyText(
      replyToken,
      `✅ บันทึกแล้ว!\n💰 ฿${formatAmount(amount)} — ${date}\n📝 ${description}`,
    );
    return;
  }

  // Default help message
  await replyText(
    replyToken,
    'สวัสดี! 👋 ใช้เมนูด้านล่างเพื่อ:\n\n📎 ส่งใบเสร็จ — แนบรูปใบเสร็จการชำระ\n📊 สรุปรายปี — ดูยอดรวมประจำปี\n📋 ประวัติ — ดูรายการล่าสุด\n\nHello! Use the menu below to send receipts, view summaries, or check payment history.',
  );
}

async function handleEvent(event) {
  try {
    if (event.type === 'postback') return handlePostback(event);
    if (event.type === 'message' && event.message.type === 'image') return handleImage(event);
    if (event.type === 'message' && event.message.type === 'text') return handleTextMessage(event);
    // Follow/unfollow events — send welcome message on follow
    if (event.type === 'follow') {
      const profile = await getUserProfile(event.source.userId);
      await replyText(
        event.replyToken,
        `ยินดีต้อนรับคุณ ${profile.displayName}! 🙏\n\nบอทนี้ช่วยเก็บข้อมูลการชำระภาษีของคุณ\nกดปุ่ม "ส่งใบเสร็จ" เพื่อเริ่มต้น\n\nWelcome! This bot helps track your tax payments. Tap "Send Receipt" to get started.`,
      );
    }
  } catch (err) {
    console.error(`Error handling event type=${event.type}:`, err.message);
  }
}

module.exports = { handleEvent };
