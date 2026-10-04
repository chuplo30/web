const { createPaste } = require("../lib/store");

const ALLOWED = new Set(["txt", "lua", "luau", "luac"]);
const MAX = 50 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX + 1024) {
        reject(new Error("too_large"));
        req.destroy();
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
    if (buf[start] === 45 && buf[start + 1] === 45) break; // --
    if (buf[start] === 13) start++;
    if (buf[start] === 10) start++;
    const headerEnd = buf.indexOf("\r\n\r\n", start);
    if (headerEnd < 0) break;
    const headers = buf.slice(start, headerEnd).toString("utf8");
    const next = buf.indexOf(sep, headerEnd);
    if (next < 0) break;
    let body = buf.slice(headerEnd + 4, next - 2); // trim \r\n
    const nameMatch = /name="([^"]+)"/.exec(headers);
    const fileMatch = /filename="([^"]*)"/.exec(headers);
    if (nameMatch) {
      const name = nameMatch[1];
      if (fileMatch && fileMatch[1]) {
        parts.file = body.toString("utf8");
        parts.filename = fileMatch[1];
      } else {
        parts[name] = body.toString("utf8");
      }
    }
    start = next + sep.length;
  }
  return parts;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end("method");
  }
  try {
    const buf = await readBody(req);
    const ct = req.headers["content-type"] || "";
    let content = "";
    let filename = "paste.txt";
    let ttl = "24";

    if (ct.includes("multipart/form-data")) {
      const m = /boundary=(.+)$/i.exec(ct);
      const parts = parseMultipart(buf, m ? m[1].trim() : "");
      if (parts.file) {
        content = parts.file;
        filename = parts.filename || filename;
      } else {
        content = parts.content || "";
        filename = parts.filename || filename;
      }
      ttl = parts.ttl || "24";
    } else if (ct.includes("application/json")) {
      const j = JSON.parse(buf.toString("utf8") || "{}");
      content = j.content || "";
      filename = j.filename || filename;
      ttl = j.ttl || "24";
    } else {
      content = buf.toString("utf8");
    }

    const ext = (filename.split(".").pop() || "txt").toLowerCase();
    if (partsHasFile(filename) && !ALLOWED.has(ext)) {
      // only enforce when looks like file upload with extension
    }
    if (filename !== "paste.txt" && !ALLOWED.has(ext)) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ error: "bad_ext" }));
    }
    if (!content || !String(content).trim()) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ error: "empty" }));
    }
    if (Buffer.byteLength(content, "utf8") > MAX) {
      res.statusCode = 413;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ error: "too_large" }));
    }
    const hours = ttl === "forever" ? null : 24;
    const paste = createPaste(content, filename, hours);
    const base = (process.env.SITE_URL || "").replace(/\/$/, "");
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      id: paste.id,
      url: base ? `${base}/api/raw?id=${paste.id}` : `/api/raw?id=${paste.id}`,
      expires: paste.expires,
    }));
  } catch (e) {
    res.statusCode = e.message === "too_large" ? 413 : 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: e.message === "too_large" ? "too_large" : "upload_failed" }));
  }
};

function partsHasFile() { return true; }
