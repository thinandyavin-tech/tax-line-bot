const Groq = require('groq-sdk');
const sharp = require('sharp');
const { google } = require('googleapis');
const path = require('path');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ── Image preprocessing ───────────────────────────────────────────────────────
// Grayscale + auto-contrast + sharpen + resize makes text pop before OCR
async function preprocessImage(buffer) {
  return sharp(buffer)
    .rotate()                           // fix EXIF rotation
    .grayscale()
    .normalize()                        // auto-contrast
    .sharpen({ sigma: 2, m1: 1 })
    .resize({ width: 2000, withoutEnlargement: true })
    .jpeg({ quality: 95 })
    .toBuffer();
}

// ── Google Cloud Vision (primary — best Thai OCR) ────────────────────────────
async function extractTextVision(imageBuffer) {
  let auth;
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
    auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
  } else {
    auth = new google.auth.GoogleAuth({
      keyFile: path.resolve(process.env.GOOGLE_SERVICE_ACCOUNT_KEY),
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
  }

  const client = await auth.getClient();
  const tokenObj = await client.getAccessToken();

  const res = await fetch('https://vision.googleapis.com/v1/images:annotate', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenObj.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{
        image: { content: imageBuffer.toString('base64') },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
        imageContext: { languageHints: ['th', 'en'] },
      }],
    }),
  });

  const data = await res.json();

  if (data.responses?.[0]?.error) throw new Error(data.responses[0].error.message);

  const text = data.responses?.[0]?.fullTextAnnotation?.text ?? '';
  if (!text) throw new Error('No text found in image');
  return text;
}

// ── Groq Vision (fallback — if Cloud Vision not enabled yet) ─────────────────
async function extractTextGroq(imageBuffer) {
  const response = await groq.chat.completions.create({
    model: 'meta-llama/llama-4-maverick-17b-128e-instruct',
    messages: [{
      role: 'user',
      content: [
        {
          type: 'text',
          text: `อ่านข้อความทุกตัวอักษรในรูปนี้แบบ verbatim ทั้งภาษาไทยและอังกฤษ รวมถึงตัวเลข วันที่ และสัญลักษณ์ทุกอย่าง
เลขไทย ๐-๙ ให้แปลงเป็น 0-9 ด้วย
ห้ามสรุปหรือแปล ให้คัดลอกทุกบรรทัดตามที่เห็น`,
        },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}` } },
      ],
    }],
    max_tokens: 1500,
    temperature: 0,
  });
  return response.choices[0].message.content.trim();
}

// ── Parser: Groq text model extracts structured fields from raw text ──────────
const PARSE_PROMPT = `คุณคือผู้เชี่ยวชาญอ่านใบเสร็จและ statement ไทย

จากข้อความดิบ ให้ดึงข้อมูลต่อไปนี้ครบถ้วน:
1. "amount"        — ยอดรวมสุดท้ายที่ต้องจ่าย (Grand Total) ตัวเลขล้วน ไม่มี comma
2. "subtotal"      — ยอดก่อน VAT ถ้ามี (ตัวเลขล้วน) ถ้าไม่มีให้ส่ง null
3. "vatAmount"     — จำนวน VAT ถ้าระบุแยก (ตัวเลขล้วน) ถ้าไม่มีให้ส่ง null
4. "vatRate"       — อัตรา VAT เช่น 7 (ตัวเลขล้วน %) ถ้าไม่มีให้ส่ง null
5. "date"          — วันที่ YYYY-MM-DD (แปลง พ.ศ.→ค.ศ. ลบ 543) ถ้าไม่พบให้ส่ง null
6. "merchant"      — ชื่อร้าน/บริษัท/หน่วยงานที่รับเงิน
7. "description"   — ประเภทการชำระ/รายการสินค้าหลัก เช่น "ค่า VAT", "ค่าเช่า", "อาหาร"
8. "payerName"     — ชื่อผู้ชำระ (จาก "จาก:", "ผู้โอน:", "ลูกค้า:", "From:", "Payer:") ถ้าไม่มีให้ส่ง null
9. "receiptNo"     — เลขที่ใบเสร็จ/reference number ถ้ามี ถ้าไม่มีให้ส่ง null
10. "paymentMethod" — วิธีชำระ เช่น "โอนเงิน", "เงินสด", "บัตรเครดิต", "QR Code" ถ้าไม่ระบุให้ส่ง null

ส่งกลับ JSON เท่านั้น ไม่มีข้อความอื่น:
{"amount":<number|null>,"subtotal":<number|null>,"vatAmount":<number|null>,"vatRate":<number|null>,"date":"<YYYY-MM-DD|null>","merchant":"<string|null>","description":"<string|null>","payerName":"<string|null>","receiptNo":"<string|null>","paymentMethod":"<string|null>"}`;

// Parse a bank statement PDF for multiple transactions
const STATEMENT_PROMPT = `คุณคือผู้เชี่ยวชาญอ่าน Bank Statement / Statement ธนาคารไทย

จากข้อความ statement ให้หาทุกรายการ "รายจ่าย" หรือ "เดบิต" (ไม่เอารายรับ) แล้วส่งคืนเป็น JSON array
แต่ละรายการประกอบด้วย:
- "date": "YYYY-MM-DD" (แปลง พ.ศ.→ค.ศ.)
- "amount": ตัวเลขล้วน ไม่มี comma
- "description": รายละเอียดรายการ
- "balance": ยอดคงเหลือหลังรายการ (ถ้ามี)

ส่งกลับ JSON เท่านั้น: {"transactions":[{"date":"...","amount":...,"description":"...","balance":...},...]}
ถ้าไม่พบรายการให้ส่ง {"transactions":[]}`;

async function parseStructured(rawText) {
  const response = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: PARSE_PROMPT },
      { role: 'user', content: rawText },
    ],
    max_tokens: 500,
    temperature: 0,
    response_format: { type: 'json_object' },
  });
  return JSON.parse(response.choices[0].message.content.trim());
}

async function parseStatement(rawText) {
  const response = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: STATEMENT_PROMPT },
      { role: 'user', content: rawText },
    ],
    max_tokens: 2000,
    temperature: 0,
    response_format: { type: 'json_object' },
  });
  const parsed = JSON.parse(response.choices[0].message.content.trim());
  return parsed.transactions ?? [];
}

// ── Main export ───────────────────────────────────────────────────────────────
async function extractReceiptData(imageBuffer) {
  const enhanced = await preprocessImage(imageBuffer);

  // Try Google Vision first (best accuracy); fall back to Groq Vision
  let rawText;
  let engine = 'Google Vision';
  try {
    rawText = await extractTextVision(enhanced);
  } catch (visionErr) {
    console.warn('Cloud Vision failed, falling back to Groq Vision:', visionErr.message);
    engine = 'Groq Vision';
    rawText = await extractTextGroq(enhanced);
  }

  console.log(`[OCR] engine=${engine}, chars=${rawText.length}`);

  const structured = await parseStructured(rawText);
  return { ...structured, rawText, engine };
}

// ── Parse text from a PDF file (bank statement / receipt PDF) ────────────────
async function extractPdfData(pdfBuffer) {
  const pdfParse = require('pdf-parse');
  const data = await pdfParse(pdfBuffer);
  const rawText = data.text;
  console.log(`[PDF] pages=${data.numpages}, chars=${rawText.length}`);
  // Try single receipt first
  const structured = await parseStructured(rawText);
  // Also try statement parsing
  const transactions = await parseStatement(rawText);
  return { rawText, structured, transactions };
}

module.exports = { extractReceiptData, extractPdfData };
