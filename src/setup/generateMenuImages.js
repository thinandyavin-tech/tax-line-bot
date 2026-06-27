const sharp = require('sharp');

const W = 2500;
const H = 843;
const COLS = 3;
const ROWS = 2;
const CW = Math.floor(W / COLS);   // 833
const CH = Math.floor(H / ROWS);   // 421
const CW3 = W - CW * 2;            // last col: 834
const CH2 = H - CH;                // last row: 422

function buildSVG(cells) {
  const rects = cells.map(({ col, row: r, color }) => {
    const x = col * CW;
    const y = r * CH;
    const w = col === 2 ? CW3 : CW;
    const h = r === 1 ? CH2 : CH;
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color}"/>`;
  }).join('\n  ');

  const lines = [
    `<line x1="${CW}" y1="0" x2="${CW}" y2="${H}" stroke="rgba(0,0,0,0.25)" stroke-width="4"/>`,
    `<line x1="${CW * 2}" y1="0" x2="${CW * 2}" y2="${H}" stroke="rgba(0,0,0,0.25)" stroke-width="4"/>`,
    `<line x1="0" y1="${CH}" x2="${W}" y2="${CH}" stroke="rgba(0,0,0,0.25)" stroke-width="4"/>`,
  ].join('\n  ');

  const texts = cells.map(({ col, row: r, label, sub }) => {
    const cx = col * CW + (col === 2 ? CW3 : CW) / 2;
    const cy = r * CH + (r === 1 ? CH2 : CH) / 2;
    const mainY = sub ? cy - 30 : cy + 10;
    return `
  <text x="${cx}" y="${mainY}" fill="white" font-size="72" font-weight="bold"
        font-family="'Thonburi','Noto Sans Thai','TH Sarabun New',Arial,sans-serif"
        text-anchor="middle" dominant-baseline="central">${label}</text>
  ${sub ? `<text x="${cx}" y="${cy + 55}" fill="rgba(255,255,255,0.75)" font-size="36"
        font-family="Arial,Helvetica,sans-serif"
        text-anchor="middle" dominant-baseline="central">${sub}</text>` : ''}`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  ${rects}
  ${lines}
  ${texts}
</svg>`;
}

async function generateMainMenuImage() {
  const cells = [
    { col: 0, row: 0, color: '#00897B', label: 'ส่งใบเสร็จ', sub: 'Send Receipt' },
    { col: 1, row: 0, color: '#1E88E5', label: 'สรุปรายปี',  sub: 'Year Summary' },
    { col: 2, row: 0, color: '#E53935', label: 'คำนวณภาษี', sub: 'Tax Calc' },
    { col: 0, row: 1, color: '#7B1FA2', label: 'ประวัติ',     sub: 'History' },
    { col: 1, row: 1, color: '#2E7D32', label: 'โปรไฟล์',    sub: 'Profile' },
    { col: 2, row: 1, color: '#4E342E', label: 'ช่วยเหลือ',  sub: 'Help' },
  ];
  return sharp(Buffer.from(buildSVG(cells))).png().toBuffer();
}

async function generateProfileMenuImage() {
  const cells = [
    { col: 0, row: 0, color: '#0277BD', label: 'ข้อมูลของฉัน', sub: 'My Info' },
    { col: 1, row: 0, color: '#AD1457', label: 'เปลี่ยนชื่อ',   sub: 'Change Name' },
    { col: 2, row: 0, color: '#E65100', label: 'ค้นหาใบเสร็จ', sub: 'Search' },
    { col: 0, row: 1, color: '#BF360C', label: 'จัดการรายการ', sub: 'Manage' },
    { col: 1, row: 1, color: '#00695C', label: 'ส่งออกข้อมูล', sub: 'Export' },
    { col: 2, row: 1, color: '#37474F', label: '◀ กลับหลัก',   sub: 'Back' },
  ];
  return sharp(Buffer.from(buildSVG(cells))).png().toBuffer();
}

module.exports = { generateMainMenuImage, generateProfileMenuImage };
