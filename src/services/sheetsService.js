const { google } = require('googleapis');
const path = require('path');

const PAYMENTS_SHEET = 'Payments';
const CUSTOMERS_SHEET = 'Customers';

const PAYMENT_HEADERS = ['LINE User ID', 'Customer Name', 'Category', 'Amount (THB)', 'Payment Date', 'Description', 'Raw OCR Text', 'Receipt Image URL', 'Recorded At'];
const CUSTOMER_HEADERS = ['LINE User ID', 'LINE Display Name', 'Registered Name', 'First Seen', 'Date of Birth (DDMMYYYY)'];

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

// ── DOB (used as PDF password) ────────────────────────────────────────────────

async function getCustomerDob(userId) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${CUSTOMERS_SHEET}!A:E`,
  });
  const rows = res.data.values ?? [];
  const row = rows.slice(1).find(r => r[0] === userId);
  return row?.[4] ?? null; // column E
}

async function saveCustomerDob(userId, dob) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${CUSTOMERS_SHEET}!A:A`,
  });
  const rows = res.data.values ?? [];
  const idx = rows.findIndex((r, i) => i > 0 && r[0] === userId);
  if (idx === -1) return;
  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${CUSTOMERS_SHEET}!E${idx + 1}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[dob]] },
  });
}

// ── Update customer name ─────────────────────────────────────────────────────

async function updateCustomerName(userId, newName) {
  const sheets = await getSheetsClient();
  await ensureSheet(sheets, CUSTOMERS_SHEET, CUSTOMER_HEADERS);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${CUSTOMERS_SHEET}!A:A`,
  });

  const rows = res.data.values ?? [];
  const idx = rows.findIndex((r, i) => i > 0 && r[0] === userId);
  if (idx === -1) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${CUSTOMERS_SHEET}!C${idx + 1}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[newName]] },
  });
}

// ── Get last payment row (with sheet row index for updates) ──────────────────

async function getLastPaymentForUser(userId) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${PAYMENTS_SHEET}!A:I`,
  });

  const rows = res.data.values ?? [];
  let lastSheetRow = -1;
  let lastData = null;

  rows.forEach((row, i) => {
    if (i === 0) return;
    if (row[0] === userId) { lastSheetRow = i + 1; lastData = row; }
  });

  if (!lastData) return null;
  return { sheetRow: lastSheetRow, data: lastData };
}

// ── Update a specific payment row ────────────────────────────────────────────

async function updatePaymentRow(sheetRow, updates) {
  const sheets = await getSheetsClient();

  // Fetch current row first
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${PAYMENTS_SHEET}!A${sheetRow}:I${sheetRow}`,
  });

  const current = (res.data.values?.[0] ?? []).concat(Array(9).fill(''));
  if (updates.category !== undefined) current[2] = updates.category;
  if (updates.amount !== undefined) current[3] = updates.amount;
  if (updates.date !== undefined) current[4] = updates.date;
  if (updates.description !== undefined) current[5] = updates.description;

  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${PAYMENTS_SHEET}!A${sheetRow}:I${sheetRow}`,
    valueInputOption: 'RAW',
    requestBody: { values: [current.slice(0, 9)] },
  });
}

// ── Search payments by keyword ────────────────────────────────────────────────

async function searchPaymentsForUser(userId, query) {
  const payments = await getPaymentsForUser(userId);
  const q = query.toLowerCase();
  return payments
    .filter(row =>
      [row[2], row[4], row[5], row[6]].some(cell => (cell ?? '').toLowerCase().includes(q))
    )
    .slice(-10)
    .reverse();
}

// ── Get all registered user IDs (for reminders) ──────────────────────────────

async function getAllUserIds() {
  try {
    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${CUSTOMERS_SHEET}!A:A`,
    });
    return (res.data.values ?? []).slice(1).map(r => r[0]).filter(Boolean);
  } catch { return []; }
}

// ── Customer stats for profile card ─────────────────────────────────────────

async function getCustomerStats(userId) {
  const sheets = await getSheetsClient();
  const year = new Date().getFullYear();

  const [paymentsRes, custRes] = await Promise.all([
    getPaymentsForUser(userId),
    sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${CUSTOMERS_SHEET}!A:D`,
    }),
  ]);

  const yearPayments = paymentsRes.filter(r => (r[4] ?? '').startsWith(String(year)));
  const total = yearPayments.reduce((s, r) => s + (parseFloat(r[3]) || 0), 0);

  const custRows = custRes.data.values ?? [];
  const custRow = custRows.slice(1).find(r => r[0] === userId);
  const firstSeen = custRow?.[3]
    ? new Date(custRow[3]).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })
    : '-';

  return { count: yearPayments.length, total, firstSeen };
}

// ── Generate CSV of a user's own payments only ───────────────────────────────

async function generateUserCsv(userId) {
  const payments = await getPaymentsForUser(userId);

  const headers = ['หมวดหมู่', 'จำนวนเงิน (THB)', 'วันที่', 'รายละเอียด', 'URL ใบเสร็จ', 'บันทึกเมื่อ'];
  const escapeCell = v => {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const rows = payments.map(row => [
    row[2] ?? '',   // category
    row[3] ?? '',   // amount
    row[4] ?? '',   // date
    row[5] ?? '',   // description
    row[7] ?? '',   // image URL
    row[8] ?? '',   // recorded at
  ].map(escapeCell).join(','));

  // UTF-8 BOM so Excel opens Thai text correctly
  const csv = '﻿' + [headers.join(','), ...rows].join('\r\n');
  return Buffer.from(csv, 'utf8');
}

module.exports = {
  getCustomerName,
  saveCustomerName,
  updateCustomerName,
  appendPayment,
  getPaymentsForUser,
  getYearSummaryForUser,
  getRecentPaymentsForUser,
  getLastPaymentForUser,
  updatePaymentRow,
  searchPaymentsForUser,
  getAllUserIds,
  getCustomerStats,
  generateUserCsv,
  getCustomerDob,
  saveCustomerDob,
};
