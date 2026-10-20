// Builds the dice tray page into ../Client/web, which the client build copies into the mod's client\web.
//   node build.mjs          (in RpRoll\web-src; npm install once first)
// The same folder runs in a normal browser: open Client/web/index.html and the preview controls appear.
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'Client', 'web');
const sets = ['altmer', 'argonian', 'ayleid', 'bosmer', 'breton', 'daedric', 'dunmer', 'imperial', 'khajiit',
  'nord', 'orc', 'redguard'];
const kinds = ['d20', 'd6', 'd100', 'd10'];
const TEMPLATE_SET = 'imperial'; // whose GLB carries each kind's geometry and material setup

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'assets'), { recursive: true });

await build({
  entryPoints: [join(here, 'src', 'main.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['chrome120'],
  outfile: join(out, 'app.js'),
  loader: { '.json': 'json' },
  legalComments: 'none',
  banner: { js: '/* RpRoll dice tray. Includes three.js (MIT, see licenses/three.LICENSE.txt). */' },
  logLevel: 'warning',
});

cpSync(join(here, 'src', 'index.html'), join(out, 'index.html'));
cpSync(join(here, 'src', 'style.css'), join(out, 'style.css'));

// Assets are scripts calling RPROLL_ASSET(name, payload); see loadAsset in main.js for why not plain files.
const script = (name, payload) =>
  writeFileSync(join(out, 'assets', `${name}.js`), `RPROLL_ASSET(${JSON.stringify(name)},${JSON.stringify(payload)});\n`);

// A GLB is a JSON chunk plus one binary chunk; images are byte ranges of the binary chunk.
function glbImages(file) {
  const b = readFileSync(file);
  const jsonLength = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jsonLength).toString('utf8'));
  const binStart = 20 + jsonLength + 8;
  const images = {};
  for (const img of json.images || []) {
    const view = json.bufferViews[img.bufferView];
    const start = binStart + (view.byteOffset || 0);
    images[img.name.split('_').pop()] = b.subarray(start, start + view.byteLength).toString('base64');
  }
  return images;
}

script('board', readFileSync(join(here, 'assets', 'board.glb')).toString('base64'));
// One die of each kind, whole: its geometry and material; every set swaps its own pictures in.
for (const k of kinds) script(`die-${k}`, readFileSync(join(here, 'assets', 'dice', `${TEMPLATE_SET}-${k}.glb`)).toString('base64'));
// Per set only the pictures: { kind: { color, orm, nrm, emit? } } as base64 WebP.
const NAMES = { color: 'color', orm: 'orm', nrm: 'nrm', emit: 'emit' };
for (const s of sets) {
  const payload = {};
  for (const k of kinds) {
    const imgs = glbImages(join(here, 'assets', 'dice', `${s}-${k}.glb`));
    payload[k] = {};
    for (const [key, name] of Object.entries(NAMES)) if (imgs[name]) payload[k][key] = imgs[name];
    if (!payload[k].color || !payload[k].orm || !payload[k].nrm) throw new Error(`${s}-${k}.glb is missing a texture`);
  }
  script(s, payload);
}

mkdirSync(join(out, 'icons'));
for (const s of sets) for (const k of ['d6', 'd10', 'd20', 'd100']) {
  cpSync(join(here, 'assets', 'icons', `${s}-${k}.webp`), join(out, 'icons', `${s}-${k}.webp`));
}

mkdirSync(join(out, 'fonts'));
cpSync(join(here, 'assets', 'fonts', 'Cinzel-Bold.ttf'), join(out, 'fonts', 'Cinzel-Bold.ttf'));
cpSync(join(here, 'assets', 'fonts', 'OFL.txt'), join(out, 'fonts', 'OFL.txt'));
// Kingthings Petrock: the author's files, unchanged (his EULA asks for that), with his EULA next to them.
for (const name of ['Kingthings Petrock.ttf', 'Kingthings Petrock light.ttf', 'kingthingsEULA.txt']) {
  cpSync(join(here, 'assets', 'fonts', name), join(out, 'fonts', name));
}

mkdirSync(join(out, 'licenses'));
cpSync(join(here, 'node_modules', 'three', 'LICENSE'), join(out, 'licenses', 'three.LICENSE.txt'));
writeFileSync(join(out, 'licenses', 'README.txt'), [
  'Third-party parts of the RpRoll dice tray page:',
  '- three.js 0.185.1 (bundled in app.js): MIT, three.LICENSE.txt',
  '- Cinzel Bold (fonts/Cinzel-Bold.ttf): SIL Open Font License 1.1, ../fonts/OFL.txt',
  '- Kingthings Petrock and Petrock Light by Kevin King (fonts/Kingthings Petrock*.ttf): free for any use, files unchanged, ../fonts/kingthingsEULA.txt',
  'The dice, the board and the icons are part of RpRoll: MIT, see LICENSE in the source repository.',
  '',
].join('\n'));

// Size check: client\ goes to every player who joins.
const files = [];
const walk = (d) => readdirSync(d).forEach((f) => {
  const p = join(d, f);
  if (statSync(p).isDirectory()) walk(p); else files.push([p.slice(out.length + 1), statSync(p).size]);
});
walk(out);
const sum = (list) => list.reduce((s, [, n]) => s + n, 0);
const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
const group = (re) => files.filter(([f]) => re.test(f.replace(/\\/g, '/')));
console.log(`Client/web: ${files.length} files, ${mb(sum(files))}`);
console.log(`  app.js ${kb(sum(group(/^app\.js$/)))}, board ${kb(sum(group(/^assets\/board\.js$/)))}, ` +
  `dice shapes ${kb(sum(group(/^assets\/die-/)))}, 12 sets ${kb(sum(group(/^assets\/(?!die-|board)/)))} ` +
  `(largest ${kb(Math.max(...group(/^assets\/(?!die-|board)/).map(([, n]) => n)))}), icons ${kb(sum(group(/^icons\//)))}`);
if (!existsSync(join(out, 'app.js'))) process.exit(1);
