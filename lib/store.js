/**
 * Paste/claim store for Vercel.
 * Priority: Vercel Blob (BLOB_READ_WRITE_TOKEN) → memory+/tmp fallback.
 * Without Blob, data can vanish between serverless instances → raw not found.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA = path.join("/tmp", "wan-paste-data");
const g = globalThis;
if (!g.__wanPastes) g.__wanPastes = new Map();
if (!g.__wanClaims) g.__wanClaims = new Map();

function id(n = 12) {
  return crypto.randomBytes(n).toString("base64url").slice(0, n);
}

function ensureDir() {
  try {
    if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });
  } catch (_) {}
}

function memSetPaste(p) {
  g.__wanPastes.set(p.id, p);
  ensureDir();
  try {
    fs.writeFileSync(path.join(DATA, p.id + ".json"), JSON.stringify(p));
  } catch (_) {}
}

function memGetPaste(pid) {
  if (g.__wanPastes.has(pid)) return g.__wanPastes.get(pid);
  try {
    const f = path.join(DATA, pid + ".json");
    if (fs.existsSync(f)) {
      const p = JSON.parse(fs.readFileSync(f, "utf8"));
      g.__wanPastes.set(pid, p);
      return p;
    }
  } catch (_) {}
  return null;
}

function memDelPaste(pid) {
  g.__wanPastes.delete(pid);
  try {
    fs.unlinkSync(path.join(DATA, pid + ".json"));
  } catch (_) {}
}

async function blobPut(key, data) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  const res = await fetch(
    `https://blob.vercel-storage.com/${encodeURIComponent(key)}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "x-api-version": "7",
        "x-content-type": "application/json",
        "x-vercel-blob-access": "public",
      },
      body: typeof data === "string" ? data : JSON.stringify(data),
    }
  );
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error("blob_put_" + res.status + ":" + t.slice(0, 120));
  }
  return res.json().catch(() => ({}));
}

async function blobGet(key) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  // list/get via public URL stored in memory map
  const meta = g.__wanPastes.get(key);
  if (meta && meta.blobUrl) {
    const r = await fetch(meta.blobUrl);
    if (!r.ok) return null;
    return r.json();
  }
  return null;
}

async function createPaste(content, filename, ttlHours) {
  const now = Date.now();
  const pid = id(14);
  const paste = {
    id: pid,
    content,
    filename: String(filename || "paste.txt").slice(0, 128),
    created: now,
    expires: ttlHours ? now + ttlHours * 3600000 : null,
    views: 0,
  };

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const body = JSON.stringify(paste);
      const res = await fetch("https://blob.vercel-storage.com", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`,
          "x-api-version": "7",
          "x-content-type": "application/json",
          "x-vercel-blob-access": "public",
          "x-vercel-filename": `pastes/${pid}.json`,
        },
        body,
      });
      if (res.ok) {
        const info = await res.json();
        paste.blobUrl = info.url;
        memSetPaste({ id: pid, blobUrl: info.url, expires: paste.expires, filename: paste.filename });
        return paste;
      }
    } catch (e) {
      // fall through to memory
    }
  }

  memSetPaste(paste);
  return paste;
}

async function getPaste(pid) {
  // try memory / tmp first
  let p = memGetPaste(pid);
  if (p && p.blobUrl && !p.content) {
    try {
      const r = await fetch(p.blobUrl);
      if (r.ok) p = await r.json();
    } catch (_) {
      p = null;
    }
  }
  if (!p && process.env.BLOB_READ_WRITE_TOKEN) {
    // cannot list easily without sdk — client must have warm meta
  }
  if (!p) return null;
  if (p.expires && p.expires < Date.now()) {
    memDelPaste(pid);
    return null;
  }
  p.views = (p.views || 0) + 1;
  return p;
}

function createClaim(userId, credits, layers) {
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
  g.__wanClaims.set(token, claim);
  ensureDir();
  try {
    fs.writeFileSync(path.join(DATA, "claim_" + token + ".json"), JSON.stringify(claim));
  } catch (_) {}
  return claim;
}

function getClaim(token) {
  if (g.__wanClaims.has(token)) return g.__wanClaims.get(token);
  try {
    const f = path.join(DATA, "claim_" + token + ".json");
    if (fs.existsSync(f)) {
      const c = JSON.parse(fs.readFileSync(f, "utf8"));
      g.__wanClaims.set(token, c);
      return c;
    }
  } catch (_) {}
  return null;
}

function completeClaim(token, ip) {
  const c = getClaim(token);
  if (!c) return { ok: false, error: "invalid" };
  if (c.used || c.completed) return { ok: false, error: "already_used" };
  if (Date.now() - c.created > 6 * 3600000) {
    g.__wanClaims.delete(token);
    return { ok: false, error: "expired" };
  }
  c.completed = true;
  c.completedAt = Date.now();
  c.completedIp = ip;
  g.__wanClaims.set(token, c);
  try {
    fs.writeFileSync(path.join(DATA, "claim_" + token + ".json"), JSON.stringify(c));
  } catch (_) {}
  return { ok: true, claim: c };
}

function listPending() {
  const out = [];
  for (const c of g.__wanClaims.values()) {
    if (c.completed && !c.granted) out.push(c);
  }
  // also scan tmp claims
  try {
    ensureDir();
    for (const name of fs.readdirSync(DATA)) {
      if (!name.startsWith("claim_")) continue;
      try {
        const c = JSON.parse(fs.readFileSync(path.join(DATA, name), "utf8"));
        if (c.completed && !c.granted) {
          if (!out.find((x) => x.token === c.token)) out.push(c);
          g.__wanClaims.set(c.token, c);
        }
      } catch (_) {}
    }
  } catch (_) {}
  return out;
}

function markGranted(token) {
  g.__wanClaims.delete(token);
  try {
    fs.unlinkSync(path.join(DATA, "claim_" + token + ".json"));
  } catch (_) {}
}

module.exports = {
  createPaste,
  getPaste,
  createClaim,
  getClaim,
  completeClaim,
  listPending,
  markGranted,
};
