const Groq = require('groq-sdk');
const sharp = require('sharp');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Preprocess image: grayscale + auto-contrast + sharpen + resize
// This dramatically improves OCR accuracy on blurry/dark/skewed photos
async function preprocessImage(buffer) {
  return sharp(buffer)
    .rotate()                          // auto-rotate from EXIF
    .grayscale()                       // remove colour noise
    .normalize()                       // stretch contrast to full range
    .sharpen({ sigma: 1.5, m1: 0.5 }) // cripen blurry edges
    .resize({ width: 1600, withoutEnlargement: true }) // ensure readable resolution
    .jpeg({ quality: 95 })
    .toBuffer();
}

// Step 1 — extract every character visible in the image
const RAW_TEXT_PROMPT = `You are an expert OCR system specialising in Thai financial documents.

Transcribe EVERY piece of text you can see in this image, exactly as it appears.
Include ALL of the following:
- Numbers (amounts, dates, reference numbers, account numbers)
- Thai text (ภาษาไทย) — keep it in Thai
- English text — keep it in English
- Symbols (฿, %, /, -)
- Table/grid content, headers, footers, stamps, watermarks

Common Thai receipt types you may see:
- ใบเสร็จรับเงิน (official receipt)
- ใบกำกับภาษี (tax invoice)
- สลิปโอนเงิน (bank transfer slip) — shows ธนาคาร, จาก, ไปยัง, จำนวน, วันที่
- QR payment receipt — shows ร้านค้า, จำนวนเงิน, วันเวลา
- PromptPay / พร้อมเพย์ slip
- บัตรเครดิต / debit receipt

Thai date formats to watch for:
- วว/ดด/ปปปป เช่น 27/06/2569 (ปี พ.ศ. ให้ลบ 543 เพื่อได้ปี ค.ศ.)
- วว เดือนภาษาไทย ปปปป เช่น 27 มิถุนายน 2569
- DD/MM/YYYY (ค.ศ.)

Thai numerals: ๐=0 ๑=1 ๒=2 ๓=3 ๔=4 ๕=5 ๖=6 ๗=7 ๘=8 ๙=9

Output every line you see, don't skip anything.`;

// Step 2 — parse structured data from raw text
const PARSE_PROMPT = `You are a Thai receipt data extractor.

Given the raw text from a Thai receipt, extract:
1. Total amount paid in Thai Baht (the FINAL amount — look for: ยอดรวม, รวมทั้งสิ้น, จำนวนเงิน, Total, Amount, ยอดชำระ, net amount — NOT subtotals or VAT lines alone)
2. Transaction/payment date (convert Buddhist Era พ.ศ. to CE by subtracting 543)
3. Description of what was paid (merchant name, service, tax type, etc.)
4. Payer name (ชื่อผู้โอน, จาก, From, ชื่อลูกค้า — if visible)

Rules:
- Amount: strip commas, return as plain number (e.g. 1500.00 not "1,500.00")
- Date: return as YYYY-MM-DD
- If multiple amounts exist, pick the total/grand total
- If amount has VAT included, return the total including VAT
- Return ONLY this JSON, nothing else:

{"amount": <number or null>, "date": "<YYYY-MM-DD or null>", "description": "<text or null>", "payerName": "<name or null>"}`;

async function extractRawText(imageBuffer) {
  const base64 = imageBuffer.toString('base64');
  const response = await groq.chat.completions.create({
    model: 'meta-llama/llama-4-maverick-17b-128e-instruct',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: RAW_TEXT_PROMPT },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
      ],
    }],
    max_tokens: 1500,
    temperature: 0,
  });
  return response.choices[0].message.content.trim();
}

async function parseReceiptText(rawText) {
  const response = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: PARSE_PROMPT },
      { role: 'user', content: `Raw receipt text:\n\n${rawText}` },
    ],
    max_tokens: 300,
    temperature: 0,
    response_format: { type: 'json_object' },
  });
  const text = response.choices[0].message.content.trim();
  return JSON.parse(text);
}

async function extractReceiptData(imageBuffer) {
  const enhanced = await preprocessImage(imageBuffer);
  const rawText = await extractRawText(enhanced);
  const structured = await parseReceiptText(rawText);
  return { ...structured, rawText };
}

module.exports = { extractReceiptData };
