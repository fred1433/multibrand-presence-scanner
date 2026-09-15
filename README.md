# multibrand-presence-scanner

[![scan](https://github.com/fred1433/multibrand-presence-scanner/actions/workflows/scan.yml/badge.svg)](https://github.com/fred1433/multibrand-presence-scanner/actions/workflows/scan.yml)

Two small tools for a group that trades under several brands.

**A reader.** It fetches a short, representative set of public pages for each
brand in a list and writes down what it observed: the measurement identifiers
present, the ways a lead can start, the numbers and addresses published, and the
Google listing a site links to. Every value carries the URL and the literal text
behind it.

**A reconciliation.** It runs a lead-to-booking chain over invented records and
answers for itself: a booking entered by one brand and performed by another
counts once, a reminder call opens no lead, a second import moves no total, and
a booking with no key back to a lead stays unattributed and stays visible.

```bash
npm ci
npm run demo        # serves the fixture sites, reads them, then reconciles
npm test            # unit tests, no network
npm run scan -- --brands my-brands.json --out data
npm run reconcile
```

## What it will not say

The reader states an observation, its limit, and the check that would settle it.
It has no opinion about anybody's business, and five states carry that:

| state | meaning |
| --- | --- |
| `observed` | the string is in the page as served |
| `not_observed_in_scope` | it is not in the pages and conditions tested |
| `unverified` | it cannot be decided from public pages |
| `private_access_required` | it is only decidable inside an account |
| `collection_error` | the collection itself did not complete |

An unknown is never written as a zero and never as a failure of the site. A page
with no recognised tag is reported as *no recognised measurement ID in the pages
and conditions tested*, because a consent banner can hold tags back before any
interaction. A `UA-` string is a *historical identifier observed*, and whether
anything still collects behind it is left to verify. Two `G-` identifiers are two
streams to confirm, not a duplicate to remove. An `AW-` identifier is a tag on a
page, not an observed advertisement. There is no score anywhere, because a score
would turn what was not observable into a mark against a site.

It is also deliberately narrow. It does not crawl, it does not search for
listings, it does not watch anybody's advertising, and it does not rank pages. A
brand, an establishment and a listing are three different things, so the only
listing it will open is one the site links to itself.

No model is called, here, in the tests or in continuous integration.

## Reading another group

```json
{
  "group": "Your group",
  "scope_note": "The set of sites that could be identified, not a claim to be every one.",
  "brands": [
    { "slug": "one", "name": "Brand One", "market": "City, ST", "url": "https://one.example/" }
  ]
}
```

```bash
node src/cli.js --brands my-brands.json --out data --with-listings
```

`--with-listings` opens, in a clean headless Chromium, each Google listing a site
links to. Without it nothing external is touched.

## The reconciliation

`fixtures/records/` holds invented leads, calls, bookings and payments, plus a
second copy of the bookings to import twice. `npm run reconcile` writes
`data/pipeline.json`: the rules, the run, the same run replayed, and the
acceptance checks it answered. Money is handled in cents so a replay cannot
drift by a rounding step, and a record that comes back changed is reported as a
conflict rather than silently kept or overwritten.

## Continuous integration

`.github/workflows/scan.yml` runs the unit tests, serves the fixture sites and
reads them, runs the reconciliation, checks that every state written is one of
the five declared and that the run answered all of its own checks, then publishes
the JSON as a build artifact. It runs on every push and once a week.

## Licence

MIT.
