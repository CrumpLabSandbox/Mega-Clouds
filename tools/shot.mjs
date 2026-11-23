// Screenshot every scene of an engine (or the app) headlessly.
//   node tools/shot.mjs <engine[,engine]> [out.png] [extra query, e.g. "t=40&frames=5"]
//   node tools/shot.mjs --page "index.html#volumetric-cumulus" out.png
// Prints errors and per-scene timing. Needs Playwright (set PLAYWRIGHT=path/to/playwright if it isn't resolvable).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw;
for (const c of [process.env.PLAYWRIGHT, 'playwright', '/Users/mattcrump/Documents/GitHub/CrumpLabSandbox/next-up/node_modules/playwright']) {
  if (!c) continue; try { pw = require(c); break; } catch {}
}
if (!pw) { console.error('Playwright not found'); process.exit(1); }
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(req.url.split('?')[0].split('#')[0]));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
}).listen(0);
const port = server.address().port;
const args = process.argv.slice(2);
const page = args[0] === '--page';
const target = page ? args[1] : args[0];
const out = (page ? args[2] : args[1]) || `/tmp/shot-${target.replace(/[^a-z0-9]+/gi, '_')}.png`;
const extra = page ? '' : (args[2] ? '&' + args[2] : '');
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const pg = await browser.newPage({ viewport: { width: page ? 1280 : 1460, height: page ? 720 : 900 } });
const errs = [];
pg.on('pageerror', e => errs.push(e.message));
pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
const url = page ? `http://localhost:${port}/${target}` : `http://localhost:${port}/tools/preview.html?engine=${target}${extra}`;
await pg.goto(url);
if (page) await pg.waitForTimeout(+(process.env.WAIT || 4000));
else await pg.waitForFunction(() => window.__done !== undefined, null, { timeout: 180000 });
const caps = page ? [] : await pg.$$eval('figcaption', els => els.map(e => e.textContent));
await pg.screenshot({ path: out, fullPage: !page });
console.log(caps.join('\n'));
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no errors');
console.log('screenshot:', out);
await browser.close(); server.close();
