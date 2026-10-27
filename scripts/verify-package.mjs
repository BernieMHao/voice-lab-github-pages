import { readdir, stat, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
const root = fileURLToPath(new URL('../', import.meta.url));
const publicDir = join(root, 'public');
let total = 0, largest = 0;
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes:true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else { const bytes = (await stat(path)).size; total += bytes; largest = Math.max(largest, bytes); assert.ok(bytes < 100 * 1024 ** 2, `GitHub file limit exceeded: ${path}`); }
  }
}
await walk(publicDir);
assert.ok(total < 900 * 1024 ** 2, 'Static assets exceed the Pages budget');
const catalog = JSON.parse(await readFile(join(publicDir, 'catalog.json')));
assert.equal(Object.keys(catalog.models).length, 15);
assert.equal(catalog.defaultModel, '2m');
for (const model of Object.values(catalog.models)) {
  assert.equal(model.files.reduce((sum,f) => sum + f.bytes, 0), model.bytes);
  for (const file of model.files) {
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
    assert.ok(file.path.startsWith('models/'));
    if (file.parts) {
      assert.equal(file.parts.reduce((sum,p) => sum + p.bytes, 0), file.bytes);
      for (const part of file.parts) assert.equal((await stat(join(publicDir,part.url))).size, part.bytes);
      const hash = createHash('sha256');
      for (const part of file.parts) for await (const data of createReadStream(join(publicDir,part.url))) hash.update(data);
      assert.equal(hash.digest('hex'),file.sha256,`Split asset integrity: ${file.path}`);
    } else if (!file.url.startsWith('https://')) {
      const data = await readFile(join(publicDir,file.url));
      assert.equal(data.length,file.bytes);
      assert.equal(createHash('sha256').update(data).digest('hex'),file.sha256,`Static asset integrity: ${file.path}`);
    }
    else assert.ok(file.url.startsWith('https://huggingface.co/'));
  }
}
console.log(`PASS: 15 model downloads, default 2M, static assets ${(total/1024**2).toFixed(1)} MB, largest Git file ${(largest/1024**2).toFixed(1)} MB`);
