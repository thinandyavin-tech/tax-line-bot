const crypto = require('crypto');

// In-memory store for temporary PDF downloads (wiped on restart, that's OK)
const store = new Map(); // token → { buffer, filename }

function storePdf(buffer, filename) {
  const token = crypto.randomBytes(20).toString('hex');
  store.set(token, { buffer, filename });
  setTimeout(() => store.delete(token), 60 * 60 * 1000); // expire after 1h
  return token;
}

function getPdf(token) {
  return store.get(token) ?? null;
}

module.exports = { storePdf, getPdf };
