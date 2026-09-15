import test from 'node:test';
import assert from 'node:assert/strict';
import { detectTags, mergeTagResults } from '../src/detect/tags.js';
import { extractPhones, extractAddresses, extractProfileLinks, discoverKeyPages, isPlaceholderPhone, visibleText } from '../src/detect/page.js';
import { snippetAt, maskEmails } from '../src/evidence.js';

const PAGE = `<!doctype html><html lang="en"><head>
<title>Example Movers</title>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABCDE12345"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}
gtag('config','G-ABCDE12345');gtag('config','AW-123456789');
gtag('event','conversion',{'send_to':'AW-123456789/AbCdEfGhIj'});</script>
<script>(function(i,s,o,g,r,a,m){})(window,document,'script','https://www.google-analytics.com/analytics.js','ga');
ga('create','UA-12345678-1','auto');</script>
<script>(function(w,d,s,l,i){})(window,document,'script','dataLayer','GTM-ABC1234');</script>
<script src="//cdn.callrail.com/companies/987654321/abcdef0123456789/12/swap.js"></script>
<script src="https://js.hs-scripts.com/1234567.js"></script>
</head><body>
<a href="tel:1-617-481-2200">Call us</a>
<a href="/contact-us/">Contact</a><a href="/about/">About</a><a href="https://other.test/x">Away</a>
<input placeholder="(999) 999-9999">
<div class="gform_wrapper"><form><input name="a"></form></div>
<p>Visit us at 12 Harbor Road, Boston, MA 02110.</p>
<script type="application/ld+json">{"@type":"MovingCompany","sameAs":["https://www.google.com/maps?cid=1234567890123456789","https://www.yelp.com/biz/example-movers"]}</script>
</body></html>`;

const URL_ = 'https://example-movers.test/';

test('the measurement identifiers on a page are found with their literal proof', () => {
  const tags = detectTags(PAGE, URL_);
  assert.deepEqual(tags.ga4.ids, ['G-ABCDE12345']);
  assert.deepEqual(tags.universal_analytics.ids, ['UA-12345678-1']);
  assert.equal(tags.universal_analytics.historical, true);
  assert.deepEqual(tags.gtm.ids, ['GTM-ABC1234']);
  assert.deepEqual(tags.google_ads.ids, ['AW-123456789']);
  assert.equal(tags.google_ads_conversion.ids[0], 'AW-123456789/AbCdEfGhIj');
  for (const f of tags.ga4.findings) {
    assert.equal(f.evidence_url, URL_);
    assert.ok(f.snippet.includes('G-ABCDE12345'), 'the excerpt must contain the id it proves');
  }
});

test('call handling, forms and a lead destination are read as separate things', () => {
  const tags = detectTags(PAGE, URL_);
  assert.equal(tags.callrail.category, 'call_handling');
  assert.deepEqual(tags.callrail.ids, ['987654321']);
  assert.equal(tags.gravity_forms.category, 'form');
  assert.equal(tags.hubspot.category, 'lead_destination');
  assert.deepEqual(tags.hubspot.ids, ['1234567']);
});

test('the scanner is not a pixel inventory', () => {
  const html = `<script>fbq('init','1234567890123456');</script><script src="https://bat.bing.com/bat.js"></script><script src="https://static.hotjar.com/c/hotjar-123.js"></script>`;
  assert.deepEqual(Object.keys(detectTags(html, URL_)), [], 'only what bears on the lead to booking chain is collected');
});

test('a bare G- string without tagging context is not a measurement ID', () => {
  assert.equal(detectTags('<p>Order G-ABCDE12345 shipped</p>', URL_).ga4, undefined);
});

test('a page that carries nothing reports nothing rather than something', () => {
  assert.equal(Object.keys(detectTags('<html><body><p>Hello</p></body></html>', URL_)).length, 0);
});

test('merging keeps one entry per id and remembers every page it was seen on', () => {
  const merged = mergeTagResults([
    { url: 'https://a.test/', tags: detectTags(PAGE, 'https://a.test/') },
    { url: 'https://a.test/contact/', tags: detectTags(PAGE, 'https://a.test/contact/') },
  ]);
  assert.deepEqual(merged.ga4.ids, ['G-ABCDE12345']);
  assert.equal(merged.ga4.pages.length, 2);
});

test('phones come from tel: links and visible text, never from attributes', () => {
  const phones = extractPhones(PAGE, URL_);
  const values = phones.map((p) => p.value);
  assert.ok(values.includes('(617) 481-2200'));
  assert.equal(phones[0].method, 'tel: link');
  assert.ok(!values.includes('(999) 999-9999'), 'a form placeholder is not a phone number');
});

test('a ten digit run inside a query string is not a phone number', () => {
  assert.deepEqual(extractPhones('<a href="https://www.facebook.com/X/?sw_fnr_id=2475156882">fb</a>', URL_), []);
});

test('reserved and placeholder numbers are recognised', () => {
  assert.equal(isPlaceholderPhone('(999) 999-9999'), true);
  assert.equal(isPlaceholderPhone('(617) 555-0199'), true);
  assert.equal(isPlaceholderPhone('(617) 515-9886'), false);
});

test('addresses keep the literal text and the parsed parts', () => {
  const [addr] = extractAddresses(PAGE, URL_);
  assert.match(addr.value, /12 Harbor Road, Boston, MA 02110/);
  assert.equal(addr.parts.region, 'MA');
  assert.equal(addr.parts.postal_code, '02110');
});

test('a listing link the brand publishes is picked up, from a link or from sameAs', () => {
  const links = extractProfileLinks(PAGE, URL_);
  assert.equal(links.google_listing[0].value, 'https://www.google.com/maps?cid=1234567890123456789');
  assert.equal(links.google_listing[0].method, 'link published on the brand site');
  assert.ok(links.yelp);
});

test('only same origin contact and about pages are queued', () => {
  assert.deepEqual(discoverKeyPages(PAGE, URL_, 3), ['https://example-movers.test/contact-us/', 'https://example-movers.test/about/']);
});

test('text hidden in an HTML comment is not treated as visible', () => {
  assert.equal(visibleText('<p>a</p><!-- hidden --><p>b</p>'), 'a b');
});

test('an excerpt always contains the match it was cut around', () => {
  const src = 'x'.repeat(500) + 'NEEDLE' + 'y'.repeat(500);
  assert.ok(snippetAt(src, 500, 6).includes('NEEDLE'));
});

test('an email address inside an excerpt is masked before it is stored', () => {
  assert.equal(maskEmails('write to sales@example.com now'), 'write to [address removed] now');
  const src = 'x'.repeat(60) + 'contact someone@example.com here' + 'y'.repeat(60);
  assert.ok(!snippetAt(src, 60, 7).includes('@'));
});

test('a map link a brand publishes inside its structured data is picked up', () => {
  const html = '<script type="application/ld+json">{"@type":"LocalBusiness","hasMap":"https://www.google.com/maps/place/X/@1,2,15z/data=!4m5"}</script>';
  const links = extractProfileLinks(html, 'https://x.test/');
  assert.equal(links.google_listing.length, 1);
  assert.match(links.google_listing[0].value, /maps\/place\/X/);
});
