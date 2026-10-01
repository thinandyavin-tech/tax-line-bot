const { test } = require('node:test');
const assert = require('node:assert/strict');
const { google } = require('googleapis');
const { uploadReceiptImage, uploadFile } = require('../src/services/driveService');

function mockDrive(t, { ownerEmail, existing = false } = {}) {
  const previous = { credentials: process.env.GOOGLE_CREDENTIALS_JSON, owner: process.env.DRIVE_OWNER_EMAIL };
  process.env.GOOGLE_CREDENTIALS_JSON = '{}';
  if (ownerEmail) process.env.DRIVE_OWNER_EMAIL = ownerEmail;
  else delete process.env.DRIVE_OWNER_EMAIL;
  t.after(() => {
    if (previous.credentials === undefined) delete process.env.GOOGLE_CREDENTIALS_JSON;
    else process.env.GOOGLE_CREDENTIALS_JSON = previous.credentials;
    if (previous.owner === undefined) delete process.env.DRIVE_OWNER_EMAIL;
    else process.env.DRIVE_OWNER_EMAIL = previous.owner;
  });
  const queries = [];
  const created = [];
  const permissions = [];
  const drive = {
    files: {
      list: async request => {
        queries.push(request.q);
        return { data: { files: existing ? [{ id: `existing-${queries.length}` }] : [] } };
      },
      create: async request => {
        created.push(request);
        return { data: { id: `file-${created.length}` } };
      },
    },
    permissions: { create: async request => { permissions.push(request); } },
  };
  t.mock.method(google, 'drive', () => drive);
  return { queries, created, permissions };
}

test('new receipt uploads do not grant public or hard-coded recipient access', async t => {
  const { created, permissions } = mockDrive(t);
  const url = await uploadReceiptImage(Buffer.from('sample'), 'Sample Customer', 'receipt.jpg');
  assert.equal(url, 'https://drive.google.com/file/d/file-3/view');
  assert.equal(created.length, 3);
  assert.deepEqual(created[2].requestBody.parents, ['file-2']);
  assert.deepEqual(permissions, []);
});

test('an explicitly configured operator is only granted access to the new root folder', async t => {
  const { permissions } = mockDrive(t, { ownerEmail: 'operator@example.com' });
  await uploadReceiptImage(Buffer.from('sample'), 'Sample Customer', 'receipt.jpg');
  assert.deepEqual(permissions, [{
    fileId: 'file-1',
    requestBody: { role: 'writer', type: 'user', emailAddress: 'operator@example.com' },
  }]);
});

test('escapes apostrophes and backslashes in folder searches and reuses existing folders', async t => {
  const { queries, created, permissions } = mockDrive(t, { existing: true });
  await uploadFile(Buffer.from('sample'), "O'Brien\\Receipts", 'report.pdf', 'application/pdf');
  assert.ok(queries[1].includes("name='O\\'Brien\\\\Receipts'"));
  assert.ok(queries[1].includes("'existing-1' in parents"));
  assert.equal(created.length, 1);
  assert.deepEqual(created[0].requestBody.parents, ['existing-2']);
  assert.deepEqual(permissions, []);
});
