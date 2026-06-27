const PDFDocument = require('pdfkit');
const path = require('path');

const FONT = path.resolve(__dirname, '../assets/fonts/NotoSansThai.ttf');

function fmt(n) { return Number(n || 0).toLocaleString('th-TH'); }

function generateUserPdf(customerName, payments, password) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
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
    const M = 50;
    const CW = PW - M * 2;

    // ── Header bar ────────────────────────────────────────────────────────────
    doc.rect(0, 0, PW, 95).fill('#27ACB2');
    doc.fill('white').font('Thai').fontSize(22)
       .text('น้องบัญชี', M, 18, { width: CW, align: 'center' });
    doc.fontSize(11)
       .text('รายงานประวัติการชำระเงินส่วนตัว', M, 50, { width: CW, align: 'center' });
    doc.fontSize(8).fillColor('rgba(255,255,255,0.75)')
       .text('Personal Tax Receipt Report — Confidential', M, 72, { width: CW, align: 'center' });

    // ── Customer info ─────────────────────────────────────────────────────────
    const today = new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
    const total = payments.reduce((s, r) => s + (parseFloat(r[3]) || 0), 0);

    doc.fill('#333333').font('Thai').fontSize(10);
    let y = 110;
    doc.text(`ชื่อลูกค้า: คุณ${customerName}`, M, y);
    doc.text(`สร้างเมื่อ: ${today}`, M, y + 16);
    doc.text(`จำนวนรายการ: ${payments.length} รายการ`, M + CW / 2, y);
    doc.fontSize(13).fill('#27ACB2')
       .text(`ยอดรวมทั้งหมด: ฿${fmt(total)}`, M + CW / 2, y + 16);

    // ── Divider ───────────────────────────────────────────────────────────────
    y += 46;
    doc.strokeColor('#27ACB2').lineWidth(1.5).moveTo(M, y).lineTo(M + CW, y).stroke();
    y += 10;

    // ── Table header ─────────────────────────────────────────────────────────
    const C = {
      no:   { x: M,       w: 28 },
      date: { x: M + 28,  w: 82 },
      cat:  { x: M + 110, w: 120 },
      amt:  { x: M + 230, w: 75 },
      desc: { x: M + 305, w: CW - 305 },
    };

    doc.fill('#1A7A7A').rect(M, y, CW, 22).fill();
    doc.fill('white').font('Thai').fontSize(8.5);
    doc.text('#',          C.no.x + 2,   y + 6, { width: C.no.w,   align: 'center' });
    doc.text('วันที่',     C.date.x + 3, y + 6, { width: C.date.w });
    doc.text('หมวดหมู่',   C.cat.x + 3,  y + 6, { width: C.cat.w  });
    doc.text('จำนวน (฿)', C.amt.x + 3,  y + 6, { width: C.amt.w,  align: 'right' });
    doc.text('รายละเอียด', C.desc.x + 3, y + 6, { width: C.desc.w });
    y += 22;

    // ── Table rows ────────────────────────────────────────────────────────────
    const sorted = [...payments].sort((a, b) => (a[4] ?? '').localeCompare(b[4] ?? ''));

    sorted.forEach((row, i) => {
      const ROW_H = 17;

      if (y + ROW_H > doc.page.height - 55) {
        doc.addPage();
        y = 50;
      }

      doc.fill(i % 2 === 0 ? '#f0fafa' : 'white').rect(M, y, CW, ROW_H).fill();

      doc.fill('#333333').fontSize(8);
      doc.text(String(i + 1), C.no.x + 2, y + 4, { width: C.no.w, align: 'center' });
      doc.text(row[4] ?? '-',                         C.date.x + 3, y + 4, { width: C.date.w });
      doc.text((row[2] ?? '-').slice(0, 20),           C.cat.x + 3,  y + 4, { width: C.cat.w  });
      doc.text(row[3] ? fmt(row[3]) : '-',             C.amt.x + 3,  y + 4, { width: C.amt.w,  align: 'right' });
      doc.text((row[5] ?? '').slice(0, 40),            C.desc.x + 3, y + 4, { width: C.desc.w });

      doc.strokeColor('#d0e8e8').lineWidth(0.4)
         .moveTo(M, y + ROW_H).lineTo(M + CW, y + ROW_H).stroke();
      y += ROW_H;
    });

    // ── Footer ────────────────────────────────────────────────────────────────
    const FY = doc.page.height - 40;
    doc.fill('#aaaaaa').fontSize(7.5)
       .text('เอกสารนี้เป็นความลับเฉพาะบุคคล ห้ามเผยแพร่ — สร้างโดย น้องบัญชี (LINE OA)', M, FY, { width: CW, align: 'center' });

    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

module.exports = { generateUserPdf };
