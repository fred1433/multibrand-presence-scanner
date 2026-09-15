// Optional: render a JavaScript-heavy page in a clean headless Chromium, so a
// thin served HTML does not read as "no tags found". Used only when the served
// HTML has almost no visible text.

export async function makeRenderer() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    return null;
  }
  let browser = null;
  const ensure = async () => (browser ??= await chromium.launch({ headless: true }));

  const renderer = async (url) => {
    const b = await ensure();
    const ctx = await b.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 },
    });
    const page = await ctx.newPage();
    const requests = [];
    page.on('request', (r) => { if (requests.length < 400) requests.push(r.url()); });
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
      await page.waitForTimeout(1500);
      const html = await page.content();
      return { html, requests };
    } finally {
      await ctx.close();
    }
  };
  renderer.close = async () => { if (browser) await browser.close(); browser = null; };
  return renderer;
}
