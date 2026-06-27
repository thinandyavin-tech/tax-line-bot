/**
 * One-time setup script — run with: npm run setup-menu
 * Creates the rich menu in LINE and sets it as the default for all users.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { generateMenuImage } = require('./generateMenuImage');

const BASE = 'https://api.line.me/v2/bot';

const headers = {
  Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
};

const RICH_MENU_BODY = {
  size: { width: 2500, height: 843 },
  selected: true,
  name: 'Tax Payment Menu',
  chatBarText: 'เมนู | Menu',
  areas: [
    {
      bounds: { x: 0, y: 0, width: 833, height: 843 },
      action: { type: 'postback', label: 'ส่งใบเสร็จ', data: 'action=send_receipt', displayText: 'ส่งใบเสร็จ' },
    },
    {
      bounds: { x: 833, y: 0, width: 833, height: 843 },
      action: { type: 'postback', label: 'สรุปรายปี', data: 'action=year_summary', displayText: 'สรุปรายปี' },
    },
    {
      bounds: { x: 1666, y: 0, width: 834, height: 843 },
      action: { type: 'postback', label: 'ประวัติ', data: 'action=payment_history', displayText: 'ประวัติการชำระ' },
    },
  ],
};

async function setup() {
  console.log('🔧 Setting up rich menu...\n');

  // 1. Generate the background image
  console.log('1. Generating menu image...');
  const imagePath = await generateMenuImage();

  // 2. Create the rich menu structure
  console.log('2. Creating rich menu on LINE...');
  const createRes = await axios.post(`${BASE}/richmenu`, RICH_MENU_BODY, { headers });
  const richMenuId = createRes.data.richMenuId;
  console.log(`   Rich menu ID: ${richMenuId}`);

  // 3. Upload the background image
  console.log('3. Uploading menu image...');
  const imageBuffer = fs.readFileSync(imagePath);
  await axios.post(
    `https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`,
    imageBuffer,
    {
      headers: {
        ...headers,
        'Content-Type': 'image/png',
      },
    },
  );
  console.log('   Image uploaded.');

  // 4. Set as the default rich menu for all users
  console.log('4. Setting as default rich menu...');
  await axios.post(`${BASE}/user/all/richmenu/${richMenuId}`, {}, { headers });

  console.log(`\n✅ Done! Rich menu is now active for all users.`);
  console.log(`   Rich Menu ID: ${richMenuId}`);
}

setup().catch(err => {
  console.error('❌ Setup failed:', err.response?.data || err.message);
  process.exit(1);
});
