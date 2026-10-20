const $ = (id) => document.getElementById(id);
let lastBlob = null;
let lastName = 'obfuscated.lua';

$('fileInput').addEventListener('change', (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    $('inputLua').value = r.result;
    $('status').textContent = 'Uploaded: ' + f.name;
  };
  r.readAsText(f);
});

async function callApi(code) {
  const res = await fetch('/api/obfuscate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      'API not JSON (' + res.status + '): ' + text.slice(0, 200).replace(/\s+/g, ' ')
    );
  }
  if (!res.ok || !data.ok) {
    throw new Error((data && data.error) || ('HTTP ' + res.status));
  }
  return data;
}

function applyResult(code, meta, inputLen) {
  $('outputLua').value = code;
  const rn = 1000 + Math.floor(Math.random() * 9000);
  const base = ($('fname').value || 'obfuscated').replace(/[^a-zA-Z0-9_\-]/g, '_');
  lastName = `${base}_${rn}.lua`;
  lastBlob = new Blob([code], { type: 'text/plain;charset=utf-8' });
  $('btnDl').disabled = false;
  const kb = meta.outputBytes
    ? (meta.outputBytes / 1024).toFixed(1)
    : (code.length / 1024).toFixed(1);
  $('status').textContent =
    `OK ${meta.inputBytes || inputLen}B → ${kb}KB · mode=${meta.vmMode || meta.backend || 'wan'} · ${lastName}`;
}

$('btnObf').addEventListener('click', async () => {
  const input = $('inputLua').value;
  if (!String(input).trim()) {
    $('status').textContent = 'Error: Input is empty!';
    return;
  }
  $('status').textContent = 'Obfuscating (server API)...';
  $('btnObf').disabled = true;
  try {
    // Node-only engine (Clyde + pack) — never import obfuscate.js in browser
    const data = await callApi(input);
    applyResult(data.code || '', data.meta || {}, input.length);
  } catch (err) {
    console.error(err);
    $('status').textContent = 'Error: ' + (err && err.message ? err.message : String(err));
  } finally {
    $('btnObf').disabled = false;
  }
});

$('btnDl').addEventListener('click', () => {
  if (!lastBlob) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(lastBlob);
  a.download = lastName;
  a.click();
  URL.revokeObjectURL(a.href);
});
