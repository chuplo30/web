const { getPaste } = require("../lib/store");

module.exports = async (req, res) => {
  try {
    const id = (req.query && req.query.id) || "";
    if (!id) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "text/plain");
      return res.end("missing id");
    }
    const paste = await getPaste(id);
    if (!paste || paste.content == null) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.end("not found");
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.end(paste.content);
  } catch (e) {
    res.statusCode = 500;
    res.end("error");
  }
};
