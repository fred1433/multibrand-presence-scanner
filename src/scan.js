// Per-brand inspection of a small, representative set of public pages.
//
// The result is a set of observations, each one bounded by what a fetch of a
// public page can actually show, and each one carrying the URL and the literal
// text that produced it. Five states are used throughout, and an unknown is
// never recorded as a zero:
//
//   observed                  the string is in the page as served
//   not_observed_in_scope     it is not in the pages and conditions tested
//   unverified                it cannot be decided from the public pages
//   private_access_required   it is only decidable inside an account
//   collection_error          the collection itself did not complete

import { fetchPage, mapLimit } from './http.js';
import { detectTags, mergeTagResults } from './detect/tags.js';
import { extractPhones, extractAddresses, extractProfileLinks, discoverKeyPages, visibleText } from './detect/page.js';

export const SCANNER_VERSION = '2.0.0';

export const STATES = ['observed', 'not_observed_in_scope', 'unverified', 'private_access_required', 'collection_error'];

async function loadPage(url, { render, renderer }) {
  const raw = await fetchPage(url);
  const page = {
    requested_url: url,
    url: raw.finalUrl,
    status: raw.status,
    redirect_chain: raw.chain,
    bytes: raw.bytes,
    source: 'html as served',
    visible_text_chars: visibleText(raw.html).length,
    fetched_at: raw.fetchedAt,
  };
  let html = raw.html;
  const thin = page.visible_text_chars < 800;
  if (thin && render && renderer) {
    try {
      const rendered = await renderer(raw.finalUrl);
      if (rendered?.html && visibleText(rendered.html).length > page.visible_text_chars) {
        html = rendered.html;
        page.source = 'DOM after the page ran its JavaScript';
        page.rendered_visible_text_chars = visibleText(rendered.html).length;
      }
    } catch (err) {
      page.render_error = String(err.message || err);
    }
  } else if (thin) {
    page.note = 'The served HTML carries almost no text, so this page builds itself in the browser. It was read without one in this run.';
  }
  return { page, html };
}

export async function scanBrand(brand, opts = {}) {
  const { extraPages = 2, render = true, renderer = null } = opts;
  const startedAt = new Date().toISOString();

  let home;
  try {
    home = await loadPage(brand.url, { render, renderer });
  } catch (err) {
    return {
      slug: brand.slug, name: brand.name, market: brand.market, url: brand.url,
      scanned_at: startedAt, scanner_version: SCANNER_VERSION,
      state: 'collection_error', error: String(err.message || err),
    };
  }

  const keyPageUrls = discoverKeyPages(home.html, home.page.url, extraPages);
  const others = await mapLimit(keyPageUrls, 2, async (u) => {
    try { return await loadPage(u, { render, renderer }); } catch (err) { return { page: { url: u, state: 'collection_error', error: String(err.message || err) }, html: '' }; }
  });
  const loaded = [home, ...others].filter((p) => p.html);

  const tags = mergeTagResults(loaded.map(({ page, html }) => ({ url: page.url, tags: detectTags(html, page.url) })));
  const phones = dedupe(loaded.flatMap(({ page, html }) => extractPhones(html, page.url)));
  const addresses = dedupe(loaded.flatMap(({ page, html }) => extractAddresses(html, page.url)));

  const profileLinks = {};
  for (const { page, html } of loaded) {
    for (const [kind, list] of Object.entries(extractProfileLinks(html, page.url))) {
      profileLinks[kind] = dedupe([...(profileLinks[kind] ?? []), ...list]).slice(0, 6);
    }
  }

  return {
    slug: brand.slug,
    name: brand.name,
    market: brand.market,
    url: brand.url,
    scanned_at: startedAt,
    scanner_version: SCANNER_VERSION,
    state: 'observed',
    pages: loaded.map((p) => p.page),
    pages_scanned: loaded.length,
    tags,
    nap: { phones, addresses },
    profile_links: profileLinks,
  };
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((f) => (seen.has(f.value) ? false : (seen.add(f.value), true)));
}
