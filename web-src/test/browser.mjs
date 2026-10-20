// node test/browser.mjs [--record out.webm] [--shots dir]
// Opens the built page (../Client/web/index.html) in Chrome through the browser preview and plays it with the
// player's keys: the placeholder d20 rules, 1-5, Space, Tab and arrows (up/down pick a die, right adds, left takes
// one away), V for light or dark, the stand-in chat with /roll and /board, the 6th-die refusal, and the Kingthings legend. Every throw must end with each die showing the server's number.
import puppeteer from 'puppeteer-core';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const page_url = pathToFileURL(join(here, '..', '..', 'Client', 'web', 'index.html')).href;
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
const record = arg('--record');
const shots = arg('--shots');
const KINDS = ['d6', 'd10', 'd20', 'd100'];

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required',
    '--allow-file-access-from-files'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
const errors = [];
const logs = [];
page.on('console', (m) => { logs.push(m.text()); if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(page_url);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => document.querySelector('#mock') && !document.querySelector('#mock').hidden, { timeout: 20000 });
await page.waitForFunction(() => !document.body.classList.contains('loading'), { timeout: 20000 });
await new Promise((r) => setTimeout(r, 400));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, label) => { if (!ok) failures++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); };
const tray = () => page.$$eval('.tile', (t) => Object.fromEntries(t.map((el) => [el.dataset.kind, Number(el.querySelector('.badge').textContent)])));
const placeholder = () => page.$eval('.tile[data-kind="d20"]', (el) => el.classList.contains('placeholder'));
const same = (a, b) => KINDS.every((k) => (a[k] || 0) === (b[k] || 0));
const press = async (...keys) => { for (const k of keys) { await page.keyboard.press(k); await sleep(60); } };
const throws = () => page.evaluate(() => window.__rproll.throws);
async function landedAfter(before, label, want) {
  await page.waitForFunction((n) => window.__rproll.throws > n, { timeout: 15000 }, before);
  const r = await page.evaluate(() => window.__rproll.last);
  const text = (await page.$eval('#banner-text', (e) => e.textContent)).trim();
  const sum = r.values.reduce((s, v) => s + v, 0);
  const ok = same(r.counts, want) && r.expected.every((v, i) => v === r.landed[i]) && text.includes(String(sum)) && r.texturesOk;
  check(ok, `${label}: ${JSON.stringify(r.counts)} values ${r.values.join(',')} faces ${r.landed.join(',')} "${text}"`);
  return r;
}

let recorder = null;
if (record) recorder = await page.screencast({ path: record });

// the legend and its font
const fontOk = await page.evaluate(async () => {
  await document.fonts.ready;
  const fam = getComputedStyle(document.querySelector('.legend h2')).fontFamily;
  return document.fonts.check('20px "Petrock"') && document.fonts.check('20px "Petrock Light"') && fam.includes('Petrock');
});
check(fontOk, 'the key legend is in the right panel, in Kingthings Petrock');
check(await page.$eval('.legend', (el) => el.closest('.panel.right') !== null && el.getBoundingClientRect().bottom > window.innerHeight * 0.6), 'the legend sits at the foot of the right panel');

// the placeholder d20
check(same(await tray(), { d20: 1 }) && await placeholder(), 'the tray opens with one placeholder d20');
await press('1');
check(same(await tray(), { d6: 1 }) && !(await placeholder()), '1 replaces it with a d6');
await press('1');
check(same(await tray(), { d6: 2 }), '1 again: d6, d6');
await press('3');
check(same(await tray(), { d6: 2, d20: 1 }), '3: d6, d6, d20');
await press('5');
check(same(await tray(), { d20: 1 }) && await placeholder(), '5 clears back to one placeholder d20');
await press('3');
check(same(await tray(), { d20: 1 }) && !(await placeholder()), '3 first: the placeholder becomes a real d20, still one');
await press('3');
check(same(await tray(), { d20: 2 }), '3 again: two d20');
await press('Tab', 'ArrowLeft', 'ArrowDown', 'ArrowDown');
check(same(await tray(), { d20: 1 }) || same(await tray(), { d20: 2 }), 'Tab and arrows move between dice and set');
// back on the dice: emptying them with the arrows gives the placeholder again
if ((await page.evaluate(() => document.body.dataset.focus)) !== 'dice') await press('Tab');
const cursorAt = () => page.$$eval('.tile', (t) => t.findIndex((el) => el.classList.contains('cursor')));
for (let i = 0; i < 4 && (await cursorAt()) !== 2; i++) await press('ArrowDown');
for (let i = 0; i < 3; i++) await press('ArrowLeft');
check(same(await tray(), { d20: 1 }) && await placeholder(), 'removing the last die with the left arrow gives the placeholder d20');
// up and down walk the rows and wrap; right adds the die under the cursor, left takes one away
await press('ArrowDown', 'ArrowDown');
const wrapped = await cursorAt();
await press('ArrowUp');
const back = await cursorAt();
check(wrapped === 0 && back === 3, `down from D100 wraps to D6, up from D6 wraps to D100 (${wrapped}, ${back})`);
await press('ArrowRight', 'ArrowRight');
check(same(await tray(), { d100: 2 }) && !(await placeholder()), 'right arrow adds the die under the cursor: d100, d100');
await press('ArrowLeft');
check(same(await tray(), { d100: 1 }), 'left arrow takes one away: d100');
// V: light or dark, light first
check(await page.evaluate(() => document.body.dataset.theme) === 'light', 'the board opens in light');
await press('v');
check(await page.evaluate(() => document.body.dataset.theme === 'dark' && document.getElementById('theme-state').textContent === 'dark'), 'V switches to dark');
await press('v');
check(await page.evaluate(() => document.body.dataset.theme) === 'light', 'V again: back to light');
await press('5');

// d6 + d10 + d20 together, with Space
await press('5', '1', '2', '3');
check(same(await tray(), { d6: 1, d10: 1, d20: 1 }), '5, 1, 2, 3: d6, d10, d20');
await sleep(500);
await press('Space');
await landedAfter(await throws(), 'Space throws d6 + d10 + d20', { d6: 1, d10: 1, d20: 1 });
if (shots) await page.screenshot({ path: join(shots, 'd6-d10-d20.png') });
await sleep(1800);

// a single d100, with a chosen number
await press('5', '4');
check(same(await tray(), { d100: 1 }), '5, 4: one d100, a single die');
await sleep(500);
await page.select('#mock-value', '70');
let before = await throws();
await page.click('button[data-mock="forced"]');
await landedAfter(before, 'one d100 lands on 70', { d100: 1 });
check(await page.evaluate(() => document.querySelectorAll('#tags .tag').length === 1), 'one tag for the d100');
if (shots) await page.screenshot({ path: join(shots, 'd100.png') });
await sleep(1800);

// up to 5
await press('5', '1', '1', '1', '1', '1');
const fiveD6 = await tray();
await press('2');
const countText = await page.$eval('#count', (e) => e.textContent);
check(same(await tray(), fiveD6) && /Up to 5/.test(countText), `a 6th die is refused ("${countText}") and nothing changes`);

// the stand-in chat: typing never acts on the board
await press('5');
await press('k');
check(await page.$eval('#chat', (e) => !e.hidden), 'K opens chat while the board is open');
before = await throws();
await page.keyboard.type('1 3 ');
check(same(await tray(), { d20: 1 }) && (await throws()) === before, 'typing "1 3 " in chat adds no die and throws nothing');
await page.keyboard.press('Escape');
check(await page.$eval('#chat', (e) => e.hidden), 'Escape closes chat, back to the board');
await press('1');
check(same(await tray(), { d6: 1 }), 'with chat closed the keys work on the board again');

// /roll with arguments while the board is open: sets the tray and throws
await press('k');
before = await throws();
await page.keyboard.type('/roll 2d10');
await page.keyboard.press('Enter');
await landedAfter(before, '/roll 2d10 with the board open sets the tray and throws', { d10: 2 });
check(same(await tray(), { d10: 2 }), 'the tray now holds 2d10');
await sleep(1800);
// /roll with no arguments throws what is in the tray
await press('k');
before = await throws();
await page.keyboard.type('/roll');
await page.keyboard.press('Enter');
await landedAfter(before, '/roll with the board open throws the tray', { d10: 2 });
await sleep(1800);
// a bad /roll changes nothing
await press('k');
before = await throws();
await page.keyboard.type('/roll 3d6+3d20');
await page.keyboard.press('Enter');
await sleep(600);
check(same(await tray(), { d10: 2 }) && (await throws()) === before, '/roll with 6 dice is refused, tray unchanged');

// /board closes it; a closed board ignores the keys; /roll is a chat line only; Home opens it again
await press('k');
await page.keyboard.type('/board');
await page.keyboard.press('Enter');
await page.waitForFunction(() => document.body.classList.contains('closed'), { timeout: 3000 });
check(true, '/board closes the board');
before = await throws();
await press('1', 'Space', '5');
check(same(await tray(), { d10: 2 }) && (await throws()) === before, 'a closed board ignores 1, Space and 5');
await press('k');
await page.keyboard.type('/roll 1d20');
await page.keyboard.press('Enter');
await sleep(500);
const lastLine = await page.$eval('#chat-lines', (e) => e.lastElementChild?.textContent || '');
check(/rolled 1d20/.test(lastLine) && (await throws()) === before, `/roll with the board closed is a chat line only ("${lastLine}")`);
await press('Home');
await page.waitForFunction(() => !document.body.classList.contains('closed'), { timeout: 3000 });
check(true, 'Home opens the board again');

// a pick the game never got is sent again until the game's state shows it
await page.click('#mock-lose');
await press('5', '3', '3');
await page.click('#mock-lose');
await sleep(1500);
before = await throws();
await press('Space');
await page.waitForFunction((n) => window.__rproll.throws > n && window.__rproll.last.counts.d20 === 2, { timeout: 15000 }, before)
  .then(() => check(true, 'a lost pick is sent again and thrown'))
  .catch(() => check(false, 'a lost pick is sent again and thrown'));
if (recorder) await recorder.stop();

// the pick and the theme survive a reload
await press('5', '2', '4', 'v');
await sleep(300);
await page.reload();
await page.waitForFunction(() => !document.body.classList.contains('loading'), { timeout: 20000 });
check(same(await tray(), { d10: 1, d100: 1 }), 'the tray comes back after a reload');
check(await page.evaluate(() => document.body.dataset.theme) === 'dark', 'dark is still on after a reload');

console.log(logs.find((l) => l.includes('WebGL')) || 'no WebGL line');
if (errors.length) {
  failures += errors.length;
  console.log('page errors:\n  ' + errors.join('\n  '));
}
await browser.close();
console.log(failures ? `${failures} failure(s)` : 'all passed');
process.exit(failures ? 1 : 0);
