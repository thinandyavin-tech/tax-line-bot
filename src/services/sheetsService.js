const { google } = require('googleapis');
const path = require('path');

const PAYMENTS_SHEET = 'Payments';
const CUSTOMERS_SHEET = 'Customers';

const PAYMENT_HEADERS = ['LINE User ID', 'Customer Name', 'Category', 'Amount (THB)', 'Payment Date', 'Description', 'Raw OCR Text', 'Receipt Image URL', 'Recorded At'];
const CUSTOMER_HEADERS = ['LINE User ID', 'LINE Display Name', 'Registered Name', 'First Seen'];

function getAuth() {
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
    return new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  }
  return new google.auth.GoogleAuth({
    keyFile: path.resolve(process.env.GOOGLE_SERVICE_ACCOUNT_KEY),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

async function getSheetsClient() {
  return google.sheets({ version: 'v4', auth: getAuth() });
}

async function ensureSheet(sheets, sheetName, headers) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: process.env.SPREADSHEET_ID });
  const exists = meta.data.sheets.some(s => s.properties.title === sheetName);

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: process.env.SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
    });
  }

  // Check/write headers
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${sheetName}!A1:Z1`,
  });
  if (!res.data.values || res.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${sheetName}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [headers] },
    });
  }
}

// ── Customer management ──────────────────────────────────────────────────────

async function getCustomerName(userId) {
  const sheets = await getSheetsClient();
  await ensureSheet(sheets, CUSTOMERS_SHEET, CUSTOMER_HEADERS);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${CUSTOMERS_SHEET}!A:D`,
  });

  const rows = res.data.values ?? [];
  const row = rows.slice(1).find(r => r[0] === userId);
  return row ? row[2] : null; // column C = Registered Name
}

async function saveCustomerName(userId, lineDisplayName, registeredName) {
  const sheets = await getSheetsClient();
  await ensureSheet(sheets, CUSTOMERS_SHEET, CUSTOMER_HEADERS);

  // Check if already exists
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${CUSTOMERS_SHEET}!A:A`,
  });
  const existingIds = (res.data.values ?? []).map(r => r[0]);
  if (existingIds.includes(userId)) return;

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${CUSTOMERS_SHEET}!A:D`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [[userId, lineDisplayName, registeredName, new Date().toISOString()]] },
  });
}

// ── Payment management ───────────────────────────────────────────────────────

async function appendPayment({ userId, customerName, category, amount, date, description, rawText, imageUrl }) {
  const sheets = await getSheetsClient();
  await ensureSheet(sheets, PAYMENTS_SHEET, PAYMENT_HEADERS);

  const row = [
    userId,
    customerName ?? '',
    category ?? '',
    amount ?? '',
    date ?? '',
    description ?? '',
    rawText ?? '',
    imageUrl ?? '',
    new Date().toISOString(),
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${PAYMENTS_SHEET}!A:I`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
}

async function getPaymentsForUser(userId) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${PAYMENTS_SHEET}!A:I`,
  });
  const rows = res.data.values ?? [];
  return rows.slice(1).filter(row => row[0] === userId);
}

async function getYearSummaryForUser(userId, year) {
  const payments = await getPaymentsForUser(userId);
  const yearStr = String(year);
  const yearPayments = payments.filter(row => (row[4] ?? '').startsWith(yearStr));

  const total = yearPayments.reduce((sum, row) => sum + (parseFloat(row[3]) || 0), 0);

  const byCategory = {};
  for (const row of yearPayments) {
    const cat = row[2] || 'ไม่ระบุ';
    byCategory[cat] = (byCategory[cat] ?? 0) + (parseFloat(row[3]) || 0);
  }

  const byMonth = {};
  for (const row of yearPayments) {
    const month = (row[4] ?? '').slice(0, 7);
    if (month) byMonth[month] = (byMonth[month] ?? 0) + (parseFloat(row[3]) || 0);
  }

  return { total, byCategory, byMonth, count: yearPayments.length };
}

async function getRecentPaymentsForUser(userId, limit = 10) {
  const payments = await getPaymentsForUser(userId);
  return payments.slice(-limit).reverse();
}

module.exports = { getCustomerName, saveCustomerName, appendPayment, getYearSummaryForUser, getRecentPaymentsForUser };
