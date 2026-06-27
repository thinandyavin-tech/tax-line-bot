const { extractReceiptData } = require('../services/ocrService');
const { askAssistant, clearHistory } = require('../services/accountingService');
const { appendPayment, getYearSummaryForUser, getRecentPaymentsForUser, getCustomerName, saveCustomerName } = require('../services/sheetsService');
const { getUserProfile, getMessageImageBuffer } = require('../services/lineService');
const { uploadReceiptImage } = require('../services/driveService');
const { messagingApi } = require('@line/bot-sdk');

// userStates stores rich state objects per userId
// { state, pendingReceipt: { data, imageBuffer, messageId } }
const userStates = new Map();

const CATEGORIES = ['ภาษีเงินได้', 'VAT/ภาษีมูลค่าเพิ่ม', 'ภาษีหัก ณ ที่จ่าย', 'ค่าสาธารณูปโภค', 'ค่าเช่า', 'อื่นๆ'];
const THAI_MONTHS = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

function getClient() {
  return new messagingApi.MessagingApiClient({ channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN });
}

async function reply(replyToken, messages) {
  const msgs = Array.isArray(messages) ? messages : [{ type: 'text', text: messages }];
  return getClient().replyMessage({ replyToken, messages: msgs });
}


function formatAmount(n) {
  return Number(n).toLocaleString('th-TH');
}

function categoryQuickReply() {
  return {
    items: CATEGORIES.map(cat => ({
      type: 'action',
      action: { type: 'message', label: cat, text: `หมวดหมู่: ${cat}` },
    })),
  };
}

// ── Postback (rich menu button taps) ────────────────────────────────────────

async function handlePostback(event) {
  const { replyToken, source, postback } = event;
  const userId = source.userId;
  const data = postback.data;

  if (data === 'action=send_receipt') {
    const customerName = await getCustomerName(userId);

    if (!customerName) {
      userStates.set(userId, { state: 'awaiting_name' });
      return reply(replyToken, '👋 กรุณาแจ้งชื่อ-นามสกุลของคุณก่อนนะคะ\n(เพื่อจัดเก็บข้อมูลให้ถูกต้อง)');
    }

    userStates.set(userId, { state: 'awaiting_receipt' });
    return reply(replyToken, `📎 สวัสดีคุณ${customerName}!\nกรุณาส่งรูปภาพใบเสร็จหรือใบแจ้งยอดการชำระเงิน`);
  }

  if (data === 'action=year_summary') {
    const year = new Date().getFullYear();
    const { total, byCategory, byMonth, count } = await getYearSummaryForUser(userId, year);
    if (count === 0) return reply(replyToken, `ยังไม่มีข้อมูลการชำระในปี ${year + 543}`);

    const catLines = Object.entries(byCategory)
      .map(([cat, amt]) => `  📂 ${cat}: ฿${formatAmount(amt)}`).join('\n');

    const monthLines = Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([ym, amt]) => {
        const m = parseInt(ym.split('-')[1], 10);
        return `  ${THAI_MONTHS[m]}: ฿${formatAmount(amt)}`;
      }).join('\n');

    return reply(replyToken, `📊 สรุปปี ${year + 543} (${year})\n\nตามหมวดหมู่:\n${catLines}\n\nตามเดือน:\n${monthLines}\n\n─────────────\n💰 รวม: ฿${formatAmount(total)} (${count} รายการ)`);
  }

  if (data === 'action=payment_history') {
    const recent = await getRecentPaymentsForUser(userId, 10);
    if (recent.length === 0) return reply(replyToken, 'ยังไม่มีประวัติการชำระเงิน');

    const lines = recent.map((row, i) => {
      const amount = row[3] ? `฿${formatAmount(row[3])}` : '-';
      const date = row[4] || '-';
      const cat = row[2] || '-';
      const desc = row[5] || '-';
      return `${i + 1}. ${date} [${cat}]\n   ${amount} — ${desc}`;
    });

    return reply(replyToken, `📋 ประวัติล่าสุด\n\n${lines.join('\n\n')}`);
  }
}

// ── Image message ────────────────────────────────────────────────────────────

async function handleImage(event) {
  const { replyToken, source, message } = event;
  const userId = source.userId;
  const stateObj = userStates.get(userId) ?? {};

  if (stateObj.state !== 'awaiting_receipt') {
    return reply(replyToken, 'กรุณากดปุ่ม "ส่งใบเสร็จ" ก่อนส่งรูปภาพ');
  }

  try {
    const imageBuffer = await getMessageImageBuffer(message.id);
    const data = await extractReceiptData(imageBuffer);

    userStates.set(userId, {
      state: 'awaiting_confirm',
      pendingReceipt: { data, imageBuffer, messageId: message.id },
    });

    const amountStr = data.amount != null ? `฿${formatAmount(data.amount)}` : '❓ ไม่พบ';
    const dateStr = data.date || '❓ ไม่พบ';
    const descStr = data.description || '❓ ไม่พบ';

    await reply(replyToken, [
      {
        type: 'text',
        text: `📋 อ่านใบเสร็จได้ดังนี้:\n\n💰 จำนวน: ${amountStr}\n📅 วันที่: ${dateStr}\n📝 รายละเอียด: ${descStr}\n\n─────────────\nข้อมูลถูกต้องไหม?`,
        quickReply: {
          items: [
            { type: 'action', action: { type: 'message', label: '✅ ถูกต้อง', text: 'ยืนยัน: ถูกต้อง' } },
            { type: 'action', action: { type: 'message', label: '✏️ แก้จำนวนเงิน', text: 'แก้ไข: จำนวน' } },
            { type: 'action', action: { type: 'message', label: '✏️ แก้วันที่', text: 'แก้ไข: วันที่' } },
            { type: 'action', action: { type: 'message', label: '🔄 ส่งรูปใหม่', text: 'ยกเลิก: ส่งใหม่' } },
          ],
        },
      },
    ]);
  } catch (err) {
    console.error('OCR error:', err.message);
    userStates.set(userId, { state: 'awaiting_receipt' });
    await reply(replyToken, '❌ อ่านใบเสร็จไม่ได้ กรุณาส่งรูปที่ชัดขึ้น ถ่ายให้ตรง แสงพอ และไม่สั่น');
  }
}

// ── Text messages ────────────────────────────────────────────────────────────

async function handleTextMessage(event) {
  const { replyToken, source, message } = event;
  const userId = source.userId;
  const text = message.text.trim();
  const stateObj = userStates.get(userId) ?? {};

  // Reset
  if (text === 'รีเซ็ต' || text.toLowerCase() === 'reset') {
    userStates.delete(userId);
    clearHistory(userId);
    return reply(replyToken, '🔄 รีเซ็ตแล้ว');
  }

  // ── State: waiting for customer name ──
  if (stateObj.state === 'awaiting_name') {
    const registeredName = text;
    const profile = await getUserProfile(userId);
    await saveCustomerName(userId, profile.displayName, registeredName);

    userStates.set(userId, { state: 'awaiting_receipt' });
    return reply(replyToken, `✅ บันทึกชื่อ "${registeredName}" แล้วค่ะ\n\n📎 กรุณาส่งรูปภาพใบเสร็จได้เลย`);
  }

  // ── State: confirm OCR result ──
  if (stateObj.state === 'awaiting_confirm') {
    if (text === 'ยืนยัน: ถูกต้อง') {
      userStates.set(userId, { ...stateObj, state: 'awaiting_category' });
      return reply(replyToken, [{
        type: 'text',
        text: 'กรุณาเลือกหมวดหมู่:',
        quickReply: categoryQuickReply(),
      }]);
    }
    if (text === 'แก้ไข: จำนวน') {
      userStates.set(userId, { ...stateObj, state: 'fix_amount' });
      return reply(replyToken, `💰 จำนวนปัจจุบัน: ${stateObj.pendingReceipt.data.amount ?? 'ไม่พบ'}\nกรุณาพิมพ์จำนวนเงินที่ถูกต้อง (ตัวเลขเท่านั้น เช่น 2500):`);
    }
    if (text === 'แก้ไข: วันที่') {
      userStates.set(userId, { ...stateObj, state: 'fix_date' });
      return reply(replyToken, `📅 วันที่ปัจจุบัน: ${stateObj.pendingReceipt.data.date ?? 'ไม่พบ'}\nกรุณาพิมพ์วันที่ที่ถูกต้อง (รูปแบบ YYYY-MM-DD เช่น 2026-06-27):`);
    }
    if (text === 'ยกเลิก: ส่งใหม่') {
      userStates.set(userId, { state: 'awaiting_receipt' });
      return reply(replyToken, '🔄 กรุณาส่งรูปใบเสร็จใหม่อีกครั้ง');
    }
  }

  // ── State: fix amount ──
  if (stateObj.state === 'fix_amount') {
    const amount = parseFloat(text.replace(/,/g, ''));
    if (isNaN(amount)) return reply(replyToken, '❌ กรุณาพิมพ์ตัวเลขเท่านั้น เช่น 2500');
    const updated = { ...stateObj, state: 'awaiting_confirm', pendingReceipt: { ...stateObj.pendingReceipt, data: { ...stateObj.pendingReceipt.data, amount } } };
    userStates.set(userId, updated);
    return reply(replyToken, [{
      type: 'text',
      text: `✅ แก้จำนวนเป็น ฿${formatAmount(amount)} แล้ว\n\n💰 จำนวน: ฿${formatAmount(amount)}\n📅 วันที่: ${updated.pendingReceipt.data.date ?? '❓'}\n📝 รายละเอียด: ${updated.pendingReceipt.data.description ?? '❓'}\n\nข้อมูลถูกต้องไหม?`,
      quickReply: { items: [
        { type: 'action', action: { type: 'message', label: '✅ ถูกต้อง', text: 'ยืนยัน: ถูกต้อง' } },
        { type: 'action', action: { type: 'message', label: '✏️ แก้วันที่', text: 'แก้ไข: วันที่' } },
        { type: 'action', action: { type: 'message', label: '🔄 ส่งรูปใหม่', text: 'ยกเลิก: ส่งใหม่' } },
      ]},
    }]);
  }

  // ── State: fix date ──
  if (stateObj.state === 'fix_date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return reply(replyToken, '❌ รูปแบบไม่ถูกต้อง กรุณาพิมพ์ เช่น 2026-06-27');
    const updated = { ...stateObj, state: 'awaiting_confirm', pendingReceipt: { ...stateObj.pendingReceipt, data: { ...stateObj.pendingReceipt.data, date: text } } };
    userStates.set(userId, updated);
    return reply(replyToken, [{
      type: 'text',
      text: `✅ แก้วันที่เป็น ${text} แล้ว\n\n💰 จำนวน: ${updated.pendingReceipt.data.amount != null ? `฿${formatAmount(updated.pendingReceipt.data.amount)}` : '❓'}\n📅 วันที่: ${text}\n📝 รายละเอียด: ${updated.pendingReceipt.data.description ?? '❓'}\n\nข้อมูลถูกต้องไหม?`,
      quickReply: { items: [
        { type: 'action', action: { type: 'message', label: '✅ ถูกต้อง', text: 'ยืนยัน: ถูกต้อง' } },
        { type: 'action', action: { type: 'message', label: '✏️ แก้จำนวนเงิน', text: 'แก้ไข: จำนวน' } },
        { type: 'action', action: { type: 'message', label: '🔄 ส่งรูปใหม่', text: 'ยกเลิก: ส่งใหม่' } },
      ]},
    }]);
  }

  // ── State: waiting for category selection ──
  if (stateObj.state === 'awaiting_category') {
    const categoryMatch = text.match(/^หมวดหมู่:\s*(.+)$/);
    let category = categoryMatch ? categoryMatch[1].trim() : text.trim();

    if (category === 'อื่นๆ') {
      userStates.set(userId, { ...stateObj, state: 'awaiting_custom_category' });
      return reply(replyToken, 'กรุณาพิมพ์หมวดหมู่ที่ต้องการ:');
    }

    await saveReceipt(userId, category, stateObj.pendingReceipt, replyToken);
    return;
  }

  // ── State: waiting for custom category text ──
  if (stateObj.state === 'awaiting_custom_category') {
    await saveReceipt(userId, text.trim(), stateObj.pendingReceipt, replyToken);
    return;
  }

  // ── Manual receipt entry ──
  const manualMatch = text.match(/ชำระ\s+([\d,]+)\s*บาท\s*(\d{4}-\d{2}-\d{2})?\s*(.*)?/i);
  if (manualMatch && stateObj.state === 'awaiting_receipt') {
    userStates.set(userId, {
      state: 'awaiting_category',
      pendingReceipt: {
        data: {
          amount: parseFloat(manualMatch[1].replace(/,/g, '')),
          date: manualMatch[2] || new Date().toISOString().slice(0, 10),
          description: manualMatch[3]?.trim() || 'ป้อนด้วยตัวเอง',
          rawText: text,
        },
        imageBuffer: null,
        messageId: null,
      },
    });

    return reply(replyToken, [
      {
        type: 'text',
        text: 'กรุณาเลือกหมวดหมู่:',
        quickReply: categoryQuickReply(),
      },
    ]);
  }

  // ── Default: personal accounting assistant ──
  try {
    const year = new Date().getFullYear();
    const [customerName, summary, recent] = await Promise.all([
      getCustomerName(userId),
      getYearSummaryForUser(userId, year).catch(() => null),
      getRecentPaymentsForUser(userId, 5).catch(() => []),
    ]);
    const customerData = customerName ? { name: customerName, year, summary, recent } : null;
    const answer = await askAssistant(userId, text, customerData);
    await reply(replyToken, answer);
  } catch (err) {
    console.error('AI error:', err.message);
    await reply(replyToken, `❌ เกิดข้อผิดพลาด: ${err.message}\nกรุณาลองใหม่`);
  }
}

// ── Save receipt after category is confirmed ─────────────────────────────────

async function saveReceipt(userId, category, pendingReceipt, replyToken) {
  userStates.delete(userId);

  const { data, imageBuffer, messageId } = pendingReceipt;
  const customerName = await getCustomerName(userId);

  let imageUrl = null;
  if (imageBuffer) {
    try {
      const safeDate = data.date || new Date().toISOString().slice(0, 10);
      const safeAmount = data.amount ? `${data.amount}THB` : 'unknown';
      const filename = `${customerName}_${safeDate}_${safeAmount}_${messageId?.slice(-6) ?? 'manual'}.jpg`;
      imageUrl = await uploadReceiptImage(imageBuffer, customerName, filename);
    } catch (err) {
      console.error('Drive upload error:', err.message);
    }
  }

  await appendPayment({ userId, customerName, category, amount: data.amount, date: data.date, description: data.description, rawText: data.rawText, imageUrl });

  const amountStr = data.amount != null ? `฿${formatAmount(data.amount)}` : 'ไม่ระบุ';
  const imgNote = imageUrl ? `\n🖼 รูปภาพ: ${imageUrl}` : '';

  await reply(replyToken,
    `✅ บันทึกสำเร็จ!\n\n👤 ${customerName}\n📂 หมวด: ${category}\n💰 ${amountStr}\n📅 ${data.date || 'ไม่ระบุ'}\n📝 ${data.description || 'ไม่ระบุ'}${imgNote}`
  );
}

// ── Entry point ──────────────────────────────────────────────────────────────

async function handleEvent(event) {
  try {
    if (event.type === 'postback') return handlePostback(event);
    if (event.type === 'message' && event.message.type === 'image') return handleImage(event);
    if (event.type === 'message' && event.message.type === 'text') return handleTextMessage(event);
    if (event.type === 'follow') {
      const profile = await getUserProfile(event.source.userId);
      return reply(event.replyToken,
        `สวัสดีค่ะ คุณ${profile.displayName}! 🙏\n\nหนูชื่อ "น้องบัญชี" ผู้ช่วยบัญชีส่วนตัวของคุณค่ะ\nพร้อมดูแลเรื่องภาษีและบัญชีให้คุณทุกอย่าง\n\n📎 ส่งใบเสร็จ — บันทึกรายการชำระเงิน\n📊 สรุปรายปี — ดูยอดรวมทั้งปี\n📋 ประวัติ — ดูรายการล่าสุด\n💬 หรือจะถามอะไรก็ได้เลยค่ะ เช่น\n   "ค่าลดหย่อนปีนี้มีอะไรบ้าง"\n   "ฉันควรจ่ายภาษีเท่าไหร่"\n   "สรุปรายการของฉันให้หน่อย"`
      );
    }
  } catch (err) {
    console.error(`Error [${event.type}]:`, err.message);
  }
}

module.exports = { handleEvent };
