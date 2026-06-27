const { google } = require('googleapis');
const path = require('path');
const { Readable } = require('stream');

const ROOT_FOLDER_NAME = 'TaxBot - ใบเสร็จลูกค้า';
// Share the root folder with this email so you can view all receipts
const OWNER_EMAIL = 'thinandyavin@gmail.com';

function getAuth() {
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
    return new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    });
  }
  return new google.auth.GoogleAuth({
    keyFile: path.resolve(process.env.GOOGLE_SERVICE_ACCOUNT_KEY),
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });
}

async function getDriveClient() {
  const auth = getAuth();
  return google.drive({ version: 'v3', auth });
}

// Find or create a folder by name under a parent
async function findOrCreateFolder(drive, name, parentId = null) {
  const query = parentId
    ? `name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`
    : `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;

  const res = await drive.files.list({ q: query, fields: 'files(id, name)', spaces: 'drive' });

  if (res.data.files.length > 0) return res.data.files[0].id;

  const meta = { name, mimeType: 'application/vnd.google-apps.folder' };
  if (parentId) meta.parents = [parentId];

  const created = await drive.files.create({ requestBody: meta, fields: 'id' });
  const folderId = created.data.id;

  // Share root folder with owner so they can browse it
  if (!parentId) {
    await drive.permissions.create({
      fileId: folderId,
      requestBody: { role: 'writer', type: 'user', emailAddress: OWNER_EMAIL },
    }).catch(() => {}); // non-fatal if sharing fails
  }

  return folderId;
}

// Upload receipt image and return the file's web view URL
async function uploadReceiptImage(imageBuffer, customerName, filename) {
  const drive = await getDriveClient();

  // Root folder → customer subfolder
  const rootId = await findOrCreateFolder(drive, ROOT_FOLDER_NAME);
  const customerFolderId = await findOrCreateFolder(drive, customerName, rootId);

  const stream = Readable.from(imageBuffer);

  const file = await drive.files.create({
    requestBody: { name: filename, parents: [customerFolderId] },
    media: { mimeType: 'image/jpeg', body: stream },
    fields: 'id, webViewLink',
  });

  // Make the file viewable by anyone with the link
  await drive.permissions.create({
    fileId: file.data.id,
    requestBody: { role: 'reader', type: 'anyone' },
  }).catch(() => {});

  return file.data.webViewLink ?? `https://drive.google.com/file/d/${file.data.id}/view`;
}

module.exports = { uploadReceiptImage };
