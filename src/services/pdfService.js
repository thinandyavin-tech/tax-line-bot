const PDFDocument = require('pdfkit');
const path = require('path');

const FONT = path.resolve(__dirname, '../assets/fonts/NotoSansThai.ttf');

const COLOR = {
  primary:   '#1B6CA8',
  accent:    '#2196F3',
  light:     '#E3F2FD',
  rowAlt:    '#F5FAFF',
  border:    '#BBDEFB',
  headerBg:  '#1565C0',
  subtotal:  '#E8F5E9',
  text:      '#212121',
  muted:     '#757575',
  green:     '#2E7D32',
  white:     '#FFFFFF',
};

function fmt(n) { return Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function fmtDate(isoDate) {
  if (!isoDate) return '-';
  try {
    const d = new Date(isoDate);
    return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return isoDate; }
}

function drawPageHeader(doc, PW, M, CW, customerName, today) {
  // Blue gradient header band
  doc.rect(0, 0, PW, 100).fill(COLOR.headerBg);
  doc.rect(0, 70, PW, 30).fill(COLOR.primary);

  // Decorative circle accents
  doc.circle(PW - 60, 20, 55).fill('rgba(255,255,255,0.05)');
  doc.circle(PW - 30, 80, 40).fill('rgba(255,255,255,0.05)');

  // Bot name
  doc.fill(COLOR.white).font('Thai').fontSize(24)
     .text('น้องบัญชี', M, 16, { width: CW, align: 'center', lineBreak: false });

  // Subtitle
  doc.fontSize(10).fillColor('rgba(255,255,255,0.85)')
     .text('รายงานประวัติการชำระเงินส่วนตัว  ·  Personal Tax Receipt Report', M, 48, { width: CW, align: 'center' });

  // Confidential ribbon
  doc.fontSize(7).fillColor('rgba(255,255,255,0.55)')
     .text('CONFIDENTIAL — สำหรับเจ้าของเอกสารเท่านั้น', M, 78, { width: CW, align: 'center' });
}

function drawInfoCard(doc, M, CW, customerName, today, paymentCount, total) {
  const y = 112;
  const cardH = 64;

  // Card background
  doc.roundedRect(M, y, CW, cardH, 6).fill(COLOR.light);
  doc.roundedRect(M, y, CW, cardH, 6).stroke(COLOR.border).lineWidth(0.8);

  // Left column — customer + date
  doc.fill(COLOR.muted).font('Thai').fontSize(7.5)
     .text('ชื่อลูกค้า', M + 14, y + 10);
  doc.fill(COLOR.text).fontSize(11)
     .text(`คุณ${customerName}`, M + 14, y + 21);
  doc.fill(COLOR.muted).fontSize(7.5)
     .text('วันที่ออกรายงาน', M + 14, y + 40);
  doc.fill(COLOR.text).fontSize(8.5)
     .text(today, M + 14, y + 51);

  // Divider
  doc.strokeColor(COLOR.border).lineWidth(1)
     .moveTo(M + CW / 2, y + 10).lineTo(M + CW / 2, y + cardH - 10).stroke();

  // Right column — total + count
  doc.fill(COLOR.muted).font('Thai').fontSize(7.5)
     .text('ยอดรวมทั้งหมด', M + CW / 2 + 14, y + 10);
  doc.fill(COLOR.green).fontSize(16)
     .text(`฿${fmt(total)}`, M + CW / 2 + 14, y + 19);
  doc.fill(COLOR.muted).fontSize(7.5)
     .text(`${paymentCount} รายการ`, M + CW / 2 + 14, y + 43);

  return y + cardH + 14;
}

function drawCategoryBar(doc, M, CW, byCategory, total, startY) {
  if (Object.keys(byCategory).length === 0) return startY;

  doc.fill(COLOR.primary).font('Thai').fontSize(8).text('สรุปตามหมวดหมู่', M, startY, { width: CW });
  let y = startY + 13;

  const entries = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  const colW = Math.floor(CW / Math.min(entries.length, 3));

  entries.slice(0, 3).forEach(([cat, amt], i) => {
    const cx = M + i * colW;
    const pct = total > 0 ? amt / total : 0;
    doc.roundedRect(cx, y, colW - 6, 34, 4).fill(COLOR.rowAlt);
    doc.fill(COLOR.muted).fontSize(6.5).text(cat.slice(0, 16), cx + 6, y + 5, { width: colW - 12 });
    doc.fill(COLOR.text).fontSize(8.5).text(`฿${fmt(amt)}`, cx + 6, y + 16, { width: colW - 12 });
    // Mini bar
    const barW = Math.max(2, Math.round((colW - 20) * pct));
    doc.rect(cx + 6, y + 30, colW - 20, 2).fill(COLOR.border);
    doc.rect(cx + 6, y + 30, barW, 2).fill(COLOR.accent);
  });

  return y + 48;
}

function drawTableHeader(doc, M, CW, C, y) {
  doc.rect(M, y, CW, 24).fill(COLOR.primary);
  doc.fill(COLOR.white).font('Thai').fontSize(8);
  doc.text('#',          C.no.x + 2,   y + 7, { width: C.no.w,   align: 'center' });
  doc.text('วันที่',     C.date.x + 4, y + 7, { width: C.date.w });
  doc.text('หมวดหมู่',   C.cat.x + 4,  y + 7, { width: C.cat.w  });
  doc.text('จำนวน (฿)', C.amt.x + 4,  y + 7, { width: C.amt.w,  align: 'right' });
  doc.text('รายละเอียด', C.desc.x + 4, y + 7, { width: C.desc.w });
  return y + 24;
}

function drawPageFooter(doc, M, CW, pageNum) {
  const FY = doc.page.height - 38;
  doc.rect(0, FY - 8, doc.page.width, 46).fill(COLOR.headerBg);
  doc.fill('rgba(255,255,255,0.5)').font('Thai').fontSize(7)
     .text(
       `เอกสารนี้เป็นความลับเฉพาะบุคคล ห้ามเผยแพร่ — สร้างโดย น้องบัญชี (LINE OA)   |   หน้า ${pageNum}`,
       M, FY + 2, { width: CW, align: 'center' }
     );
}

function generateUserPdf(customerName, payments, password) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 50, bottom: 60, left: 44, right: 44 },
      userPassword: password,
      ownerPassword: password + '_nb',
      permissions: {
        printing: 'highResolution',
        modifying: false,
        copying: false,
        annotating: false,
        fillingForms: false,
        contentAccessibility: true,
        documentAssembly: false,
      },
      pdfVersion: '1.6',
    });

    doc.registerFont('Thai', FONT);

    const PW = doc.page.width;
    const M  = 44;
    const CW = PW - M * 2;

    const today = new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
    const total = payments.reduce((s, r) => s + (parseFloat(r[3]) || 0), 0);

    const byCategory = {};
    for (const r of payments) {
      const cat = r[2] || 'ไม่ระบุ';
      byCategory[cat] = (byCategory[cat] ?? 0) + (parseFloat(r[3]) || 0);
    }

    const C = {
      no:   { x: M,        w: 26  },
      date: { x: M + 26,   w: 86  },
      cat:  { x: M + 112,  w: 115 },
      amt:  { x: M + 227,  w: 80  },
      desc: { x: M + 307,  w: CW - 307 },
    };

    // ── Page 1 ─────────────────────────────────────────────────────────────────
    let pageNum = 1;
    drawPageHeader(doc, PW, M, CW, customerName, today);

    let y = drawInfoCard(doc, M, CW, customerName, today, payments.length, total);
    y = drawCategoryBar(doc, M, CW, byCategory, total, y);

    // Section label
    y += 6;
    doc.fill(COLOR.primary).font('Thai').fontSize(8).text('รายการทั้งหมด', M, y);
    y += 12;

    y = drawTableHeader(doc, M, CW, C, y);

    // ── Table rows ────────────────────────────────────────────────────────────
    const sorted = [...payments].sort((a, b) => (a[4] ?? '').localeCompare(b[4] ?? ''));
    const ROW_H = 20;

    sorted.forEach((row, i) => {
      const footerSafe = doc.page.height - 70;
      if (y + ROW_H > footerSafe) {
        drawPageFooter(doc, M, CW, pageNum);
        doc.addPage();
        pageNum++;
        drawPageHeader(doc, PW, M, CW, customerName, today);
        y = 115;
        y = drawTableHeader(doc, M, CW, C, y);
      }

      // Row background
      doc.rect(M, y, CW, ROW_H).fill(i % 2 === 0 ? COLOR.rowAlt : COLOR.white);

      doc.fill(COLOR.text).font('Thai').fontSize(7.5);
      doc.text(String(i + 1),               C.no.x + 2,   y + 5, { width: C.no.w,   align: 'center' });
      doc.text(fmtDate(row[4]),              C.date.x + 4, y + 5, { width: C.date.w  });
      doc.text((row[2] ?? '-').slice(0, 22), C.cat.x + 4,  y + 5, { width: C.cat.w   });
      doc.fill(row[3] ? COLOR.green : COLOR.muted)
         .text(row[3] ? fmt(row[3]) : '-',  C.amt.x + 4,  y + 5, { width: C.amt.w,  align: 'right' });
      doc.fill(COLOR.muted)
         .text((row[5] ?? '').slice(0, 45), C.desc.x + 4, y + 5, { width: C.desc.w  });

      // Row separator
      doc.strokeColor(COLOR.border).lineWidth(0.3)
         .moveTo(M, y + ROW_H).lineTo(M + CW, y + ROW_H).stroke();
      y += ROW_H;
    });

    // ── Total summary row ─────────────────────────────────────────────────────
    if (y + 26 > doc.page.height - 70) {
      drawPageFooter(doc, M, CW, pageNum);
      doc.addPage();
      pageNum++;
      drawPageHeader(doc, PW, M, CW, customerName, today);
      y = 115;
    }
    doc.rect(M, y, CW, 24).fill(COLOR.subtotal);
    doc.fill(COLOR.green).font('Thai').fontSize(9)
       .text('ยอดรวม', C.cat.x + 4, y + 7, { width: C.cat.w });
    doc.fontSize(10)
       .text(`฿${fmt(total)}`, C.amt.x + 4, y + 7, { width: C.amt.w, align: 'right' });
    doc.fill(COLOR.muted).fontSize(7.5)
       .text(`${payments.length} รายการ`, C.desc.x + 4, y + 8, { width: C.desc.w });

    drawPageFooter(doc, M, CW, pageNum);

    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

module.exports = { generateUserPdf };
