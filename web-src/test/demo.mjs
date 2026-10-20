// node test/demo.mjs out.webm  -- a short recording: d6 + d10 + d20 thrown together, key 5 back to one d20,
// a d100 with a d10 (10 to 100 plus 1 to 10), and the key legend in Kingthings Petrock, played with the player's keys in the browser preview.
import puppeteer from 'puppeteer-core';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2];
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--allow-file-access-from-files'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
await page.goto(pathToFileURL(join(here, '..', '..', 'Client', 'web', 'index.html')).href);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => !document.body.classList.contains('loading'), { timeout: 20000 });
await page.evaluate(() => document.fonts.ready);
// the preview panel is for testing; hide it for the recording
await page.addStyleTag({ content: '#mock { display: none !important; }' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = async (k, wait = 350) => { await page.keyboard.press(k); await sleep(wait); };
const landed = async () => {
  const n = await page.evaluate(() => window.__rproll.throws);
  await page.waitForFunction((x) => window.__rproll.throws > x, { timeout: 15000 }, n);
};
const setTo = (id) => page.click(`.set[data-id="${id}"]`);

await setTo('imperial');
await sleep(800);
const rec = await page.screencast({ path: out });
await sleep(1200);
await key('1'); await key('2'); await key('3', 900);   // d6, d10, d20
await key('Space', 0);
await landed();
await sleep(2200);
await key('5', 1600);                                  // back to one placeholder d20
await setTo('orc');
await sleep(900);
await key('4', 1000);                                  // the placeholder becomes one d100
await key('2', 1000);                                  // and a d10 with it
await key('Space', 0);
await landed();
await sleep(2600);
await rec.stop();
await browser.close();
console.log('recorded', out);
