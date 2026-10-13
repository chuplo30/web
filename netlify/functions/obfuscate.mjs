/**
 * POST /api/obfuscate  →  /.netlify/functions/obfuscate
 * Body: { "code": "..." }
 */
import { obfuscate } from '../../js/obfuscate.js';

export async function handler(event) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ ok: false, error: 'POST only' }) };
  }
  try {
    const body = JSON.parse(event.body || '{}');
    const code = body.code || body.source || '';
    if (!String(code).trim()) {
      return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'empty code' }) };
    }
    const result = obfuscate(code);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, code: result.code, meta: result.meta }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }),
    };
  }
}
