const { getPaste } = require("../lib/store");

module.exports = (req, res) => {
  const id = (req.query && req.query.id) || "";
  if (!id) {
    res.statusCode = 400;
    return res.end("missing id");
  }
  const paste = getPaste(id);
  if (!paste) {
    res.statusCode = 404;
    return res.end("not found");
  }
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(paste.content);
};
