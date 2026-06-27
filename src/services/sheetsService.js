const { google } = require('googleapis');
const path = require('path');

const SHEET_NAME = 'Payments';
const HEADERS = ['LINE User ID', 'Display Name', 'Amount (THB)', 'Payment Date', 'Description', 'Recorded At', 'Message ID'];

function getAuth() {
  // On Render, credentials are passed as a JSON string in GOOGLE_CREDENTIALS_JSON
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
    return new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  }
  return new google.auth.GoogleAuth({
    keyFile: path.resolve(process.env.GOOGLE_SERVICE_ACCOUNT_KEY),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

async function getSheetsClient() {
  const auth = getAuth();
  return google.sheets({ version: 'v4', auth });
}

async function ensureHeaderRow(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${SHEET_NAME}!A1:G1`,
  });

  if (!res.data.values || res.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${SHEET_NAME}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [HEADERS] },
    });
  }
}

async function appendPayment({ userId, displayName, amount, date, description, messageId }) {
  const sheets = await getSheetsClient();
  await ensureHeaderRow(sheets);

  const row = [
    userId,
    displayName,
    amount ?? '',
    date ?? '',
    description ?? '',
    new Date().toISOString(),
    messageId ?? '',
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:G`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
}

async function getPaymentsForUser(userId) {
  const sheets = await getSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:G`,
  });

  const rows = res.data.values ?? [];
  // Skip header row (index 0), filter by userId in column A (index 0)
  return rows.slice(1).filter(row => row[0] === userId);
}

async function getYearSummaryForUser(userId, year) {
  const payments = await getPaymentsForUser(userId);
  const yearStr = String(year);

  const yearPayments = payments.filter(row => {
    const date = row[3] ?? '';
    return date.startsWith(yearStr);
  });

  const total = yearPayments.reduce((sum, row) => {
    const amount = parseFloat(row[2]);
    return sum + (isNaN(amount) ? 0 : amount);
  }, 0);

  // Group by month
  const byMonth = {};
  for (const row of yearPayments) {
    const date = row[3] ?? '';
    const month = date.slice(0, 7); // YYYY-MM
    if (!byMonth[month]) byMonth[month] = 0;
    const amount = parseFloat(row[2]);
    if (!isNaN(amount)) byMonth[month] += amount;
  }

  return { total, byMonth, count: yearPayments.length };
}

async function getRecentPaymentsForUser(userId, limit = 10) {
  const payments = await getPaymentsForUser(userId);
  return payments.slice(-limit).reverse();
}

module.exports = { appendPayment, getYearSummaryForUser, getRecentPaymentsForUser };
