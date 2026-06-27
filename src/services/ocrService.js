const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Step 1: Extract all raw text from the image verbatim
async function extractRawText(imageBuffer) {
  const base64 = imageBuffer.toString('base64');

  const response = await groq.chat.completions.create({
    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Please read every piece of text visible in this image and transcribe it exactly as it appears.
Include ALL numbers, dates, names, amounts, and labels you can see.
If the text is in Thai, keep it in Thai.
Do not interpret or summarize — just output every word/number you can read, line by line.`,
          },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
        ],
      },
    ],
    max_tokens: 1000,
    temperature: 0,
  });

  return response.choices[0].message.content.trim();
}

// Step 2: Parse structured data from the raw text
async function parseReceiptText(rawText) {
  const response = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content: `You are a Thai receipt parser. Extract structured data from receipt text.
Return ONLY a valid JSON object with these exact fields:
{"amount": <number in THB or null>, "date": "<YYYY-MM-DD or null>", "description": "<what was paid for or null>", "payerName": "<payer name if visible or null>"}
Convert Thai date formats (e.g. 27/06/2569 or 27 มิถุนายน 2569) to YYYY-MM-DD (subtract 543 from Buddhist year).
If amount has commas (e.g. 1,500.00) strip commas and return as number 1500.
No extra text outside the JSON.`,
      },
      { role: 'user', content: `Parse this receipt text:\n\n${rawText}` },
    ],
    max_tokens: 200,
    temperature: 0,
  });

  const text = response.choices[0].message.content.trim();
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(cleaned);
}

async function extractReceiptData(imageBuffer) {
  const rawText = await extractRawText(imageBuffer);
  const structured = await parseReceiptText(rawText);
  return { ...structured, rawText };
}

module.exports = { extractReceiptData };
