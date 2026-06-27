const sharp = require('sharp');
const path = require('path');

// LINE rich menu standard size: 2500 x 843 px (3-column, single row)
const WIDTH = 2500;
const HEIGHT = 843;

const svg = `
<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0f2952"/>
      <stop offset="100%" stop-color="#1a3d6e"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>

  <!-- Column dividers -->
  <rect x="832" y="40" width="2" height="${HEIGHT - 80}" fill="rgba(255,255,255,0.2)" rx="1"/>
  <rect x="1666" y="40" width="2" height="${HEIGHT - 80}" fill="rgba(255,255,255,0.2)" rx="1"/>

  <!-- Column 1: Send Receipt -->
  <rect x="60" y="60" width="712" height="${HEIGHT - 120}" rx="20" fill="rgba(255,255,255,0.06)"/>
  <text x="416" y="280" font-family="Arial, sans-serif" font-size="140" text-anchor="middle">📎</text>
  <text x="416" y="440" font-family="Arial, sans-serif" font-size="72" font-weight="bold" fill="white" text-anchor="middle">ส่งใบเสร็จ</text>
  <text x="416" y="530" font-family="Arial, sans-serif" font-size="44" fill="rgba(255,255,255,0.65)" text-anchor="middle">Send Receipt</text>

  <!-- Column 2: Year Summary -->
  <rect x="894" y="60" width="712" height="${HEIGHT - 120}" rx="20" fill="rgba(255,255,255,0.06)"/>
  <text x="1250" y="280" font-family="Arial, sans-serif" font-size="140" text-anchor="middle">📊</text>
  <text x="1250" y="440" font-family="Arial, sans-serif" font-size="72" font-weight="bold" fill="white" text-anchor="middle">สรุปรายปี</text>
  <text x="1250" y="530" font-family="Arial, sans-serif" font-size="44" fill="rgba(255,255,255,0.65)" text-anchor="middle">Year Summary</text>

  <!-- Column 3: Payment History -->
  <rect x="1728" y="60" width="712" height="${HEIGHT - 120}" rx="20" fill="rgba(255,255,255,0.06)"/>
  <text x="2084" y="280" font-family="Arial, sans-serif" font-size="140" text-anchor="middle">📋</text>
  <text x="2084" y="440" font-family="Arial, sans-serif" font-size="72" font-weight="bold" fill="white" text-anchor="middle">ประวัติ</text>
  <text x="2084" y="530" font-family="Arial, sans-serif" font-size="44" fill="rgba(255,255,255,0.65)" text-anchor="middle">Payment History</text>
</svg>
`;

async function generateMenuImage() {
  const outputPath = path.resolve(__dirname, '../../assets/rich-menu.png');
  await sharp(Buffer.from(svg)).png().toFile(outputPath);
  console.log(`✅ Rich menu image saved to: ${outputPath}`);
  return outputPath;
}

module.exports = { generateMenuImage };
