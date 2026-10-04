const { createClaim } = require("../lib/store");
const SECRET = "JFL4VPCdh4X5D0eztx5rl6HQScQ-QSVqTBMjoP-m3C6GoUO36vUhxJg6aWBMQ7Qu";

function siteUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return "https://" + String(process.env.VERCEL_URL).replace(/\/$/, "");
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || "https";
  if (host) return proto + "://" + host;
  return "";
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  const secret = process.env.BOT_SECRET || SECRET;
  if (req.headers["x-bot-secret"] !== secret) {
    res.statusCode = 401;
    return res.end(JSON.stringify({ error: "unauthorized" }));
  }
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: "method" }));
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  const userId = String(body.userId || "");
  const credits = Number(body.credits || 0);
  const layers = Number(body.layers || 1);
  if (!userId || ![100, 10000, 100000].includes(credits)) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: "bad_request" }));
  }
  const claim = createClaim(userId, credits, layers);
  const base = siteUrl(req);
  res.statusCode = 200;
  res.end(JSON.stringify({
    token: claim.token,
    claimUrl: base + "/claim.html?t=" + claim.token,
    credits: claim.credits,
    layers: claim.layers,
  }));
};
