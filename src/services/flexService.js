const THAI_MONTHS = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

function fmt(n) {
  return Number(n).toLocaleString('th-TH');
}

function row(label, value, valueColor = '#333333') {
  return {
    type: 'box', layout: 'horizontal', margin: 'sm',
    contents: [
      { type: 'text', text: label, size: 'sm', color: '#666666', flex: 3 },
      { type: 'text', text: value, size: 'sm', color: valueColor, flex: 2, align: 'end', weight: 'bold' },
    ],
  };
}

// ── Year Summary ──────────────────────────────────────────────────────────────

function buildYearSummaryFlex(customerName, year, summary) {
  const thYear = year + 543;
  const bodyContents = [
    { type: 'text', text: 'ยอดรวมทั้งปี', size: 'sm', color: '#aaaaaa' },
    { type: 'text', text: `฿${fmt(summary.total)}`, size: 'xxl', weight: 'bold', color: '#27ACB2', margin: 'xs' },
    { type: 'text', text: `${summary.count} รายการ`, size: 'sm', color: '#999999', margin: 'xs' },
    { type: 'separator', margin: 'lg' },
  ];

  const cats = Object.entries(summary.byCategory ?? {});
  if (cats.length > 0) {
    bodyContents.push({ type: 'text', text: '📂 หมวดหมู่', weight: 'bold', size: 'sm', margin: 'lg' });
    cats.forEach(([cat, amt]) => bodyContents.push(row(cat, `฿${fmt(amt)}`)));
  }

  const months = Object.entries(summary.byMonth ?? {}).sort(([a], [b]) => a.localeCompare(b));
  if (months.length > 0) {
    bodyContents.push({ type: 'text', text: '📅 รายเดือน', weight: 'bold', size: 'sm', margin: 'lg' });
    months.forEach(([ym, amt]) => {
      const m = parseInt(ym.split('-')[1], 10);
      bodyContents.push(row(THAI_MONTHS[m] || ym, `฿${fmt(amt)}`));
    });
  }

  return {
    type: 'flex',
    altText: `สรุปปี ${thYear} ของคุณ${customerName} — ฿${fmt(summary.total)}`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#27ACB2', paddingAll: '20px',
        contents: [
          { type: 'text', text: `📊 สรุปปี ${thYear}`, color: '#ffffff', weight: 'bold', size: 'xl' },
          { type: 'text', text: `คุณ${customerName}`, color: '#ffffffcc', size: 'sm' },
        ],
      },
      body: { type: 'box', layout: 'vertical', paddingAll: '20px', contents: bodyContents },
    },
  };
}

// ── Tax Calculation Result ────────────────────────────────────────────────────

function buildTaxResultFlex(customerName, result) {
  const breakdownItems = result.breakdown.map(b => ({
    type: 'box', layout: 'horizontal', margin: 'xs',
    contents: [
      { type: 'text', text: b.range, size: 'xxs', color: '#888888', flex: 3 },
      { type: 'text', text: b.rate, size: 'xxs', color: '#aaaaaa', flex: 1, align: 'center' },
      { type: 'text', text: `฿${fmt(b.tax)}`, size: 'xxs', color: '#555555', flex: 2, align: 'end' },
    ],
  }));

  const bodyContents = [
    row('ประเภทรายได้', result.incomeLabel),
    row('รายได้รวม', `฿${fmt(result.grossIncome)}`),
    row('หักค่าใช้จ่าย', `-฿${fmt(result.expense)}`, '#E53935'),
    row('หักค่าลดหย่อนส่วนตัว', `-฿60,000`, '#E53935'),
    ...(result.extraDeductions > 0 ? [row('หักค่าลดหย่อนเพิ่มเติม', `-฿${fmt(result.extraDeductions)}`, '#E53935')] : []),
    { type: 'separator', margin: 'lg' },
    row('เงินได้สุทธิ', `฿${fmt(result.netIncome)}`, '#333333'),
    { type: 'separator', margin: 'lg' },
  ];

  if (breakdownItems.length > 0) {
    bodyContents.push(
      { type: 'text', text: 'คำนวณแบบขั้นบันได', size: 'xs', weight: 'bold', margin: 'md', color: '#555555' },
      ...breakdownItems,
      { type: 'separator', margin: 'md' },
    );
  }

  bodyContents.push({
    type: 'box', layout: 'horizontal', margin: 'md',
    contents: [
      { type: 'text', text: '💰 ภาษีที่ต้องจ่าย (ประมาณ)', weight: 'bold', flex: 3, size: 'sm' },
      { type: 'text', text: `฿${fmt(result.tax)}`, weight: 'bold', size: 'lg', color: '#FF6D00', flex: 2, align: 'end' },
    ],
  });

  bodyContents.push({
    type: 'text',
    text: '* ยังไม่รวมค่าลดหย่อนอื่นๆ เช่น ประกัน, กองทุน RMF/SSF',
    size: 'xxs', color: '#aaaaaa', margin: 'lg', wrap: true,
  });

  return {
    type: 'flex',
    altText: `ประมาณการภาษีของคุณ${customerName} — ฿${fmt(result.tax)}`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#FF6D00', paddingAll: '20px',
        contents: [
          { type: 'text', text: '🧮 ประมาณการภาษี', color: '#ffffff', weight: 'bold', size: 'xl' },
          { type: 'text', text: `คุณ${customerName}`, color: '#ffffffcc', size: 'sm' },
        ],
      },
      body: { type: 'box', layout: 'vertical', paddingAll: '20px', contents: bodyContents },
    },
  };
}

// ── Profile Card ──────────────────────────────────────────────────────────────

function buildProfileFlex(customerName, lineDisplayName, stats) {
  return {
    type: 'flex',
    altText: `โปรไฟล์ของคุณ${customerName}`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#43A047', paddingAll: '20px',
        contents: [
          { type: 'text', text: '👤 โปรไฟล์ของฉัน', color: '#ffffff', weight: 'bold', size: 'xl' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', paddingAll: '20px',
        contents: [
          { type: 'text', text: 'ชื่อในระบบ', size: 'xs', color: '#aaaaaa' },
          { type: 'text', text: customerName || '(ยังไม่ได้ตั้งชื่อ)', size: 'xl', weight: 'bold', margin: 'xs' },
          { type: 'text', text: `LINE: ${lineDisplayName || '-'}`, size: 'sm', color: '#777777', margin: 'sm' },
          { type: 'separator', margin: 'lg' },
          { type: 'text', text: '📈 สถิติปีนี้', weight: 'bold', margin: 'lg' },
          row('ใบเสร็จที่บันทึก', `${stats.count} รายการ`),
          row('ยอดรวมปีนี้', `฿${fmt(stats.total)}`, '#27ACB2'),
          row('สมาชิกตั้งแต่', stats.firstSeen || '-'),
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', paddingAll: '12px', spacing: 'sm',
        contents: [
          {
            type: 'button', style: 'secondary', height: 'sm',
            action: { type: 'postback', label: '✏️ เปลี่ยนชื่อ', data: 'action=change_name' },
          },
        ],
      },
    },
  };
}

// ── Search Results ────────────────────────────────────────────────────────────

function buildSearchResultsFlex(payments, query) {
  if (payments.length === 0) {
    return { type: 'text', text: `ค้นหา "${query}" แล้วไม่พบรายการค่ะ` };
  }

  const bubbles = payments.slice(0, 10).map(row_ => {
    const amount = row_[3] ? `฿${fmt(row_[3])}` : '-';
    const cat = row_[2] || 'ไม่ระบุ';
    const date = row_[4] || '-';
    const desc = row_[5] || '';
    return {
      type: 'bubble', size: 'nano',
      body: {
        type: 'box', layout: 'vertical', paddingAll: '15px',
        contents: [
          { type: 'text', text: cat, size: 'xs', color: '#aaaaaa' },
          { type: 'text', text: amount, weight: 'bold', size: 'lg', color: '#27ACB2' },
          { type: 'text', text: date, size: 'xs', color: '#888888', margin: 'xs' },
          ...(desc ? [{ type: 'text', text: desc, size: 'xs', color: '#555555', margin: 'xs', wrap: true }] : []),
        ],
      },
    };
  });

  return {
    type: 'flex',
    altText: `ผลการค้นหา "${query}" — ${payments.length} รายการ`,
    contents: { type: 'carousel', contents: bubbles },
  };
}

module.exports = { buildYearSummaryFlex, buildTaxResultFlex, buildProfileFlex, buildSearchResultsFlex };
