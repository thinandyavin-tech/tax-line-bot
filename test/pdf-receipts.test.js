const { test } = require('node:test');
const assert = require('node:assert/strict');
const PDFDocument = require('pdfkit');
const { PDFParse } = require('pdf-parse');
const { Completions } = require('groq-sdk/resources/chat/completions');

// No real credentials or remote calls are used by these tests.
process.env.GROQ_API_KEY = 'test-only-not-a-real-key';
const { extractPdfData } = require('../src/services/ocrService');

function receiptPdf() {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument();
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.text('Sample receipt: 2026-10-01. Total: 250 THB.');
    doc.end();
  });
}

test('extracts a real PDF before passing its text to receipt and statement parsing', async t => {
  const requests = [];
  t.mock.method(Completions.prototype, 'create', async request => {
    requests.push(request);
    const content = requests.length === 1
      ? { amount: 250, date: '2026-10-01' }
      : { transactions: [{ amount: 250, date: '2026-10-01' }] };
    return { choices: [{ message: { content: JSON.stringify(content) } }] };
  });
  const destroy = t.mock.method(PDFParse.prototype, 'destroy');

  const result = await extractPdfData(await receiptPdf());

  assert.match(result.rawText, /Sample receipt/);
  assert.match(result.rawText, /250 THB/);
  assert.deepEqual(result.structured, { amount: 250, date: '2026-10-01' });
  assert.equal(result.transactions.length, 1);
  assert.equal(result.transactions[0].amount, 250);
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.messages[1].content, result.rawText);
  }
  assert.equal(destroy.mock.callCount(), 1);
});

test('rejects an invalid PDF, releases the parser, and does not call the AI service', async t => {
  const completion = t.mock.method(Completions.prototype, 'create', () => {
    throw new Error('Unexpected network request');
  });
  const destroy = t.mock.method(PDFParse.prototype, 'destroy');

  await assert.rejects(extractPdfData(Buffer.from('This is not a PDF')), /Invalid PDF/i);
  assert.equal(completion.mock.callCount(), 0);
  assert.equal(destroy.mock.callCount(), 1);
});
