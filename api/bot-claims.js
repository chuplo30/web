const { listPending, markGranted } = require("../lib/store");
const SECRET = "JFL4VPCdh4X5D0eztx5rl6HQScQ-QSVqTBMjoP-m3C6GoUO36vUhxJg6aWBMQ7Qu";

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  const secret = process.env.BOT_SECRET || SECRET;
  if (req.headers["x-bot-secret"] !== secret) {
    res.statusCode = 401;
    return res.end(JSON.stringify({ error: "unauthorized" }));
  }
  if (req.method === "GET") {
    const pending = listPending();
    res.statusCode = 200;
    return res.end(JSON.stringify({
      claims: pending.map((c) => ({
        token: c.token,
        userId: c.userId,
        credits: c.credits,
        completedIp: c.completedIp,
        completedAt: c.completedAt,
      })),
    }));
  }
  if (req.method === "POST") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    markGranted(String(body.token || ""));
    res.statusCode = 200;
    return res.end(JSON.stringify({ ok: true }));
  }
  res.statusCode = 405;
  res.end(JSON.stringify({ error: "method" }));
};
