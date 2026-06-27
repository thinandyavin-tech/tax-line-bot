const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const PERSONALITY = `คุณคือ "น้องบัญชี" ผู้ช่วยบัญชีส่วนตัวที่ฉลาด เป็นมิตร และเชี่ยวชาญด้านภาษีและบัญชีไทย
คุณทำงานให้กับลูกค้าแต่ละคนอย่างใกล้ชิด รู้จักประวัติการชำระเงินของพวกเขา และพร้อมช่วยเหลือทุกเรื่องที่เกี่ยวกับบัญชีและภาษี

บุคลิก:
- พูดภาษาไทยเป็นธรรมชาติ ใช้คำว่า "ค่ะ" ลงท้าย (สุภาพแต่ไม่ทางการเกินไป)
- เรียกลูกค้าว่า "คุณ[ชื่อ]" เสมอ
- ตอบสั้น กระชับ ตรงประเด็น ไม่พูดวกวน
- ถ้าลูกค้าถามเรื่องตัวเลข ให้คำนวณให้เลยพร้อมแสดงขั้นตอน
- ถ้าลูกค้าถามเรื่องที่ไม่เกี่ยวกับบัญชี/ภาษี ให้บอกอย่างสุภาพว่าเชี่ยวชาญเฉพาะด้านนี้
- ใช้ emoji ช่วยสื่อสารได้ แต่ไม่ใช้เยอะเกิน
- ถ้ามีข้อมูลของลูกค้า ให้นำมาอ้างอิงในคำตอบด้วย

สิ่งที่น้องบัญชีทำได้:
✅ คำนวณภาษีและค่าลดหย่อน
✅ สรุปและวิเคราะห์ประวัติการชำระเงินของลูกค้า
✅ แจ้งกำหนดการยื่นแบบภาษีที่ใกล้ถึง
✅ แนะนำวิธีวางแผนภาษี
✅ ตอบคำถามทุกอย่างเกี่ยวกับภาษีและบัญชีไทย
✅ ช่วยตรวจสอบว่ารายการไหนลดหย่อนได้บ้าง`;

const TAX_KNOWLEDGE = `
=== ความรู้ภาษีไทย ===

ภาษีเงินได้บุคคลธรรมดา (PIT) อัตราก้าวหน้า:
0-150,000 = ยกเว้น | 150,001-300,000 = 5% | 300,001-500,000 = 10% | 500,001-750,000 = 15%
750,001-1,000,000 = 20% | 1,000,001-2,000,000 = 25% | 2,000,001-5,000,000 = 30% | >5,000,000 = 35%

ค่าลดหย่อนหลัก: ส่วนตัว 60,000 | คู่สมรส 60,000 | บุตร 30,000/คน | บิดามารดา 30,000/คน
ประกันชีวิต สูงสุด 100,000 | ประกันสุขภาพ 25,000 | SSF 30% ไม่เกิน 200,000 | RMF 30% ไม่เกิน 500,000
ดอกเบี้ยบ้าน 100,000 | Thai ESG 300,000 | ประกันสังคม ~9,000

CIT: 20% ทั่วไป | SME (ทุน≤5ล้าน, รายได้≤30ล้าน): 0-300k=ยกเว้น, 300k-3M=15%, >3M=20%
VAT: 7% | จดทะเบียนเมื่อรายได้ >1.8ล้าน/ปี | ยื่น ภ.พ.30 ทุกเดือน ภายในวันที่ 15 (ออนไลน์ 23)
WHT: ค่าจ้าง/บริการ 3% | ค่าเช่า 5% | เงินปันผล 10% | ดอกเบี้ย(บุคคล) 15%
ประกันสังคม: นายจ้าง+ลูกจ้าง = 5%+5% ของค่าจ้าง (ฐาน 1,650-15,000 บาท)

กำหนดสำคัญ:
- ภ.ง.ด.90/91: มีนาคม (กระดาษ) / เมษายน (ออนไลน์) ของปีถัดไป
- ภ.ง.ด.50: ภายใน 150 วันหลังสิ้นรอบบัญชี
- ภ.ง.ด.1/3/53: ทุกเดือน ภายในวันที่ 7 (ออนไลน์ 15)
- ภ.พ.30: ทุกเดือน ภายในวันที่ 15 (ออนไลน์ 23)`;

const userHistory = new Map();
const MAX_HISTORY = 8;

function buildSystemPrompt(customerData) {
  let prompt = PERSONALITY + TAX_KNOWLEDGE;

  if (!customerData) return prompt;

  const { name, year, summary, recent } = customerData;

  prompt += `\n\n=== ข้อมูลของคุณ${name} ===\n`;
  prompt += `ชื่อลูกค้า: ${name}\n`;

  if (summary && summary.count > 0) {
    prompt += `\nสรุปปี ${year + 543} (${year}):\n`;
    prompt += `  ยอดรวมทั้งปี: ฿${summary.total.toLocaleString('th-TH')} จาก ${summary.count} รายการ\n`;

    if (Object.keys(summary.byCategory).length > 0) {
      prompt += `  แบ่งตามหมวดหมู่:\n`;
      for (const [cat, amt] of Object.entries(summary.byCategory)) {
        prompt += `    - ${cat}: ฿${amt.toLocaleString('th-TH')}\n`;
      }
    }

    if (Object.keys(summary.byMonth).length > 0) {
      const months = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
      prompt += `  แบ่งตามเดือน:\n`;
      for (const [ym, amt] of Object.entries(summary.byMonth).sort()) {
        const m = parseInt(ym.split('-')[1], 10);
        prompt += `    - ${months[m]}: ฿${amt.toLocaleString('th-TH')}\n`;
      }
    }
  } else {
    prompt += `  ยังไม่มีรายการชำระในปี ${year + 543}\n`;
  }

  if (recent && recent.length > 0) {
    prompt += `\nรายการล่าสุด:\n`;
    for (const row of recent.slice(0, 5)) {
      const date = row[4] || '-';
      const amount = row[3] ? `฿${Number(row[3]).toLocaleString('th-TH')}` : '-';
      const cat = row[2] || '-';
      const desc = row[5] || '';
      prompt += `  - ${date} | ${amount} | ${cat}${desc ? ` | ${desc}` : ''}\n`;
    }
  }

  const today = new Date();
  const month = today.getMonth() + 1;
  const day = today.getDate();
  prompt += `\nวันนี้: ${today.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })} (${today.toISOString().slice(0, 10)})\n`;

  // Upcoming deadlines this month
  const deadlines = [];
  if (day <= 7) deadlines.push('ภ.ง.ด.1/3/53 (หัก ณ ที่จ่าย) ครบกำหนด วันที่ 7');
  if (day <= 15) deadlines.push('ภ.พ.30 (VAT) ครบกำหนด วันที่ 15');
  if (day <= 23) deadlines.push('ภ.ง.ด.1/3/53 ออนไลน์ ครบกำหนด วันที่ 15 | ภ.พ.30 ออนไลน์ ครบกำหนด วันที่ 23');
  if (month === 3 && day <= 31) deadlines.push('ภ.ง.ด.91 (ภาษีเงินได้ปีที่แล้ว) ครบกำหนด 31 มีนาคม');
  if (month === 4 && day <= 8) deadlines.push('ภ.ง.ด.91 ออนไลน์ ครบกำหนด 8 เมษายน');
  if (deadlines.length > 0) {
    prompt += `กำหนดชำระที่ใกล้ถึงเดือนนี้:\n${deadlines.map(d => `  ⚠️ ${d}`).join('\n')}\n`;
  }

  return prompt;
}

async function askAssistant(userId, question, customerData) {
  const history = userHistory.get(userId) ?? [];
  const systemPrompt = buildSystemPrompt(customerData);

  const response = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: question },
    ],
    max_tokens: 1000,
    temperature: 0.4,
  });

  const answer = response.choices[0].message.content.trim();

  const updated = [
    ...history,
    { role: 'user', content: question },
    { role: 'assistant', content: answer },
  ].slice(-MAX_HISTORY);
  userHistory.set(userId, updated);

  return answer;
}

function clearHistory(userId) {
  userHistory.delete(userId);
}

module.exports = { askAssistant, clearHistory };
