#!/usr/bin/env python3
"""WAN Obfuscate — Flask wrapper for UptimeRobot + optional Node API bridge."""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

from flask import Flask, Response, jsonify, request, send_from_directory

ROOT = Path(__file__).resolve().parent
app = Flask(__name__, static_folder=str(ROOT), static_url_path="")

NODE = os.environ.get("NODE_BIN", "node")
PORT = int(os.environ.get("PORT", os.environ.get("FLASK_PORT", "10000")))


@app.get("/api/health")
@app.get("/health")
@app.get("/ping")
def health():
    """UptimeRobot target — always 200 when process is up."""
    return jsonify(ok=True, service="wan-obfuscate", runtime="flask", pack="clyde-wan")


@app.get("/")
def index():
    index_path = ROOT / "index.html"
    if index_path.is_file():
        return send_from_directory(ROOT, "index.html")
    return jsonify(ok=True, service="wan-obfuscate", hint="POST /api/obfuscate"), 200


@app.post("/api/obfuscate")
def obfuscate():
    """Bridge to Node obfuscate.js (Clyde-WAN primary)."""
    try:
        body = request.get_json(force=True, silent=True) or {}
        if isinstance(request.data, (bytes, bytearray)) and not body:
            try:
                body = json.loads(request.data.decode("utf-8", errors="replace"))
            except Exception:
                body = {"code": request.data.decode("utf-8", errors="replace")}
        code = body.get("code") or body.get("source") or ""
        if isinstance(request.data, (bytes, bytearray)) and request.content_type and "text/" in request.content_type:
            code = request.data.decode("utf-8", errors="replace")
        if not str(code).strip():
            return jsonify(ok=False, error="empty code"), 400

        opts = {k: v for k, v in body.items() if k not in ("code", "source")}
        # AT on by default
        if opts.get("at") is False:
            opts["noAT"] = True
        opts.pop("useCatph", None)
        opts["noCatph"] = True

        runner = r"""
import { obfuscate } from './js/obfuscate.js';
const input = process.argv[2];
const opts = JSON.parse(process.argv[3] || '{}');
try {
  const r = obfuscate(input, opts);
  process.stdout.write(JSON.stringify({ ok: true, code: r.code, meta: r.meta || {} }));
} catch (e) {
  process.stdout.write(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }));
  process.exitCode = 1;
}
"""
        proc = subprocess.run(
            [NODE, "--input-type=module", "-e", runner, code, json.dumps(opts)],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            timeout=120,
        )
        out = (proc.stdout or "").strip()
        if not out:
            err = (proc.stderr or "").strip() or "empty node output"
            return jsonify(ok=False, error=err), 500
        try:
            data = json.loads(out)
        except json.JSONDecodeError:
            return jsonify(ok=False, error="bad node json", raw=out[:500]), 500
        if not data.get("ok"):
            return jsonify(data), 500
        return jsonify(data)
    except subprocess.TimeoutExpired:
        return jsonify(ok=False, error="obfuscate timeout"), 504
    except Exception as e:
        return jsonify(ok=False, error=str(e)), 500


@app.after_request
def cors(resp: Response):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    resp.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
    return resp


@app.route("/api/obfuscate", methods=["OPTIONS"])
def obfuscate_opts():
    return ("", 204)


if __name__ == "__main__":
    print(f"[WAN] Flask on 0.0.0.0:{PORT}  health=/api/health  obfuscate=POST /api/obfuscate")
    app.run(host="0.0.0.0", port=PORT, debug=False, threaded=True)
