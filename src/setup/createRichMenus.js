/**
 * Run with: npm run setup-menus
 * Creates Main Menu + Profile sub-menu with richmenuswitch between them.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const axios = require('axios');
const { generateMainMenuImage, generateProfileMenuImage } = require('./generateMenuImages');

const BASE = 'https://api.line.me/v2/bot';
const headers = { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` };

// ── LINE API helpers ──────────────────────────────────────────────────────────

async function listRichMenus() {
  const res = await axios.get(`${BASE}/richmenu/list`, { headers });
  return res.data.richmenus ?? [];
}

async function deleteRichMenu(id) {
  await axios.delete(`${BASE}/richmenu/${id}`, { headers }).catch(() => {});
}

async function createRichMenu(body) {
  const res = await axios.post(`${BASE}/richmenu`, body, { headers });
  return res.data.richMenuId;
}

async function uploadImage(richMenuId, pngBuffer) {
  await axios.post(
    `https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`,
    pngBuffer,
    { headers: { ...headers, 'Content-Type': 'image/png' } },
  );
}

async function listAliases() {
  const res = await axios.get(`${BASE}/richmenu/alias/list`, { headers }).catch(() => ({ data: { aliases: [] } }));
  return res.data.aliases ?? [];
}

async function deleteAlias(aliasId) {
  await axios.delete(`${BASE}/richmenu/alias/${aliasId}`, { headers }).catch(() => {});
}

async function createAlias(richMenuAliasId, richMenuId) {
  await axios.post(`${BASE}/richmenu/alias`, { richMenuAliasId, richMenuId }, { headers });
}

async function setDefault(richMenuId) {
  await axios.post(`${BASE}/user/all/richmenu/${richMenuId}`, {}, { headers });
}

// ── Rich menu definitions ─────────────────────────────────────────────────────

const CW = 833; const CH = 421;

const MAIN_MENU = {
  size: { width: 2500, height: 843 },
  selected: true,
  name: 'Main Menu',
  chatBarText: 'เมนู',
  areas: [
    { bounds: { x: 0,    y: 0,   width: CW,        height: CH  }, action: { type: 'postback', label: 'ส่งใบเสร็จ',  data: 'action=send_receipt',    displayText: 'ส่งใบเสร็จ' } },
    { bounds: { x: CW,   y: 0,   width: CW,        height: CH  }, action: { type: 'postback', label: 'สรุปรายปี',   data: 'action=year_summary',    displayText: 'สรุปรายปี' } },
    { bounds: { x: CW*2, y: 0,   width: 2500-CW*2, height: CH  }, action: { type: 'postback', label: 'คำนวณภาษี',  data: 'action=calc_tax',         displayText: 'คำนวณภาษี' } },
    { bounds: { x: 0,    y: CH,  width: CW,        height: 843-CH }, action: { type: 'postback', label: 'ประวัติ',     data: 'action=payment_history', displayText: 'ประวัติ' } },
    {
      bounds: { x: CW, y: CH, width: CW, height: 843-CH },
      action: { type: 'richmenuswitch', richMenuAliasId: 'alias-profile-menu', mode: 'increase', data: 'action=switch_profile' },
    },
    { bounds: { x: CW*2, y: CH,  width: 2500-CW*2, height: 843-CH }, action: { type: 'postback', label: 'ช่วยเหลือ',   data: 'action=help',            displayText: 'ช่วยเหลือ' } },
  ],
};

const PROFILE_MENU = {
  size: { width: 2500, height: 843 },
  selected: true,
  name: 'Profile Menu',
  chatBarText: 'โปรไฟล์',
  areas: [
    { bounds: { x: 0,    y: 0,   width: CW,        height: CH  }, action: { type: 'postback', label: 'ข้อมูลของฉัน',   data: 'action=my_info',          displayText: 'ข้อมูลของฉัน' } },
    { bounds: { x: CW,   y: 0,   width: CW,        height: CH  }, action: { type: 'postback', label: 'เปลี่ยนชื่อ',    data: 'action=change_name',      displayText: 'เปลี่ยนชื่อ' } },
    { bounds: { x: CW*2, y: 0,   width: 2500-CW*2, height: CH  }, action: { type: 'postback', label: 'ค้นหาใบเสร็จ',  data: 'action=search_receipt',   displayText: 'ค้นหาใบเสร็จ' } },
    { bounds: { x: 0,    y: CH,  width: CW,        height: 843-CH }, action: { type: 'postback', label: 'จัดการรายการ', data: 'action=manage_data',      displayText: 'จัดการรายการ' } },
    { bounds: { x: CW,   y: CH,  width: CW,        height: 843-CH }, action: { type: 'postback', label: 'ส่งออกข้อมูล', data: 'action=export_data',      displayText: 'ส่งออกข้อมูล' } },
    {
      bounds: { x: CW*2, y: CH, width: 2500-CW*2, height: 843-CH },
      action: { type: 'richmenuswitch', richMenuAliasId: 'alias-main-menu', mode: 'increase', data: 'action=switch_main' },
    },
  ],
};

// ── Main setup flow ───────────────────────────────────────────────────────────

async function setup() {
  console.log('🔧 Setting up rich menus...\n');

  // 1. Delete all existing menus and aliases (start clean)
  console.log('1. Cleaning up old menus and aliases...');
  const [oldMenus, oldAliases] = await Promise.all([listRichMenus(), listAliases()]);
  await Promise.all(oldAliases.map(a => deleteAlias(a.richMenuAliasId)));
  await Promise.all(oldMenus.map(m => deleteRichMenu(m.richMenuId)));
  console.log(`   Deleted ${oldMenus.length} menus, ${oldAliases.length} aliases`);

  // 2. Generate images
  console.log('2. Generating menu images...');
  const [mainImg, profileImg] = await Promise.all([
    generateMainMenuImage(),
    generateProfileMenuImage(),
  ]);
  console.log(`   Main: ${Math.round(mainImg.length / 1024)}KB | Profile: ${Math.round(profileImg.length / 1024)}KB`);

  // 3. Create Main Menu
  console.log('3. Creating Main Menu...');
  const mainId = await createRichMenu(MAIN_MENU);
  await uploadImage(mainId, mainImg);
  await createAlias('alias-main-menu', mainId);
  console.log(`   ID: ${mainId}`);

  // 4. Create Profile Menu
  console.log('4. Creating Profile Menu...');
  const profileId = await createRichMenu(PROFILE_MENU);
  await uploadImage(profileId, profileImg);
  await createAlias('alias-profile-menu', profileId);
  console.log(`   ID: ${profileId}`);

  // 5. Set Main Menu as default for all users
  console.log('5. Setting Main Menu as default...');
  await setDefault(mainId);

  console.log('\n✅ Done!\n');
  console.log(`   Main Menu ID:    ${mainId}  (alias: alias-main-menu)`);
  console.log(`   Profile Menu ID: ${profileId}  (alias: alias-profile-menu)`);
  console.log('\n   Users see Main Menu by default.');
  console.log('   Tapping "โปรไฟล์" switches to Profile Menu.');
  console.log('   Tapping "◀ กลับหลัก" switches back.\n');
}

setup().catch(err => {
  console.error('❌ Setup failed:', err.response?.data ?? err.message);
  process.exit(1);
});
