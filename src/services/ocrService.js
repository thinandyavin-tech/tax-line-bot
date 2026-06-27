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
const PARSE_PROMPT = `คุณคือผู้เชี่ยวชาญอ่านใบเสร็จไทย

จากข้อความดิบ ให้ดึงข้อมูลต่อไปนี้:
1. "amount" — ยอดเงินสุดท้าย (ไม่ใช่ subtotal) ให้เป็นตัวเลขล้วน ไม่มี comma (เช่น 1500 ไม่ใช่ "1,500")
2. "date" — วันที่ในรูป YYYY-MM-DD (แปลง พ.ศ.→ค.ศ. โดยลบ 543)
3. "description" — ชื่อร้าน/ประเภทการชำระ/ภาษีอะไร
4. "payerName" — ชื่อผู้ชำระ (จาก "จาก:", "ชื่อผู้โอน:", "ลูกค้า:", "From:" ถ้ามี)

ส่งกลับ JSON เท่านั้น ไม่มีข้อความอื่น:
{"amount":<number|null>,"date":"<YYYY-MM-DD|null>","description":"<string|null>","payerName":"<string|null>"}`;

async function parseStructured(rawText) {
  const response = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: PARSE_PROMPT },
      { role: 'user', content: rawText },
    ],
    max_tokens: 300,
    temperature: 0,
    response_format: { type: 'json_object' },
  });
  return JSON.parse(response.choices[0].message.content.trim());
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

module.exports = { extractReceiptData };
