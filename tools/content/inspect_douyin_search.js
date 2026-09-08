const path = require('path');
const { chromium } = require('playwright');

const queries = [
  '抖音美团代运营',
  '本地生活代运营',
  '门店托管运营',
  '按摩店运营',
  '单体门店对抗连锁店'
];

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
  for (const q of queries) {
    await page.goto(`https://www.douyin.com/search/${encodeURIComponent(q)}?type=general`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);
    await page.screenshot({ path: path.resolve(__dirname, '..', '..', `douyin-search-${queries.indexOf(q) + 1}.png`), fullPage: true });
    const text = (await page.locator('body').innerText()).replace(/\n{2,}/g, '\n');
    console.log(`\n=== ${q} ===\n${text.slice(0, 8000)}`);
  }
  await browser.close();
})().catch((err) => { console.error(err); process.exit(1); });
