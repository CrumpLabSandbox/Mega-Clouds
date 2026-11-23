// Smoke test of the real app: open it, switch through every scene, report errors.
//   node tools/smoke.mjs [out.png]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw;
for (const c of [process.env.PLAYWRIGHT, 'playwright', '/Users/mattcrump/Documents/GitHub/CrumpLabSandbox/next-up/node_modules/playwright']) {
  if (!c) continue; try { pw = require(c); break; } catch {}
}
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const srv = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]); if (u.endsWith('/')) u += 'index.html';
  const f = path.join(root, u);
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
}).listen(0);
const out = process.argv[2] || '/tmp/mega-clouds-smoke.png';
const b = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text().slice(0, 300)); });
await p.goto(`http://localhost:${srv.address().port}/?scene=sky-fair`);
await p.waitForTimeout(2000);
const ids = await p.evaluate(() => window.megaClouds.scenes.map(s => s.id));
console.log('scenes:', ids.length);
for (const id of ids) {
  const n = errs.length;
  await p.evaluate(id => window.megaClouds.setScene(id), id);
  await p.waitForTimeout(150);
  if (errs.length > n) console.log('  after', id, '→', errs.slice(n).join(' | '));
}
await p.evaluate(() => window.megaClouds.setScene('volumetric-cumulus'));
await p.waitForTimeout(1500);
await p.screenshot({ path: out });
console.log(errs.length ? `${errs.length} errors/warnings` : 'no errors');
await b.close(); srv.close();
