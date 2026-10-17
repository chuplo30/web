const $ = (id) => document.getElementById(id);
let lastBlob = null;
let lastName = 'obfuscated.lua';

function applyResult(code, meta, inputLen) {
  $('outputLua').value = code;
  lastBlob = new Blob([code], { type: 'text/plain;charset=utf-8' });
  const base = ($('fname').value || 'obfuscated').replace(/[^a-zA-Z0-9_\-]/g, '_');
  lastName = base + '.lua';
  $('btnDl').disabled = !code;
  const m = meta || {};
  $('status').textContent =
    `OK ${code.length} bytes · pack=${m.pack || 'xor20-hex-xor20-base94'} · mode=${m.vmMode || '?'} · loadstring=${m.loadstring === false ? 'no' : m.loadstring}`;
}

$('fileInput').addEventListener('change', (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    $('inputLua').value = String(reader.result || '');
    $('status').textContent = 'Uploaded ' + f.name;
  };
  reader.readAsText(f);
});

$('btnObf').addEventListener('click', async () => {
  const input = $('inputLua').value || '';
  if (!input.trim()) {
    $('status').textContent = 'Error: empty input';
    return;
  }
  $('btnObf').disabled = true;
  $('status').textContent = 'Obfuscating (full pack + VM)...';
  try {
    // Prefer server API so luau-compile + full pack always available
    const res = await fetch('/api/obfuscate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: input }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
    applyResult(data.code, data.meta, input.length);
  } catch (err) {
    // Client fallback — still full pack path inside obfuscate.js
    try {
      const mod = await import('./js/obfuscate.js');
      const { code, meta } = mod.obfuscate(input, {});
      applyResult(code, meta || {}, input.length);
      $('status').textContent += ' (client)';
    } catch (err2) {
      console.error(err2);
      $('status').textContent =
        'Error: ' + (err2 && err2.message ? err2.message : err2) +
        ' | API: ' + (err && err.message ? err.message : err);
    }
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
