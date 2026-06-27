const crypto = require('crypto');

const { extractReceiptData } = require('../services/ocrService');
const { askAssistant, clearHistory } = require('../services/accountingService');
const { calculatePIT, EXPENSE_RULES } = require('../services/taxCalculator');
const { buildYearSummaryFlex, buildTaxResultFlex, buildProfileFlex, buildSearchResultsFlex } = require('../services/flexService');
const {
  appendPayment, getYearSummaryForUser, getRecentPaymentsForUser,
  getCustomerName, saveCustomerName, updateCustomerName,
  getLastPaymentForUser, updatePaymentRow,
  searchPaymentsForUser, getCustomerStats,
} = require('../services/sheetsService');
const { getUserProfile, getMessageImageBuffer } = require('../services/lineService');
const { uploadReceiptImage } = require('../services/driveService');
const { messagingApi } = require('@line/bot-sdk');

const recentHashes = new Map(); // userId → Set<hash>
const userStates = new Map();   // userId → { state, ... }

const CATEGORIES = ['ภาษีเงินได้', 'VAT/ภาษีมูลค่าเพิ่ม', 'ภาษีหัก ณ ที่จ่าย', 'ค่าสาธารณูปโภค', 'ค่าเช่า', 'อื่นๆ'];
const THAI_MONTHS = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

function getClient() {
  return new messagingApi.MessagingApiClient({ channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN });
}

async function reply(replyToken, messages) {
  const msgs = Array.isArray(messages) ? messages : [{ type: 'text', text: messages }];
  return getClient().replyMessage({ replyToken, messages: msgs });
}

function fmt(n) { return Number(n).toLocaleString('th-TH'); }

function categoryQR() {
  return { items: CATEGORIES.map(cat => ({ type: 'action', action: { type: 'message', label: cat, text: `หมวดหมู่: ${cat}` } })) };
}

function autoCategory(description) {
  const d = (description ?? '').toLowerCase();
  if (/vat|มูลค่าเพิ่ม|ภ\.พ\./.test(d)) return 'VAT/ภาษีมูลค่าเพิ่ม';
  if (/เงินได้|income tax|ภ\.ง\.ด/.test(d)) return 'ภาษีเงินได้';
  if (/หัก ณ ที่จ่าย|withholding/.test(d)) return 'ภาษีหัก ณ ที่จ่าย';
  if (/ค่าเช่า|rent/.test(d)) return 'ค่าเช่า';
  if (/ไฟฟ้า|น้ำประปา|โทรศัพท์|internet|อินเตอร์เน็ต|utility/.test(d)) return 'ค่าสาธารณูปโภค';
  return 'อื่นๆ';
}

// ── Postback (menu button taps) ───────────────────────────────────────────────

async function handlePostback(event) {
  const { replyToken, source, postback } = event;
  const userId = source.userId;
  const data = postback.data;

  // Menu switches don't need a response
  if (data === 'action=switch_profile' || data === 'action=switch_main') return;

  // ── Send Receipt ──
  if (data === 'action=send_receipt') {
    const name = await getCustomerName(userId);
    if (!name) {
      userStates.set(userId, { state: 'awaiting_name' });
      return reply(replyToken, '👋 ยินดีต้อนรับค่ะ!\nกรุณาพิมพ์ชื่อ-นามสกุลของคุณก่อนนะคะ\n(เพื่อจัดเก็บข้อมูลให้ถูกต้อง)');
    }
    userStates.set(userId, { state: 'awaiting_receipt', batchCount: 0 });
    return reply(replyToken, `📎 สวัสดีคุณ${name}!\nส่งรูปใบเสร็จได้เลยค่ะ ส่งกี่รูปก็ได้\nพิมพ์ "เสร็จ" เมื่อส่งครบค่ะ`);
  }

  // ── Year Summary (Flex) ──
  if (data === 'action=year_summary') {
    const year = new Date().getFullYear();
    const [name, summary] = await Promise.all([
      getCustomerName(userId),
      getYearSummaryForUser(userId, year),
    ]);
    const displayName = name || 'คุณ';
    if (summary.count === 0) return reply(replyToken, `ยังไม่มีข้อมูลการชำระในปี ${year + 543} ค่ะ`);
    return reply(replyToken, [buildYearSummaryFlex(displayName, year, summary)]);
  }

  // ── Tax Calculator ──
  if (data === 'action=calc_tax') {
    const year = new Date().getFullYear();
    const [name, summary] = await Promise.all([
      getCustomerName(userId),
      getYearSummaryForUser(userId, year),
    ]);
    const displayName = name || 'คุณ';
    if (summary.count === 0) {
      return reply(replyToken, `ยังไม่มีข้อมูลรายได้ในปี ${year + 543} ค่ะ\nกรุณาส่งใบเสร็จก่อนนะคะ`);
    }
    const result = calculatePIT(summary.total);
    return reply(replyToken, [buildTaxResultFlex(displayName, result)]);
  }

  // ── Payment History ──
  if (data === 'action=payment_history') {
    const recent = await getRecentPaymentsForUser(userId, 10);
    if (recent.length === 0) return reply(replyToken, 'ยังไม่มีประวัติการชำระเงินค่ะ');

    const lines = recent.map((row, i) => {
      const amount = row[3] ? `฿${fmt(row[3])}` : '-';
      return `${i + 1}. ${row[4] || '-'} [${row[2] || '-'}]\n   ${amount} — ${row[5] || '-'}`;
    });
    return reply(replyToken, `📋 ประวัติล่าสุด\n\n${lines.join('\n\n')}`);
  }

  // ── Help ──
  if (data === 'action=help') {
    return reply(replyToken, `🙋 น้องบัญชีช่วยอะไรได้บ้างค่ะ

📎 ส่งใบเสร็จ — ส่งรูปใบเสร็จได้กี่ใบก็ได้ น้องบัญชีอ่านและบันทึกให้เลยค่ะ
📊 สรุปรายปี — ดูยอดรวมและแยกหมวดหมู่ทั้งปี
🧮 คำนวณภาษี — ประมาณการภาษีที่ต้องจ่ายจากข้อมูลที่มี
📋 ประวัติ — ดูรายการย้อนหลัง 10 รายการ
👤 โปรไฟล์ — จัดการข้อมูลส่วนตัวและค้นหาใบเสร็จ

💬 หรือจะถามอะไรก็ได้ค่ะ เช่น
"ค่าลดหย่อนปีนี้มีอะไรบ้าง"
"VAT ต้องยื่นวันไหน"
"ฉันควรซื้อ RMF ไหม"

พิมพ์ รีเซ็ต เพื่อเริ่มต้นใหม่`);
  }

  // ── Profile: My Info ──
  if (data === 'action=my_info') {
    const [name, profile, stats] = await Promise.all([
      getCustomerName(userId),
      getUserProfile(userId),
      getCustomerStats(userId),
    ]);
    const displayName = name || '(ยังไม่ได้ตั้งชื่อ)';
    return reply(replyToken, [buildProfileFlex(displayName, profile?.displayName, stats)]);
  }

  // ── Profile: Change Name ──
  if (data === 'action=change_name') {
    const currentName = await getCustomerName(userId);
    userStates.set(userId, { state: 'awaiting_new_name' });
    return reply(replyToken, `✏️ ชื่อปัจจุบัน: ${currentName || '(ไม่มี)'}\n\nกรุณาพิมพ์ชื่อใหม่ค่ะ`);
  }

  // ── Profile: Search Receipts ──
  if (data === 'action=search_receipt') {
    userStates.set(userId, { state: 'awaiting_search_query' });
    return reply(replyToken, `🔍 ค้นหาใบเสร็จ\nพิมพ์คำที่ต้องการค้นหาค่ะ เช่น\n"ค่าเช่า"  "มีนาคม"  "VAT"  "2026-05"`);
  }

  // ── Profile: Fix Last Receipt ──
  if (data === 'action=fix_last_receipt') {
    const last = await getLastPaymentForUser(userId);
    if (!last) return reply(replyToken, 'ยังไม่มีรายการที่บันทึกไว้ค่ะ');

    const { sheetRow, data: row } = last;
    userStates.set(userId, { state: 'awaiting_fix_choice', sheetRow, currentData: row });

    return reply(replyToken, [{
      type: 'text',
      text: `📝 รายการล่าสุดค่ะ\n💰 จำนวน: ${row[3] ? `฿${fmt(row[3])}` : '❓'}\n📅 วันที่: ${row[4] || '❓'}\n📂 หมวด: ${row[2] || '❓'}\n📋 รายละเอียด: ${row[5] || '❓'}\n\nต้องการแก้ไขอะไรค่ะ?`,
      quickReply: { items: [
        { type: 'action', action: { type: 'message', label: '💰 แก้จำนวนเงิน', text: 'แก้จำนวนเงิน' } },
        { type: 'action', action: { type: 'message', label: '📅 แก้วันที่', text: 'แก้วันที่' } },
        { type: 'action', action: { type: 'message', label: '📂 แก้หมวดหมู่', text: 'แก้หมวดหมู่' } },
      ]},
    }]);
  }

  // ── Profile: Export Data ──
  if (data === 'action=export_data') {
    const sheetUrl = `https://docs.google.com/spreadsheets/d/${process.env.SPREADSHEET_ID}`;
    return reply(replyToken, `📤 ดาวน์โหลดข้อมูลได้ที่ Google Sheets ค่ะ\n\n${sheetUrl}\n\nสามารถ export เป็น Excel หรือ CSV ได้จากเมนู File > Download ค่ะ`);
  }
}

// ── Image messages ─────────────────────────────────────────────────────────────

async function handleImage(event) {
  const { replyToken, source, message } = event;
  const userId = source.userId;
  const stateObj = userStates.get(userId) ?? {};

  const receiptStates = ['awaiting_receipt', 'awaiting_confirm', 'fix_amount', 'fix_date', 'awaiting_custom_category'];
  if (!receiptStates.includes(stateObj.state)) {
    return reply(replyToken, [{
      type: 'text',
      text: 'กดปุ่ม "ส่งใบเสร็จ" ก่อนส่งรูปนะคะ',
      quickReply: { items: [{ type: 'action', action: { type: 'message', label: '📎 ส่งใบเสร็จ', text: 'ส่งใบเสร็จ' } }] },
    }]);
  }

  const batchCount = (stateObj.batchCount ?? 0) + 1;
  userStates.set(userId, { state: 'awaiting_receipt', batchCount });

  try {
    const [imageBuffer, customerName] = await Promise.all([
      getMessageImageBuffer(message.id),
      getCustomerName(userId),
    ]);

    // Duplicate detection
    const hash = crypto.createHash('sha256').update(imageBuffer).digest('hex').slice(0, 16);
    const userHashes = recentHashes.get(userId) ?? new Set();
    if (userHashes.has(hash)) {
      userStates.set(userId, { state: 'awaiting_receipt', batchCount: batchCount - 1 });
      return reply(replyToken, `⚠️ รูปที่ ${batchCount} ดูเหมือนซ้ำกับที่เคยส่งแล้วนะคะ\nไม่ได้บันทึกซ้ำค่ะ ส่งรูปถัดไปได้เลย`);
    }
    userHashes.add(hash);
    recentHashes.set(userId, userHashes);
    setTimeout(() => userHashes.delete(hash), 24 * 60 * 60 * 1000);

    const data = await extractReceiptData(imageBuffer);

    // Null amount — ask user instead of saving ฿0
    if (data.amount === null || data.amount === undefined) {
      userStates.set(userId, { state: 'awaiting_batch_amount', batchCount, pendingReceipt: { data, imageBuffer, messageId: message.id, customerName } });
      return reply(replyToken, `📷 รูปที่ ${batchCount} — อ่านข้อความได้ค่ะ แต่ไม่พบยอดเงิน\n\n📝 ${data.description || '(ไม่มีรายละเอียด)'}\n📅 ${data.date || 'ไม่พบวันที่'}\n\nกรุณาพิมพ์จำนวนเงิน (ตัวเลขเท่านั้น เช่น 2500):`);
    }

    const category = autoCategory(data.description);
    const displayName = data.payerName || customerName || 'ลูกค้า';

    let imageUrl = null;
    try {
      const filename = `${displayName}_${data.date || new Date().toISOString().slice(0, 10)}_${data.amount}THB_${message.id.slice(-6)}.jpg`;
      imageUrl = await uploadReceiptImage(imageBuffer, displayName, filename);
    } catch (e) { console.error('Drive upload:', e.message); }

    await appendPayment({ userId, customerName: displayName, category, amount: data.amount, date: data.date, description: data.description, rawText: data.rawText, imageUrl });

    const imgNote = imageUrl ? '\n🖼 รูปบันทึกใน Drive แล้ว' : '';
    await reply(replyToken, `✅ รูปที่ ${batchCount} บันทึกแล้วค่ะ\n💰 ฿${fmt(data.amount)}  📅 ${data.date || '❓'}\n📂 ${category}  👤 ${displayName}${imgNote}\n\n📎 ส่งรูปถัดไปได้เลย หรือพิมพ์ "เสร็จ"`);

  } catch (err) {
    console.error('OCR error:', err.message);
    userStates.set(userId, { state: 'awaiting_receipt', batchCount: batchCount - 1 });
    await reply(replyToken, `❌ รูปที่ ${batchCount} อ่านไม่ได้ค่ะ\nกรุณาถ่ายใหม่ให้ชัด แสงพอ ไม่สั่น`);
  }
}

// ── Text messages ─────────────────────────────────────────────────────────────

async function handleTextMessage(event) {
  const { replyToken, source, message } = event;
  const userId = source.userId;
  const text = message.text.trim();
  const stateObj = userStates.get(userId) ?? {};

  // Global commands
  if (text === 'รีเซ็ต' || text.toLowerCase() === 'reset') {
    userStates.delete(userId);
    clearHistory(userId);
    return reply(replyToken, '🔄 รีเซ็ตแล้วค่ะ');
  }

  // End batch session
  if ((text === 'เสร็จ' || text === 'จบ') && (stateObj.batchCount ?? 0) > 0) {
    const count = stateObj.batchCount;
    userStates.delete(userId);
    const year = new Date().getFullYear();
    const [summary, name] = await Promise.all([
      getYearSummaryForUser(userId, year).catch(() => null),
      getCustomerName(userId),
    ]);
    const totalStr = summary ? `฿${fmt(summary.total)}` : '-';
    return reply(replyToken, [
      buildYearSummaryFlex(name || 'คุณ', year, summary ?? { total: 0, count: 0, byCategory: {}, byMonth: {} }),
      { type: 'text', text: `🎉 เสร็จแล้วค่ะ! บันทึกไป ${count} รูป\nยอดรวมทั้งปี ${year + 543}: ${totalStr}` },
    ]);
  }

  // Text shortcuts for menu buttons
  if (text === 'ส่งใบเสร็จ') return handlePostback({ replyToken, source, postback: { data: 'action=send_receipt' } });
  if (text === 'สรุปรายปี') return handlePostback({ replyToken, source, postback: { data: 'action=year_summary' } });
  if (text === 'คำนวณภาษี' || text === 'คำนวณภาษีปีนี้') return handlePostback({ replyToken, source, postback: { data: 'action=calc_tax' } });
  if (text === 'ช่วยเหลือ' || text === 'help') return handlePostback({ replyToken, source, postback: { data: 'action=help' } });
  if (text === 'โปรไฟล์' || text === 'ข้อมูลของฉัน') return handlePostback({ replyToken, source, postback: { data: 'action=my_info' } });
  if (text === 'ประวัติ') return handlePostback({ replyToken, source, postback: { data: 'action=payment_history' } });

  // ── State: awaiting_name (first time) ──
  if (stateObj.state === 'awaiting_name') {
    const profile = await getUserProfile(userId);
    await saveCustomerName(userId, profile.displayName, text);
    userStates.set(userId, { state: 'awaiting_receipt', batchCount: 0 });
    return reply(replyToken, `✅ บันทึกชื่อ "${text}" แล้วค่ะ\n\n📎 ส่งรูปใบเสร็จได้เลยค่ะ ส่งกี่ใบก็ได้\nพิมพ์ "เสร็จ" เมื่อส่งครบ`);
  }

  // ── State: awaiting_new_name (change name) ──
  if (stateObj.state === 'awaiting_new_name') {
    await updateCustomerName(userId, text);
    userStates.delete(userId);
    return reply(replyToken, `✅ เปลี่ยนชื่อเป็น "${text}" แล้วค่ะ`);
  }

  // ── State: awaiting_search_query ──
  if (stateObj.state === 'awaiting_search_query') {
    userStates.delete(userId);
    const results = await searchPaymentsForUser(userId, text);
    return reply(replyToken, [buildSearchResultsFlex(results, text)]);
  }

  // ── State: awaiting_batch_amount (null OCR amount in batch mode) ──
  if (stateObj.state === 'awaiting_batch_amount') {
    const amount = parseFloat(text.replace(/,/g, ''));
    if (isNaN(amount) || amount <= 0) return reply(replyToken, '❌ กรุณาพิมพ์ตัวเลขเท่านั้น เช่น 2500');

    const { pendingReceipt, batchCount } = stateObj;
    const { data, imageBuffer, messageId, customerName } = pendingReceipt;
    const category = autoCategory(data.description);
    const displayName = data.payerName || customerName || 'ลูกค้า';

    let imageUrl = null;
    try {
      const filename = `${displayName}_${data.date || new Date().toISOString().slice(0, 10)}_${amount}THB_${messageId?.slice(-6) ?? 'x'}.jpg`;
      imageUrl = await uploadReceiptImage(imageBuffer, displayName, filename);
    } catch (e) { console.error('Drive upload:', e.message); }

    await appendPayment({ userId, customerName: displayName, category, amount, date: data.date, description: data.description, rawText: data.rawText, imageUrl });

    userStates.set(userId, { state: 'awaiting_receipt', batchCount });
    return reply(replyToken, `✅ รูปที่ ${batchCount} บันทึกแล้วค่ะ\n💰 ฿${fmt(amount)}  📅 ${data.date || '❓'}\n📂 ${category}\n\n📎 ส่งรูปถัดไปได้เลย หรือพิมพ์ "เสร็จ"`);
  }

  // ── State: awaiting_fix_choice (fix last receipt) ──
  if (stateObj.state === 'awaiting_fix_choice') {
    if (text === 'แก้จำนวนเงิน') {
      userStates.set(userId, { ...stateObj, state: 'fixing_last_amount' });
      return reply(replyToken, `💰 จำนวนปัจจุบัน: ${stateObj.currentData[3] ? `฿${fmt(stateObj.currentData[3])}` : '❓'}\nกรุณาพิมพ์จำนวนเงินที่ถูกต้อง:`);
    }
    if (text === 'แก้วันที่') {
      userStates.set(userId, { ...stateObj, state: 'fixing_last_date' });
      return reply(replyToken, `📅 วันที่ปัจจุบัน: ${stateObj.currentData[4] || '❓'}\nกรุณาพิมพ์วันที่ (YYYY-MM-DD เช่น 2026-06-15):`);
    }
    if (text === 'แก้หมวดหมู่') {
      userStates.set(userId, { ...stateObj, state: 'fixing_last_category' });
      return reply(replyToken, [{ type: 'text', text: 'กรุณาเลือกหมวดหมู่ใหม่:', quickReply: categoryQR() }]);
    }
  }

  // ── State: fixing_last_amount ──
  if (stateObj.state === 'fixing_last_amount') {
    const amount = parseFloat(text.replace(/,/g, ''));
    if (isNaN(amount) || amount <= 0) return reply(replyToken, '❌ กรุณาพิมพ์ตัวเลขเท่านั้น เช่น 2500');
    await updatePaymentRow(stateObj.sheetRow, { amount });
    userStates.delete(userId);
    return reply(replyToken, `✅ แก้ไขจำนวนเงินเป็น ฿${fmt(amount)} แล้วค่ะ`);
  }

  // ── State: fixing_last_date ──
  if (stateObj.state === 'fixing_last_date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return reply(replyToken, '❌ รูปแบบไม่ถูกต้อง เช่น 2026-06-15');
    await updatePaymentRow(stateObj.sheetRow, { date: text });
    userStates.delete(userId);
    return reply(replyToken, `✅ แก้ไขวันที่เป็น ${text} แล้วค่ะ`);
  }

  // ── State: fixing_last_category ──
  if (stateObj.state === 'fixing_last_category') {
    const cat = text.replace(/^หมวดหมู่:\s*/, '').trim();
    await updatePaymentRow(stateObj.sheetRow, { category: cat });
    userStates.delete(userId);
    return reply(replyToken, `✅ แก้ไขหมวดหมู่เป็น "${cat}" แล้วค่ะ`);
  }

  // ── Remaining old states (confirm flow) ──
  if (stateObj.state === 'awaiting_confirm') {
    if (text === 'ยืนยัน: ถูกต้อง') {
      userStates.set(userId, { ...stateObj, state: 'awaiting_category' });
      return reply(replyToken, [{ type: 'text', text: 'กรุณาเลือกหมวดหมู่:', quickReply: categoryQR() }]);
    }
    if (text === 'แก้ไข: จำนวน') {
      userStates.set(userId, { ...stateObj, state: 'fix_amount' });
      return reply(replyToken, `💰 จำนวนปัจจุบัน: ${stateObj.pendingReceipt.data.amount ?? 'ไม่พบ'}\nพิมพ์จำนวนที่ถูกต้อง:`);
    }
    if (text === 'แก้ไข: วันที่') {
      userStates.set(userId, { ...stateObj, state: 'fix_date' });
      return reply(replyToken, `📅 วันที่ปัจจุบัน: ${stateObj.pendingReceipt.data.date ?? 'ไม่พบ'}\nพิมพ์วันที่ (YYYY-MM-DD):`);
    }
    if (text === 'ยกเลิก: ส่งใหม่') {
      userStates.set(userId, { state: 'awaiting_receipt' });
      return reply(replyToken, '🔄 ส่งรูปใหม่ได้เลยค่ะ');
    }
  }

  if (stateObj.state === 'fix_amount') {
    const amount = parseFloat(text.replace(/,/g, ''));
    if (isNaN(amount)) return reply(replyToken, '❌ พิมพ์ตัวเลขเท่านั้น เช่น 2500');
    userStates.set(userId, { ...stateObj, state: 'awaiting_confirm', pendingReceipt: { ...stateObj.pendingReceipt, data: { ...stateObj.pendingReceipt.data, amount } } });
    return reply(replyToken, `✅ แก้จำนวนเป็น ฿${fmt(amount)} แล้วค่ะ ข้อมูลถูกต้องไหม?`, /* ... */);
  }

  if (stateObj.state === 'fix_date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return reply(replyToken, '❌ รูปแบบไม่ถูกต้อง เช่น 2026-06-15');
    userStates.set(userId, { ...stateObj, state: 'awaiting_category', pendingReceipt: { ...stateObj.pendingReceipt, data: { ...stateObj.pendingReceipt.data, date: text } } });
    return reply(replyToken, [{ type: 'text', text: 'กรุณาเลือกหมวดหมู่:', quickReply: categoryQR() }]);
  }

  if (stateObj.state === 'awaiting_category') {
    const cat = text.replace(/^หมวดหมู่:\s*/, '').trim();
    if (cat === 'อื่นๆ') {
      userStates.set(userId, { ...stateObj, state: 'awaiting_custom_category' });
      return reply(replyToken, 'กรุณาพิมพ์หมวดหมู่ที่ต้องการ:');
    }
    return saveConfirmedReceipt(userId, cat, stateObj.pendingReceipt, replyToken);
  }

  if (stateObj.state === 'awaiting_custom_category') {
    return saveConfirmedReceipt(userId, text.trim(), stateObj.pendingReceipt, replyToken);
  }

  // ── Default: AI assistant ──
  try {
    const year = new Date().getFullYear();
    const [customerName, summary, recent] = await Promise.all([
      getCustomerName(userId),
      getYearSummaryForUser(userId, year).catch(() => null),
      getRecentPaymentsForUser(userId, 5).catch(() => []),
    ]);
    const customerData = customerName ? { name: customerName, year, summary, recent } : null;
    const answer = await askAssistant(userId, text, customerData);
    return reply(replyToken, answer);
  } catch (err) {
    console.error('AI error:', err.message);
    return reply(replyToken, `❌ เกิดข้อผิดพลาด กรุณาลองใหม่ค่ะ`);
  }
}

async function saveConfirmedReceipt(userId, category, pendingReceipt, replyToken) {
  userStates.delete(userId);
  const { data, imageBuffer, messageId } = pendingReceipt;
  const customerName = await getCustomerName(userId);

  let imageUrl = null;
  if (imageBuffer) {
    try {
      const filename = `${customerName}_${data.date || new Date().toISOString().slice(0, 10)}_${data.amount ?? 0}THB_${messageId?.slice(-6) ?? 'manual'}.jpg`;
      imageUrl = await uploadReceiptImage(imageBuffer, customerName, filename);
    } catch (e) { console.error('Drive upload:', e.message); }
  }

  await appendPayment({ userId, customerName, category, amount: data.amount, date: data.date, description: data.description, rawText: data.rawText, imageUrl });

  const amountStr = data.amount != null ? `฿${fmt(data.amount)}` : 'ไม่ระบุ';
  await reply(replyToken, `✅ บันทึกสำเร็จค่ะ!\n👤 ${customerName}\n📂 ${category}\n💰 ${amountStr}\n📅 ${data.date || 'ไม่ระบุ'}`);
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function handleEvent(event) {
  try {
    if (event.type === 'postback') return handlePostback(event);
    if (event.type === 'message' && event.message.type === 'image') return handleImage(event);
    if (event.type === 'message' && event.message.type === 'text') return handleTextMessage(event);
    if (event.type === 'follow') {
      const profile = await getUserProfile(event.source.userId).catch(() => ({ displayName: 'คุณ' }));
      return reply(event.replyToken,
        `สวัสดีค่ะ คุณ${profile.displayName}! 🙏\n\nหนูชื่อ "น้องบัญชี" ผู้ช่วยบัญชีส่วนตัวของคุณค่ะ ✨\n\n` +
        `📎 กด "ส่งใบเสร็จ" — บันทึกใบเสร็จ ส่งกี่ใบก็ได้\n` +
        `📊 กด "สรุปรายปี" — ดูยอดรวมและ Flex Card สวยๆ\n` +
        `🧮 กด "คำนวณภาษี" — ประมาณการภาษีจากข้อมูลของคุณ\n` +
        `👤 กด "โปรไฟล์" — จัดการข้อมูล ค้นหา และแก้ไขรายการ\n` +
        `💬 หรือถามอะไรก็ได้เลยค่ะ เช่น "ค่าลดหย่อนปีนี้มีอะไรบ้าง"\n\n` +
        `กรุณาพิมพ์ชื่อ-นามสกุลของคุณเพื่อเริ่มต้นใช้งานค่ะ`
      );
    }
  } catch (err) {
    console.error(`Error [${event.type}]:`, err.message);
  }
}

module.exports = { handleEvent };
