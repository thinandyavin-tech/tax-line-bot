const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const RECEIPT_PROMPT = `You are analyzing a Thai tax payment receipt, financial statement, or payment slip.
Extract the following information:
1. Payment amount in Thai Baht — numbers only, no commas or currency symbols
2. Payment date — in YYYY-MM-DD format
3. Description — what was paid for (e.g. income tax, VAT, withholding tax, utility bill, etc.)
4. Payer name — the person or company paying (if visible on the document)

Return ONLY a valid JSON object with exactly these fields, no other text:
{"amount": <number or null>, "date": "<YYYY-MM-DD or null>", "description": "<text or null>", "payerName": "<name or null>"}`;

async function extractReceiptData(imageBuffer) {
  const base64 = imageBuffer.toString('base64');

  const response = await groq.chat.completions.create({
    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: RECEIPT_PROMPT },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
        ],
      },
    ],
    max_tokens: 300,
    temperature: 0.1,
  });

  const text = response.choices[0].message.content.trim();
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(cleaned);
}

module.exports = { extractReceiptData };
