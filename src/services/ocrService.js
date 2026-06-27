const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const RECEIPT_PROMPT = `You are analyzing a Thai tax payment receipt, financial statement, or payment slip.
Extract the following information from the image:
1. Payment amount in Thai Baht (THB) — numbers only, no commas
2. Payment date — in YYYY-MM-DD format
3. Description — what was paid for (e.g. income tax, VAT, withholding tax, utility, etc.)
4. Payer name — the name of the person or company paying (if visible)

Return ONLY a valid JSON object with exactly these fields:
{
  "amount": <number or null>,
  "date": "<YYYY-MM-DD string or null>",
  "description": "<brief description in English or Thai or null>",
  "payerName": "<name or null>"
}

If you cannot confidently extract a value, use null. Do not include any text outside the JSON.`;

async function extractReceiptData(imageBuffer, mimeType = 'image/jpeg') {
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  const imagePart = {
    inlineData: {
      data: imageBuffer.toString('base64'),
      mimeType,
    },
  };

  const result = await model.generateContent([RECEIPT_PROMPT, imagePart]);
  const text = result.response.text().trim();

  // Strip markdown code fences if Gemini wraps the JSON
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(cleaned);
}

module.exports = { extractReceiptData };
