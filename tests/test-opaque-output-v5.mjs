import assert from 'node:assert/strict';
import { obfuscate } from '../js/obfuscate.js';

const src = 'local Players=game:GetService("Players"); print("hello",Players)';
const out = obfuscate(src, {debug:false}).code;
for (const plain of ['Players','Workspace','RunService','RemoteEvent','FireServer','hello','DataModel','HumanoidRigType','game:GetService','workspace:FindFirstChild','Instance','Enum']) {
  assert.equal(out.includes(plain), false, `plaintext leak: ${plain}`);
}
assert.equal(out.includes('string.char(104,101,108,108,111)'), false);
assert.ok(out.includes('94'));
console.log('opaque output v5: PASS');
