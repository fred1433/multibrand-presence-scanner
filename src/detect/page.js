// Dependency-free extraction of the page facts a local-presence audit needs:
// title and description, schema.org, NAP, and the outbound profile links a
// brand publishes about itself (Google listing, Yelp, Facebook).

import { finding, collapse, snippetAt } from '../evidence.js';

/** Decode the entities a reader would never see, and only those. An em or en
 *  dash entity is left alone so a quoted title is never altered silently. */
export function decodeEntities(text) {
  return String(text ?? '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&(?:apos|#0?39);/g, "'")
    .replace(/&(?:rsquo|#8217);/g, '\u2019')
    .replace(/&(?:lsquo|#8216);/g, '\u2018')
    .replace(/&(?:ldquo|#8220);/g, '\u201c')
    .replace(/&(?:rdquo|#8221);/g, '\u201d')
    .replace(/&(?:hellip|#8230);/g, '\u2026')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

const PHONE_RE = /(?:\+?1[\s.\-]?)?\(?\b([2-9]\d{2})\)?[\s.\-]?(\d{3})[\s.\-]?(\d{4})\b/g;

const normalisePhone = (a, b, c) => `(${a}) ${b}-${c}`;

/** Form placeholders and reserved ranges are not phone numbers. */
export function isPlaceholderPhone(value) {
  const digits = value.replace(/\D/g, '');
  if (/^(\d)\1{9}$/.test(digits)) return true;            // 9999999999
  if (/^555555|^\d{3}555(?:01\d\d)$/.test(digits)) return true; // 555-01xx reserved
  if (digits.startsWith('123456')) return true;
  return false;
}

/** Text a human sees: scripts, styles and every tag attribute removed. */
export function visibleText(html) {
  return collapse(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' '),
  ).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'");
}

/** Phone numbers. `tel:` links first, because those are unambiguous. */
export function extractPhones(html, pageUrl) {
  const out = new Map();

  const telRe = /<a[^>]*href=["']tel:([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = telRe.exec(html)) !== null) {
    const digits = m[1].replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
    if (digits.length !== 10) continue;
    const value = normalisePhone(digits.slice(0, 3), digits.slice(3, 6), digits.slice(6));
    if (isPlaceholderPhone(value) || out.has(value)) continue;
    out.set(value, finding({ value, url: pageUrl, source: html, index: m.index, length: m[0].length, method: 'tel: link', extra: { click_to_call: true } }));
  }

  const text = visibleText(html);
  PHONE_RE.lastIndex = 0;
  while ((m = PHONE_RE.exec(text)) !== null) {
    const value = normalisePhone(m[1], m[2], m[3]);
    if (isPlaceholderPhone(value) || out.has(value)) continue;
    out.set(value, finding({ value, url: pageUrl, source: text, index: m.index, length: m[0].length, method: 'visible text' }));
    if (out.size >= 14) break;
  }
  return [...out.values()];
}

const ADDRESS_RE = /\b(\d{1,6}[A-Z]?\s+[A-Z][A-Za-z0-9.'\-]*(?:\s+[A-Za-z0-9.'\-]+){0,5}\s+(?:Street|St|Road|Rd|Drive|Dr|Avenue|Ave|Lane|Ln|Way|Boulevard|Blvd|Turnpike|Terminal|Place|Pl|Court|Ct|Highway|Hwy|Parkway|Pkwy)\b[.,]?(?:\s+(?:Suite|Ste|Unit|Floor|Fl|#)\s*[A-Za-z0-9-]+[.,]?)?)\s*,?\s*([A-Z][A-Za-z.\- ]{2,24}),?\s+(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\s+(\d{5})(?:-\d{4})?\b/g;

export function extractAddresses(html, pageUrl) {
  const text = visibleText(html);
  const out = new Map();
  ADDRESS_RE.lastIndex = 0;
  let m;
  while ((m = ADDRESS_RE.exec(text)) !== null) {
    const literal = collapse(m[0]).replace(/\s*,\s*,+/g, ',').replace(/\s+,/g, ',');
    if (out.has(literal)) continue;
    out.set(
      literal,
      finding({
        value: literal,
        url: pageUrl,
        source: text,
        index: m.index,
        length: m[0].length,
        method: 'visible text',
        extra: { parts: { street: collapse(m[1]).replace(/,$/, ''), locality: collapse(m[2]), region: m[3], postal_code: m[4] } },
      }),
    );
    if (out.size >= 10) break;
  }
  return [...out.values()];
}

/** Profile links a brand publishes about itself: Google listing, Yelp, socials. */
export function extractProfileLinks(html, pageUrl) {
  const hrefs = new Set();
  const re = /href=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) hrefs.add(m[1]);
  // Structured data a brand publishes about itself: the map it points to, and
  // the profiles it says are its own.
  for (const m of html.matchAll(/"sameAs"\s*:\s*\[([^\]]*)\]/g)) {
    for (const u of m[1].matchAll(/"(https?:[^"]+)"/g)) hrefs.add(u[1]);
  }
  for (const m of html.matchAll(/"(?:hasMap|map)"\s*:\s*"(https?:[^"]+)"/g)) hrefs.add(m[1].replace(/\\\//g, '/'));

  const classify = (href) => {
    const u = href.toLowerCase();
    if (/(^|\/\/)(www\.)?google\.[a-z.]+\/maps|maps\.google\.|goo\.gl\/maps|maps\.app\.goo\.gl|\bcid=\d{6,}/.test(u)) return 'google_listing';
    if (u.includes('yelp.com/biz')) return 'yelp';
    if (u.includes('facebook.com/')) return 'facebook';
    if (u.includes('instagram.com/')) return 'instagram';
    if (u.includes('linkedin.com/')) return 'linkedin';
    if (u.includes('bbb.org/')) return 'bbb';
    if (u.includes('search.google.com/local/writereview') || u.includes('g.page')) return 'google_review_link';
    return null;
  };

  const grouped = {};
  for (const href of hrefs) {
    const abs = (() => { try { return new URL(href, pageUrl).toString(); } catch { return null; } })();
    if (!abs) continue;
    const kind = classify(abs);
    if (!kind) continue;
    (grouped[kind] ??= []);
    if (!grouped[kind].some((x) => x.value === abs) && grouped[kind].length < 6) {
      const idx = html.indexOf(href);
      grouped[kind].push(
        idx >= 0
          ? finding({ value: abs, url: pageUrl, source: html, index: idx, length: href.length, method: 'link published on the brand site' })
          : finding({ value: abs, url: pageUrl, method: 'link published on the brand site' }),
      );
    }
  }
  return grouped;
}

/** Internal links worth crawling for NAP: contact, about, locations. */
export function discoverKeyPages(html, pageUrl, limit = 3) {
  const origin = new URL(pageUrl).origin;
  const wanted = [/contact/i, /locations?/i, /about/i, /service-area/i, /our-(?:team|company)/i];
  const found = [];
  const re = /<a[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null && found.length < limit * 4) {
    let abs;
    try { abs = new URL(m[1], pageUrl); } catch { continue; }
    if (abs.origin !== origin) continue;
    if (/\.(pdf|jpe?g|png|gif|svg|webp|zip|mp4)$/i.test(abs.pathname)) continue;
    if (abs.toString().replace(/\/$/, '') === pageUrl.replace(/\/$/, '')) continue;
    const hay = `${abs.pathname} ${collapse(m[2].replace(/<[^>]+>/g, ' '))}`;
    const rank = wanted.findIndex((w) => w.test(hay));
    if (rank === -1) continue;
    const url = abs.toString();
    if (!found.some((f) => f.url === url)) found.push({ url, rank });
  }
  found.sort((a, b) => a.rank - b.rank);
  return found.slice(0, limit).map((f) => f.url);
}
