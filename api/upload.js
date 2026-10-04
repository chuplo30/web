const { createPaste } = require("../lib/store");

const ALLOWED = new Set(["txt", "lua", "luau", "luac"]);
const MAX = 50 * 1024 * 1024;

function siteUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return "https://" + String(process.env.VERCEL_URL).replace(/\/$/, "");
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || "https";
  if (host) return proto + "://" + host;
  return "";
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX + 2048) {
        reject(new Error("too_large"));
        try { req.destroy(); } catch (_) {}
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseMultipart(buf, boundary) {
  const parts = {};
  const sep = Buffer.from("--" + boundary);
  let start = buf.indexOf(sep) + sep.length;
  while (start < buf.length) {
    if (buf[start] === 45 && buf[start + 1] === 45) break;
    if (buf[start] === 13) start++;
    if (buf[start] === 10) start++;
    const headerEnd = buf.indexOf("\r\n\r\n", start);
    if (headerEnd < 0) break;
    const headers = buf.slice(start, headerEnd).toString("utf8");
    const next = buf.indexOf(sep, headerEnd);
    if (next < 0) break;
    const body = buf.slice(headerEnd + 4, next - 2);
    const nameMatch = /name="([^"]+)"/.exec(headers);
    const fileMatch = /filename="([^"]*)"/.exec(headers);
    if (nameMatch) {
      if (fileMatch && fileMatch[1]) {
        parts.file = body.toString("utf8");
        parts.filename = fileMatch[1];
      } else {
        parts[nameMatch[1]] = body.toString("utf8");
      }
    }
    start = next + sep.length;
  }
  return parts;
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: "method" }));
  }
  try {
    const buf = await readBody(req);
    const ct = String(req.headers["content-type"] || "");
    let content = "";
    let filename = "paste.txt";
    let ttl = "24";

    if (ct.includes("application/json")) {
      const j = JSON.parse(buf.toString("utf8") || "{}");
      content = j.content || "";
      filename = j.filename || filename;
      ttl = j.ttl || "24";
    } else if (ct.includes("multipart/form-data")) {
      const m = /boundary=(.+)$/i.exec(ct);
      const parts = parseMultipart(buf, m ? m[1].trim() : "");
      if (parts.file != null) {
        content = parts.file;
        filename = parts.filename || filename;
      } else {
        content = parts.content || "";
        filename = parts.filename || filename;
      }
      ttl = parts.ttl || "24";
    } else {
      content = buf.toString("utf8");
    }

    const ext = (filename.split(".").pop() || "txt").toLowerCase();
    if (filename !== "paste.txt" && !ALLOWED.has(ext)) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: "bad_ext" }));
    }
    if (!content || !String(content).trim()) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: "empty" }));
    }
    if (Buffer.byteLength(content, "utf8") > MAX) {
      res.statusCode = 413;
      return res.end(JSON.stringify({ error: "too_large" }));
    }

    const hours = ttl === "forever" ? null : 24;
    const paste = await createPaste(content, filename, hours);
    const base = siteUrl(req);
    const url = `${base}/api/raw?id=${paste.id}`;
    res.statusCode = 200;
    res.end(JSON.stringify({ id: paste.id, url, expires: paste.expires }));
  } catch (e) {
    res.statusCode = e.message === "too_large" ? 413 : 500;
    res.end(JSON.stringify({ error: e.message === "too_large" ? "too_large" : "upload_failed" }));
  }
};
