const { extractReceiptData } = require('../services/ocrService');
const { askAccounting, clearHistory } = require('../services/accountingService');
const { appendPayment, getYearSummaryForUser, getRecentPaymentsForUser } = require('../services/sheetsService');
const { getUserProfile, getMessageImageBuffer, replyText } = require('../services/lineService');
const { messagingApi } = require('@line/bot-sdk');

const userStates = new Map();

const THAI_MONTHS = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

function pushClient() {
  return new messagingApi.MessagingApiClient({
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  });
}

function formatAmount(n) {
  return Number(n).toLocaleString('th-TH');
}

async function push(userId, text) {
  return pushClient().pushMessage({ to: userId, messages: [{ type: 'text', text }] });
}

async function handlePostback(event) {
  const { replyToken, source, postback } = event;
  const userId = source.userId;
  const data = postback.data;

  if (data === 'action=send_receipt') {
    userStates.set(userId, 'awaiting_receipt');
    return replyText(replyToken, '📎 กรุณาส่งรูปภาพใบเสร็จหรือใบแจ้งยอดการชำระเงินของคุณ\n\nPlease send a photo of your receipt or payment statement.');
  }

  if (data === 'action=year_summary') {
    const year = new Date().getFullYear();
    const { total, byMonth, count } = await getYearSummaryForUser(userId, year);
    if (count === 0) return replyText(replyToken, `ยังไม่มีข้อมูลการชำระในปี ${year + 543}\n\nNo payment records found for ${year}.`);

    const monthLines = Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([ym, amt]) => {
        const m = parseInt(ym.split('-')[1], 10);
        return `  ${THAI_MONTHS[m]}: ฿${formatAmount(amt)}`;
      }).join('\n');

    return replyText(replyToken, `📊 สรุปการชำระปี ${year + 543} (${year})\n\n${monthLines}\n\n─────────────\n💰 รวมทั้งหมด: ฿${formatAmount(total)}\n(${count} รายการ)`);
  }

  if (data === 'action=payment_history') {
    const recent = await getRecentPaymentsForUser(userId, 10);
    if (recent.length === 0) return replyText(replyToken, 'ยังไม่มีประวัติการชำระเงิน\n\nNo payment history found.');

    const lines = recent.map((row, i) => {
      const amount = row[2] ? `฿${formatAmount(row[2])}` : '-';
      const date = row[3] || '-';
      const desc = row[4] || '-';
      return `${i + 1}. ${date} — ${amount}\n   ${desc}`;
    });

    return replyText(replyToken, `📋 ประวัติการชำระล่าสุด\n\n${lines.join('\n\n')}`);
  }
}

async function handleImage(event) {
  const { replyToken, source, message } = event;
  const userId = source.userId;

  if (userStates.get(userId) !== 'awaiting_receipt') {
    return replyText(replyToken, 'กรุณากดปุ่ม "ส่งใบเสร็จ" ก่อนส่งรูปภาพ\n\nPlease tap "ส่งใบเสร็จ" first.');
  }

  userStates.delete(userId);
  await replyText(replyToken, '⏳ กำลังอ่านใบเสร็จ... กรุณารอสักครู่');

  try {
    const imageBuffer = await getMessageImageBuffer(message.id);
    const data = await extractReceiptData(imageBuffer);
    const profile = await getUserProfile(userId);
    const displayName = data.payerName || profile.displayName;

    await appendPayment({ userId, displayName, amount: data.amount, date: data.date, description: data.description, messageId: message.id });

    const amountStr = data.amount != null ? `฿${formatAmount(data.amount)}` : 'ไม่ระบุ';
    const dateStr = data.date || 'ไม่ระบุ';
    const descStr = data.description || 'ไม่ระบุ';

    await push(userId, `✅ บันทึกสำเร็จ!\n\n👤 ${displayName}\n💰 ${amountStr}\n📅 ${dateStr}\n📝 ${descStr}\n\nบันทึกลง Google Sheets แล้ว`);
  } catch (err) {
    console.error('Receipt error:', err.message);
    userStates.set(userId, 'awaiting_receipt');
    await push(userId, '❌ อ่านใบเสร็จไม่ได้ กรุณาส่งรูปที่ชัดขึ้น หรือพิมพ์:\n"ชำระ 2000 บาท 2026-06-27 ค่าภาษีเงินได้"');
  }
}

async function handleTextMessage(event) {
  const { replyToken, source, message } = event;
  const userId = source.userId;
  const text = message.text.trim();

  // Reset conversation history
  if (text === 'รีเซ็ต' || text.toLowerCase() === 'reset') {
    clearHistory(userId);
    return replyText(replyToken, '🔄 เริ่มการสนทนาใหม่แล้ว');
  }

  // Manual receipt entry: "ชำระ 2000 บาท 2026-06-27 ค่าภาษี"
  const manualMatch = text.match(/ชำระ\s+([\d,]+)\s*บาท\s*(\d{4}-\d{2}-\d{2})?\s*(.*)?/i);
  if (manualMatch && userStates.get(userId) === 'awaiting_receipt') {
    userStates.delete(userId);
    const amount = parseFloat(manualMatch[1].replace(/,/g, ''));
    const date = manualMatch[2] || new Date().toISOString().slice(0, 10);
    const description = manualMatch[3]?.trim() || 'ป้อนด้วยตัวเอง';
    const profile = await getUserProfile(userId);
    await appendPayment({ userId, displayName: profile.displayName, amount, date, description, messageId: null });
    return replyText(replyToken, `✅ บันทึกแล้ว!\n💰 ฿${formatAmount(amount)} — ${date}\n📝 ${description}`);
  }

  // Everything else → Thai accounting AI
  try {
    await replyText(replyToken, '🤔 กำลังค้นหาคำตอบ...');
    const answer = await askAccounting(userId, text);
    await push(userId, answer);
  } catch (err) {
    console.error('Accounting AI error:', err.message);
    await push(userId, '❌ ขออภัย เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
  }
}

async function handleEvent(event) {
  try {
    if (event.type === 'postback') return handlePostback(event);
    if (event.type === 'message' && event.message.type === 'image') return handleImage(event);
    if (event.type === 'message' && event.message.type === 'text') return handleTextMessage(event);
    if (event.type === 'follow') {
      const profile = await getUserProfile(event.source.userId);
      return replyText(event.replyToken,
        `สวัสดีคุณ ${profile.displayName}! 🙏\n\nฉันคือ TaxBot ผู้ช่วยด้านภาษีและบัญชีไทย\n\n📎 กดปุ่ม "ส่งใบเสร็จ" เพื่อบันทึกการชำระเงิน\n📊 กด "สรุปรายปี" เพื่อดูยอดรวม\n💬 หรือพิมพ์ถามเรื่องภาษีได้เลย เช่น "ค่าลดหย่อนมีอะไรบ้าง"`
      );
    }
  } catch (err) {
    console.error(`Error [${event.type}]:`, err.message);
  }
}

module.exports = { handleEvent };
