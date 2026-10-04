const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA = path.join("/tmp", "wan-paste-data");
const PASTES = path.join(DATA, "pastes.json");
const CLAIMS = path.join(DATA, "claims.json");

function ensure() {
  if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });
  if (!fs.existsSync(PASTES)) fs.writeFileSync(PASTES, "{}");
  if (!fs.existsSync(CLAIMS)) fs.writeFileSync(CLAIMS, "{}");
}

function read(file) {
  ensure();
  try { return JSON.parse(fs.readFileSync(file, "utf8") || "{}"); } catch { return {}; }
}

function write(file, data) {
  ensure();
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

function id(n = 12) {
  return crypto.randomBytes(n).toString("base64url").slice(0, n);
}

function createPaste(content, filename, ttlHours) {
  const pastes = read(PASTES);
  const now = Date.now();
  for (const [k, p] of Object.entries(pastes)) {
    if (p.expires && p.expires < now) delete pastes[k];
  }
  const pid = id(12);
  const paste = {
    id: pid,
    content,
    filename: String(filename || "paste.txt").slice(0, 128),
    created: now,
    expires: ttlHours ? now + ttlHours * 3600000 : null,
    views: 0,
  };
  pastes[pid] = paste;
  write(PASTES, pastes);
  return paste;
}

function getPaste(pid) {
  const pastes = read(PASTES);
  const p = pastes[pid];
  if (!p) return null;
  if (p.expires && p.expires < Date.now()) {
    delete pastes[pid];
    write(PASTES, pastes);
    return null;
  }
  p.views = (p.views || 0) + 1;
  pastes[pid] = p;
  write(PASTES, pastes);
  return p;
}

function createClaim(userId, credits, layers) {
  const claims = read(CLAIMS);
  const token = id(24);
  const claim = {
    token,
    userId: String(userId),
    credits,
    layers,
    created: Date.now(),
    completed: false,
    granted: false,
    used: false,
  };
  claims[token] = claim;
  write(CLAIMS, claims);
  return claim;
}

function getClaim(token) {
  return read(CLAIMS)[token] || null;
}

function completeClaim(token, ip) {
  const claims = read(CLAIMS);
  const c = claims[token];
  if (!c) return { ok: false, error: "invalid" };
  if (c.used || c.completed) return { ok: false, error: "already_used" };
  if (Date.now() - c.created > 6 * 3600000) {
    delete claims[token];
    write(CLAIMS, claims);
    return { ok: false, error: "expired" };
  }
  c.completed = true;
  c.completedAt = Date.now();
  c.completedIp = ip;
  claims[token] = c;
  write(CLAIMS, claims);
  return { ok: true, claim: c };
}

function listPending() {
  return Object.values(read(CLAIMS)).filter((c) => c.completed && !c.granted);
}

function markGranted(token) {
  const claims = read(CLAIMS);
  if (claims[token]) {
    delete claims[token];
    write(CLAIMS, claims);
  }
}

module.exports = {
  createPaste, getPaste, createClaim, getClaim, completeClaim, listPending, markGranted,
};
