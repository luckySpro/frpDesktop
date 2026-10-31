// Capture README screenshots from the production build running in demo mode.
// Usage: pnpm build && pnpm preview --port 4173 & node scripts/screenshots.mjs
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const base = process.env.BASE_URL ?? "http://127.0.0.1:4173";
const out = new URL("../../docs/screenshots/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const shots = [
  { name: "overview-light", tab: "overview", theme: "light" },
  { name: "overview-dark", tab: "overview", theme: "dark" },
  { name: "proxies-light", tab: "proxies", theme: "light" },
  { name: "proxy-editor-light", tab: "proxies", theme: "light", click: ".proxy-card" },
  { name: "certs-dark", tab: "certs", theme: "dark" },
  { name: "settings-light", tab: "settings", theme: "light" },
  { name: "overview-mobile-dark", tab: "overview", theme: "dark", width: 390, height: 844 },
  { name: "proxies-mobile-light", tab: "proxies", theme: "light", width: 390, height: 844 },
];

const browser = await chromium.launch();
let overflow = 0;
for (const s of shots) {
  const page = await browser.newPage({ viewport: { width: s.width ?? 1280, height: s.height ?? 800 }, deviceScaleFactor: 2 });
  await page.goto(`${base}/?tab=${s.tab}&theme=${s.theme}`);
  await page.waitForTimeout(900);
  if (s.click) {
    await page.click(s.click);
    await page.waitForTimeout(600);
  }
  const wide = await page.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > window.innerWidth + 1 && !el.closest(".ant-drawer, .log-panel, .cm-editor")) bad.push(el.className || el.tagName);
    }
    return { scroll: document.documentElement.scrollWidth > window.innerWidth, bad: bad.slice(0, 5) };
  });
  if (wide.scroll || wide.bad.length) {
    overflow++;
    console.warn(`overflow in ${s.name}:`, wide.bad);
  }
  await page.screenshot({ path: `${out}${s.name}.png` });
  await page.close();
  console.log("saved", s.name);
}
await browser.close();
process.exit(overflow ? 1 : 0);
