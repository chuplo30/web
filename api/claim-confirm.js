const { completeClaim } = require("../lib/store");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: "method" }));
  }
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    const token = String(body.token || "");
    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "0.0.0.0";
    const result = completeClaim(token, ip);
    if (!result.ok) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: result.error }));
    }
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, credits: result.claim.credits }));
  } catch (e) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: "failed" }));
  }
};
