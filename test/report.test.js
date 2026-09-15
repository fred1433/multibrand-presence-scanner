import test from 'node:test';
import assert from 'node:assert/strict';
import { summariseBrand, groupSummary, OPERATING_QUESTIONS } from '../src/report.js';
import { STATES } from '../src/scan.js';
import { cidFromPlaceUrl } from '../src/listings.js';

const finding = (v, u = 'https://a.test/') => ({ value: v, evidence_url: u, snippet: `...${v}...` });
const tag = (id, label, category, ids, extra = {}) => ({
  [id]: { id, label, category, ids, findings: ids.map((v) => finding(v)), ...extra },
});

function scan(slug, over = {}) {
  return {
    slug, name: over.name ?? slug, market: 'MA', url: `https://${slug}.test/`, state: 'observed',
    scanned_at: '2026-09-15T12:00:00.000Z', pages_scanned: 2,
    pages: [{ url: `https://${slug}.test/`, source: over.source ?? 'html as served' }],
    tags: over.tags ?? {},
    nap: { phones: (over.phones ?? []).map((p) => finding(p)), addresses: (over.addresses ?? []).map((a) => finding(a)) },
    profile_links: over.profile_links ?? {},
    ...(over.listing ? { google_listing_lookup: over.listing } : {}),
  };
}

test('every state the scanner writes is one of the five it declares', () => {
  const rows = [
    summariseBrand(scan('a', { tags: tag('ga4', 'GA4', 'measurement', ['G-AAAAAAAAAA']) })),
    summariseBrand(scan('b')),
  ];
  for (const r of rows) {
    for (const field of ['establishments', 'lead_entry_points', 'measurement', 'call_handling', 'lead_destination', 'google_listing', 'local_services_ads']) {
      assert.ok(STATES.includes(r[field].state), `${field} used ${r[field].state}`);
    }
  }
});

test('nothing recognised is reported as a bounded observation, never as an absence in the business', () => {
  const r = summariseBrand(scan('b'));
  assert.equal(r.measurement.state, 'not_observed_in_scope');
  assert.match(r.measurement.note, /pages and conditions tested/);
  assert.match(r.measurement.note, /consent/);
  assert.ok(!/dead|broken|abandoned|missing/i.test(JSON.stringify(r)), 'no verdict words anywhere in the row');
});

test('a historical Universal Analytics identifier is observed, and its collection is left to verify', () => {
  const r = summariseBrand(scan('c', { tags: tag('universal_analytics', 'Universal Analytics identifier', 'measurement', ['UA-1234567-1'], { historical: true }) }));
  assert.equal(r.measurement.state, 'observed');
  const item = r.link_to_verify.find((i) => i.id === 'ua_active');
  assert.match(item.text, /Historical Universal Analytics identifier observed/);
  assert.match(item.text, /to verify/);
  assert.ok(!/stopped|dead|2023/.test(item.text), 'the row states what was seen, not what it concludes');
});

test('two GA4 identifiers are reported as two streams to confirm, not as a duplicate', () => {
  const r = summariseBrand(scan('d', { tags: tag('ga4', 'GA4', 'measurement', ['G-AAAAAAAAAA', 'G-BBBBBBBBBB']) }));
  const item = r.link_to_verify.find((i) => i.id === 'ga4_destinations');
  assert.match(item.text, /Two streams can be deliberate/);
  assert.match(item.text, /before changing either/);
});

test('an Ads measurement ID is never read as an observed advertisement', () => {
  const r = summariseBrand(scan('e', { tags: tag('google_ads', 'Google Ads measurement ID', 'measurement', ['AW-123456789']) }));
  const item = r.link_to_verify.find((i) => i.id === 'ads_id');
  assert.match(item.text, /not an observation of a live ad/);
});

test('lead entry points are read as form, phone and chat', () => {
  const r = summariseBrand(scan('f', {
    tags: { ...tag('gravity_forms', 'Gravity Forms', 'form', ['Gravity Forms']), ...tag('podium', 'Podium', 'chat', ['Podium']) },
    phones: ['(555) 010-0001'],
  }));
  assert.deepEqual(r.lead_entry_points.kinds, ['form', 'phone', 'chat']);
  assert.deepEqual(r.lead_entry_points.phone_numbers, ['(555) 010-0001']);
});

test('what only an account can answer is marked as needing access, never as a gap', () => {
  const r = summariseBrand(scan('g'));
  assert.equal(r.local_services_ads.state, 'private_access_required');
  assert.equal(r.call_handling.access, 'private_access_required');
  assert.equal(r.lead_destination.access, 'private_access_required');
  assert.match(r.local_services_ads.note, /advertising account/);
});

test('a site that publishes no listing link leaves the listing unverified', () => {
  const r = summariseBrand(scan('h'));
  assert.equal(r.google_listing.state, 'unverified');
  assert.match(r.google_listing.note, /not decidable from public pages/);
  assert.deepEqual(r.google_listing.listings, []);
});

test('a listing opened from a published link is reported with what it says', () => {
  const r = summariseBrand(scan('i', {
    profile_links: { google_listing: [finding('https://www.google.com/maps?cid=1')] },
    listing: { state: 'observed', note: 'Opened from the link the brand publishes.', listings: [{ name: 'A Listing', rating: 4.2, reviews: 94, marked_permanently_closed: true }] },
  }));
  assert.equal(r.google_listing.state, 'observed');
  assert.equal(r.google_listing.listings[0].marked_permanently_closed, true);
});

test('a site that could not be read is reported as a collection error, not as a finding', () => {
  const r = summariseBrand({ slug: 'x', name: 'X', market: 'MA', url: 'https://x.test/', state: 'collection_error', error: 'timeout' });
  assert.equal(r.state, 'collection_error');
  assert.equal(r.error, 'timeout');
});

test('the counts never turn an unknown into a zero', () => {
  const rows = [
    summariseBrand(scan('a', { tags: tag('ga4', 'GA4', 'measurement', ['G-AAAAAAAAAA']) })),
    summariseBrand(scan('b')),
  ];
  const c = groupSummary(rows);
  assert.equal(c.brands_in_scope, 2);
  assert.equal(c.with_a_measurement_id_observed, 1);
  assert.equal(c.without_one_in_tested_scope, 1);
  assert.equal(c.with_call_handling_observed, 0);
  assert.ok(!Object.keys(c).some((k) => /score|readiness|grade/.test(k)), 'no score is computed anywhere');
});

test('the three operating questions are carried, and none of them is a tag question', () => {
  assert.equal(OPERATING_QUESTIONS.length, 3);
  assert.deepEqual(OPERATING_QUESTIONS.map((q) => q.id), ['system_of_record', 'the_key', 'spend_and_totals']);
  for (const q of OPERATING_QUESTIONS) assert.ok(q.question && q.why && q.supported_by);
  assert.match(OPERATING_QUESTIONS[1].why, /not a key/);
});

test('the listing id is read from a place url', () => {
  assert.equal(cidFromPlaceUrl('https://www.google.com/maps?cid=18150304823054463907').decimal, '18150304823054463907');
  assert.equal(cidFromPlaceUrl('https://example.test/'), null);
});

test('every line to verify carries a short form and a full one, and they agree', () => {
  const r = summariseBrand(scan('j', { tags: tag('universal_analytics', 'UA', 'measurement', ['UA-1-1'], { historical: true }) }));
  for (const item of r.link_to_verify) {
    assert.ok(item.short && item.short.length <= 62, `${item.id} has no usable short form`);
    assert.ok(item.text.length > item.short.length);
  }
  assert.ok(r.next_check.short.length <= 40);
});

test('the line to verify that leads is the most consequential one, not the first found', () => {
  const r = summariseBrand(scan('k', { tags: tag('google_ads', 'Google Ads', 'measurement', ['AW-123456789']) }));
  assert.notEqual(r.link_to_verify[0].id, 'ads_id', 'an Ads ID note must not lead the row');
  assert.equal(r.link_to_verify[r.link_to_verify.length - 1].id, 'ads_id');
});
