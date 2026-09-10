const puppeteer = require("puppeteer-core");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: "new" });
  const page = await b.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  const errs = [];
  page.on("pageerror", e => errs.push(String(e)));
  page.on("console", m => { if (m.type()==="error") errs.push(m.text()); });
  await page.goto("http://localhost:3001/", { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(() => !!window.__navDebug, { timeout: 30000 });
  await new Promise(r => setTimeout(r, 2500));
  const d = await page.evaluate(() => window.__navDebug.__debugCurves());
  console.log(JSON.stringify(d, null, 1));
  console.log("ERRORS:", errs.length ? errs : "none");
  await b.close();
})();
