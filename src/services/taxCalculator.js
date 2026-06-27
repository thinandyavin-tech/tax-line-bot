// Thai PIT brackets 2025/2026
const BRACKETS = [
  [150_000, 0.00],
  [300_000, 0.05],
  [500_000, 0.10],
  [750_000, 0.15],
  [1_000_000, 0.20],
  [2_000_000, 0.25],
  [5_000_000, 0.30],
  [Infinity, 0.35],
];

const EXPENSE_RULES = {
  '40(1)': { rate: 0.50, max: 100_000, label: 'พนักงาน/เงินเดือน' },
  '40(2)': { rate: 0.50, max: 100_000, label: 'รับจ้าง/ฟรีแลนซ์' },
  '40(5)': { rate: 0.30, max: Infinity, label: 'ค่าเช่า' },
  '40(6)': { rate: 0.60, max: Infinity, label: 'วิชาชีพ (แพทย์/ทนาย)' },
  '40(8)': { rate: 0.60, max: Infinity, label: 'ธุรกิจทั่วไป' },
};

function calculatePIT(grossIncome, incomeType = '40(1)', extraDeductions = 0) {
  const rule = EXPENSE_RULES[incomeType] ?? EXPENSE_RULES['40(1)'];
  const expense = Math.min(grossIncome * rule.rate, rule.max === Infinity ? grossIncome * rule.rate : rule.max);
  const personal = 60_000;
  const netIncome = Math.max(0, grossIncome - expense - personal - extraDeductions);

  let tax = 0;
  let prev = 0;
  const breakdown = [];

  for (const [limit, rate] of BRACKETS) {
    if (netIncome <= prev) break;
    const taxable = Math.min(netIncome, limit) - prev;
    const t = Math.round(taxable * rate);
    if (rate > 0) {
      breakdown.push({
        range: `${prev.toLocaleString('th-TH')}–${limit === Infinity ? '∞' : limit.toLocaleString('th-TH')}`,
        rate: `${rate * 100}%`,
        tax: t,
      });
    }
    tax += t;
    prev = limit;
  }

  return {
    grossIncome,
    expense,
    personal,
    extraDeductions,
    netIncome,
    tax: Math.round(tax),
    breakdown,
    incomeType,
    incomeLabel: rule.label,
  };
}

module.exports = { calculatePIT, EXPENSE_RULES };
