// Turns raw observations into the row the reader sees, in the five states the
// scanner uses. Nothing here concludes anything about a business: each line is
// an observation, the limit of that observation, and the check that would
// settle it.

const byCategory = (scan, category) => Object.values(scan.tags ?? {}).filter((t) => t.category === category);
const ids = (scan, id) => scan.tags?.[id]?.ids ?? [];
const proof = (scan, id) => scan.tags?.[id]?.findings ?? [];

export function summariseBrand(scan) {
  if (scan.state !== 'observed') {
    return { slug: scan.slug, name: scan.name, market: scan.market, url: scan.url, state: scan.state, error: scan.error ?? null };
  }

  const ga4 = ids(scan, 'ga4');
  const ua = ids(scan, 'universal_analytics');
  const gtm = ids(scan, 'gtm');
  const ads = [...ids(scan, 'google_ads'), ...ids(scan, 'google_ads_conversion')];
  const callHandling = byCategory(scan, 'call_handling');
  const forms = byCategory(scan, 'form');
  const leadDestinations = byCategory(scan, 'lead_destination');
  const chat = byCategory(scan, 'chat');

  const phones = (scan.nap?.phones ?? []).map((p) => p.value);
  const addresses = (scan.nap?.addresses ?? []).map((a) => a.value);

  const measurement = measurementObserved({ ga4, ua, gtm, ads });
  const entryPoints = leadEntryPoints({ forms, phones, chat });

  const row = {
    slug: scan.slug,
    name: scan.name,
    market: scan.market,
    url: scan.url,
    site: scan.pages?.[0]?.url ?? scan.url,
    state: 'observed',
    scanned_at: scan.scanned_at,
    pages_scanned: scan.pages_scanned,
    read_as: scan.pages?.[0]?.source ?? 'html as served',

    establishments: {
      state: addresses.length ? 'observed' : 'not_observed_in_scope',
      postal_addresses: addresses,
      sites: [scan.pages?.[0]?.url ?? scan.url],
      note: addresses.length
        ? 'Postal addresses printed on the pages read. How many establishments the brand operates is not decidable from these pages.'
        : 'No postal address was printed on the pages read.',
    },

    lead_entry_points: entryPoints,

    measurement,

    call_handling: {
      state: callHandling.length ? 'observed' : 'not_observed_in_scope',
      tools: callHandling.map((t) => t.label),
      note: callHandling.length
        ? 'A call handling script is present in the pages read.'
        : 'No call handling script was recognised in the pages and conditions tested. Whether calls are recorded, and against which source, is settled inside the phone system, not from the page.',
      next: callHandling.length ? 'Confirm which numbers it swaps, and where the call record lands.' : 'Ask which system receives the calls and what it records.',
      access: 'private_access_required',
    },

    lead_destination: {
      state: leadDestinations.length ? 'observed' : 'unverified',
      tools: leadDestinations.map((t) => t.label),
      note: leadDestinations.length
        ? 'A recognised lead destination appears in the pages read.'
        : 'Where a submitted form lands is not visible from a page: the destination is set on the server or inside the form plugin.',
      next: 'Confirm the destination of each form, and the field that would carry the source.',
      access: 'private_access_required',
    },

    google_listing: listingRow(scan),

    local_services_ads: {
      state: 'private_access_required',
      note: 'Whether a brand runs Local Services Ads, and what those leads cost, is readable in the advertising account. A public page does not carry it.',
      next: 'Read-only access to the advertising account for one brand.',
    },

    link_to_verify: linkToVerify({ measurement, callHandling, leadDestinations, phones }),

    next_check: nextCheck({ measurement, scan }),

    evidence: {
      ga4: proof(scan, 'ga4'),
      universal_analytics: proof(scan, 'universal_analytics'),
      gtm: proof(scan, 'gtm'),
      google_ads: [...proof(scan, 'google_ads'), ...proof(scan, 'google_ads_conversion')],
      call_handling: callHandling.flatMap((t) => t.findings),
      forms: forms.flatMap((t) => t.findings),
      lead_destination: leadDestinations.flatMap((t) => t.findings),
      chat: chat.flatMap((t) => t.findings),
      phones: scan.nap?.phones ?? [],
      addresses: scan.nap?.addresses ?? [],
    },
  };

  return row;
}

function measurementObserved({ ga4, ua, gtm, ads }) {
  const observed = [];
  if (ga4.length) observed.push({ kind: 'Google Analytics 4', ids: ga4 });
  if (ua.length) observed.push({ kind: 'Universal Analytics', ids: ua, historical: true });
  if (gtm.length) observed.push({ kind: 'Tag Manager', ids: gtm });
  if (ads.length) observed.push({ kind: 'Google Ads', ids: ads });

  if (!observed.length) {
    return {
      state: 'not_observed_in_scope',
      observed,
      summary: 'No recognised measurement ID',
      note: 'No recognised measurement identifier appeared in the pages and conditions tested. A consent banner can hold tags back before any interaction, so this is a bounded observation, not a statement about the brand.',
    };
  }

  const labels = observed.map((o) => (o.ids.length > 1 ? `${o.kind} x${o.ids.length}` : o.kind));
  return {
    state: 'observed',
    observed,
    summary: labels.join(', '),
    note: 'These identifiers are present in the pages as served. Whether each one fires, and which property it reports to, is settled in the accounts.',
  };
}

function leadEntryPoints({ forms, phones, chat }) {
  const present = [
    forms.length ? 'form' : null,
    phones.length ? 'phone' : null,
    chat.length ? 'chat' : null,
  ].filter(Boolean);
  return {
    state: present.length ? 'observed' : 'not_observed_in_scope',
    kinds: present,
    forms: forms.map((f) => f.label),
    chat: chat.map((c) => c.label),
    phone_numbers: phones,
    summary: present.length ? present.join(', ') : 'none observed in scope',
    note: present.length
      ? 'The ways a lead can start on the pages read. Each one has to be followed to the system that receives it.'
      : 'No form, published number or chat widget was recognised in the pages read.',
  };
}

function listingRow(scan) {
  const lookup = scan.google_listing_lookup;
  const published = (scan.profile_links?.google_listing ?? []).map((f) => f.value);
  if (!lookup) {
    return {
      state: published.length ? 'unverified' : 'unverified',
      published_links: published,
      listings: [],
      note: published.length
        ? 'The site publishes a link to a listing; it was not opened in this run.'
        : 'This site publishes no link to a listing. Which listings belong to this brand, and to which establishment, is not decidable from public pages.',
      next: 'Confirm the listings each establishment owns, from the business profile account.',
    };
  }
  return {
    state: lookup.state,
    published_links: published,
    listings: lookup.listings ?? [],
    note: lookup.note,
    next: 'Confirm the full set of listings per establishment, from the business profile account.',
  };
}

function linkToVerify({ measurement, callHandling, leadDestinations }) {
  const items = [];
  for (const o of measurement.observed ?? []) {
    if (o.kind === 'Universal Analytics') {
      items.push({
        id: 'ua_active',
        short: 'Historical UA identifier: is anything still collecting?',
        text: `Historical Universal Analytics identifier observed (${o.ids.join(', ')}). Whether anything still collects behind it is to verify.`,
      });
    }
    if (o.kind === 'Google Analytics 4' && o.ids.length > 1) {
      items.push({
        id: 'ga4_destinations',
        short: 'Two GA4 IDs: confirm each destination before changing either',
        text: `Two Google Analytics 4 measurement IDs observed (${o.ids.join(' and ')}). Two streams can be deliberate. Confirm the destination of each before changing either.`,
      });
    }
    if (o.kind === 'Tag Manager') {
      items.push({ id: 'gtm_fires', short: 'Container observed: which tags does it fire?', text: `Tag Manager container observed (${o.ids.join(', ')}). Which tags it fires is to verify in the container.` });
    }
    if (o.kind === 'Google Ads') {
      items.push({ id: 'ads_id', short: 'Ads ID on the page, which is not an observed ad', text: 'Google Ads measurement ID observed. That is a tag on the page, not an observation of a live ad.' });
    }
  }
  if (measurement.state === 'not_observed_in_scope') {
    items.push({ id: 'no_tag_in_scope', short: 'Nothing recognised in scope: consent gate, or none deployed?', text: 'No recognised measurement ID in the pages and conditions tested. Confirm whether a consent gate holds tags back, or whether none is deployed.' });
  }
  if (!callHandling.length) items.push({ id: 'call_path', short: 'Where do calls land, and what is recorded?', text: 'No call handling script recognised. Confirm where calls land and what the phone system records.' });
  if (!leadDestinations.length) items.push({ id: 'form_path', short: 'Where does a submitted form go?', text: 'Form destination not visible from the page. Confirm where a submitted form goes.' });

  // Most consequential first, so the cell on the board carries the question
  // worth asking before the others.
  const order = ['no_tag_in_scope', 'ua_active', 'ga4_destinations', 'gtm_fires', 'form_path', 'call_path', 'ads_id'];
  return items.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

function nextCheck({ measurement, scan }) {
  if (measurement.state === 'not_observed_in_scope') {
    return { short: 'Re-read with consent given', text: 'Re-read with a consent choice made, then ask what is deployed.', access: 'public re-run, then a question' };
  }
  if (scan.pages?.[0]?.source?.startsWith('DOM')) {
    return { short: 'Re-read rendered, then the accounts', text: 'Re-read the rendered pages, then confirm the destinations in the accounts.', access: 'public re-run, then read-only access' };
  }
  return { short: 'Confirm destinations in the accounts', text: 'Confirm destinations in the accounts that own these identifiers.', access: 'read-only access' };
}

/**
 * The three operating questions this mapping is meant to serve. They are the
 * order of investigation, not a verdict: nothing here claims to know how the
 * business runs.
 */
export const OPERATING_QUESTIONS = [
  {
    id: 'system_of_record',
    question: 'Which system records that a move is booked, with what identifier and what amount?',
    why: 'A quote, a booking, a cancellation and a payment are four different states. Until one system and one status are authoritative for each, a revenue figure has no single meaning.',
    supported_by: 'The mapping shows where leads can start. It does not show which system closes them, and it cannot.',
  },
  {
    id: 'the_key',
    question: 'Which key ties a lead to that booking?',
    why: 'Acquisition source, entry brand and performing brand are three separate dimensions and have to stay separate. A number several brands publish is not a key, and joining on it would invent links.',
    supported_by: 'The mapping lists the numbers and entry points each site publishes, which is what makes a shared number visible as a hazard rather than a shortcut.',
  },
  {
    id: 'spend_and_totals',
    question: 'How is spend attached to this scope, and how are the totals checked?',
    why: 'Spend sits in advertising accounts, bookings in the operating system. Attaching them is only meaningful once both sides reconcile to a total that can be recomputed.',
    supported_by: 'A measurement ID on a page says a tag exists. What it spent and what it produced is in the account.',
  },
];

export function groupSummary(rows) {
  const ok = rows.filter((r) => r.state === 'observed');
  const count = (fn) => ok.filter(fn).length;
  return {
    brands_in_scope: rows.length,
    sites_read: ok.length,
    pages_read: ok.reduce((t, r) => t + (r.pages_scanned ?? 0), 0),
    with_a_measurement_id_observed: count((r) => r.measurement.state === 'observed'),
    without_one_in_tested_scope: count((r) => r.measurement.state === 'not_observed_in_scope'),
    with_a_historical_ua_identifier: count((r) => (r.measurement.observed ?? []).some((o) => o.kind === 'Universal Analytics')),
    with_call_handling_observed: count((r) => r.call_handling.state === 'observed'),
    with_a_lead_destination_observed: count((r) => r.lead_destination.state === 'observed'),
    listings_opened_from_a_published_link: ok.reduce((t, r) => t + (r.google_listing.listings?.length ?? 0), 0),
    distinct_phone_numbers: new Set(ok.flatMap((r) => r.lead_entry_points.phone_numbers)).size,
    connections_not_tested: ok.length * 3,
  };
}
