// Optional and deliberately narrow: open the Google listing a brand links to
// from its own pages, in a clean headless Chromium, and read what that listing
// says. There is no search here and no resolver: if a site publishes no link,
// the listing is reported as unverified, never guessed at from a name.
//
// The reason for the narrowness is that a brand, an establishment and a listing
// are three different things. One brand can run several establishments, and an
// establishment can carry more than one listing. Only the link a brand puts on
// its own page ties one of them to that brand without an assumption.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

const digits = (s) => String(s ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
const host = (u) => {
  try { return new URL(/^https?:/.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; }
};

/** The hex place id in a /maps/place/ URL carries the listing's id. */
export function cidFromPlaceUrl(url) {
  const hex = /!1s(0x[0-9a-f]+):(0x[0-9a-f]+)/i.exec(url);
  if (hex) {
    try {
      const decimal = BigInt(hex[2]).toString();
      return { decimal, maps_url: `https://www.google.com/maps?cid=${decimal}` };
    } catch { /* fall through */ }
  }
  const cidParam = /[?&]cid=(\d{6,})/.exec(url);
  if (cidParam) return { decimal: cidParam[1], maps_url: `https://www.google.com/maps?cid=${cidParam[1]}` };
  return null;
}

const withEnglish = (url) => {
  try {
    const u = new URL(url);
    u.searchParams.set('hl', 'en');
    u.searchParams.set('gl', 'us');
    return u.toString();
  } catch { return url; }
};

async function readPlace(page) {
  await page.waitForSelector('h1', { timeout: 20000 }).catch(() => {});
  for (let i = 0; i < 12; i++) {
    const ready = await page.evaluate(() => {
      const t = document.querySelector('div.F7nice')?.textContent ?? '';
      return /\d\s*\(\s*[\d.,  ]+\s*\)/.test(t) || /No reviews/i.test(document.body.innerText);
    });
    if (ready) break;
    await page.waitForTimeout(1800);
  }
  return page.evaluate(() => {
    const clean = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() || null : v);
    const txt = (el) => clean(el ? el.textContent : null);
    const attr = (sel, a) => { const el = document.querySelector(sel); return el ? el.getAttribute(a) : null; };
    const stripLabel = (v) => (v ? String(v).replace(/^[^:]{3,24}:\s*/, '') : null);
    // Read only inside the place panel, so a neighbouring business on the map
    // is never reported as this one.
    const panel = document.querySelector('[role="main"]');
    const panelText = panel?.innerText ?? '';
    const score = txt(document.querySelector('div.F7nice')) || '';
    const withCount = /([0-9](?:[.,][0-9])?)\s*\(\s*([0-9][0-9.,   ]*)\)/.exec(score) ||
      /([0-9](?:[.,][0-9])?)\s*\(\s*([0-9][0-9.,   ]*)\)/.exec(panelText);
    const ratingOnly = /^\s*([0-9](?:[.,][0-9])?)\s*$/.exec(score);
    return {
      name: txt(document.querySelector('h1')),
      address: clean(stripLabel(attr('button[data-item-id="address"]', 'aria-label'))),
      website: clean(stripLabel(attr('a[data-item-id="authority"]', 'aria-label')) || attr('a[data-item-id="authority"]', 'href')),
      phone: clean(stripLabel(attr('button[data-item-id^="phone:tel:"]', 'aria-label'))),
      rating: withCount ? Number(withCount[1].replace(',', '.')) : ratingOnly ? Number(ratingOnly[1].replace(',', '.')) : null,
      reviews: withCount ? Number(withCount[2].replace(/\D/g, '')) : /No reviews/i.test(panelText) ? 0 : null,
      category: txt(document.querySelector('button[jsaction*="category"]')),
      marked_permanently_closed: /Permanently closed/i.test(panelText),
      shown_as_unclaimed: /Claim this business/i.test(panelText),
    };
  });
}

/**
 * Open every Google listing the brand links to. Nothing is searched for, and
 * nothing is attributed that the brand did not publish itself.
 */
export async function lookupListing(scan) {
  const published = (scan.profile_links?.google_listing ?? []).map((f) => f.value).slice(0, 3);
  if (!published.length) {
    return {
      state: 'unverified',
      listings: [],
      note: 'This site publishes no link to a Google listing. Which listings belong to this brand, and to which establishment, is not decidable from the public pages alone.',
    };
  }

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    return { state: 'collection_error', listings: [], note: 'playwright is not installed, so the published listing was not opened' };
  }

  const site = scan.pages?.[0]?.url ?? scan.url;
  const phones = (scan.nap?.phones ?? []).map((p) => p.value);
  const browser = await chromium.launch({ headless: true });
  const listings = [];
  const attempts = [];

  try {
    for (const link of published) {
      const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 }, locale: 'en-US', timezoneId: 'America/New_York' });
      const page = await ctx.newPage();
      try {
        await page.goto(withEnglish(link), { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(6000);
        const place = await readPlace(page);
        if (!place?.name) {
          attempts.push({ source: link, state: 'collection_error', note: 'the listing page did not render a place panel in this run' });
          continue;
        }
        const cid = cidFromPlaceUrl(page.url()) ?? cidFromPlaceUrl(link);
        listings.push({
          ...place,
          attribution: 'published as a link on the brand site',
          cid: cid?.decimal ?? null,
          evidence_url: cid?.maps_url ?? page.url(),
          source_link: link,
          phone_matches_a_site_number: place.phone && phones.length ? phones.some((p) => digits(p) === digits(place.phone)) : null,
          website_matches_this_site: place.website ? host(site) === host(place.website) : null,
          checked_at: new Date().toISOString(),
        });
        attempts.push({ source: link, state: 'observed', note: null });
      } catch (err) {
        attempts.push({ source: link, state: 'collection_error', note: String(err.message || err).slice(0, 160) });
      } finally {
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }

  return {
    state: listings.length ? 'observed' : 'collection_error',
    listings,
    attempts,
    note: listings.length
      ? 'Opened from the link the brand publishes. A brand may run more listings than it links to; those are not decidable from the public pages.'
      : 'The published link did not open a listing in this run.',
  };
}
