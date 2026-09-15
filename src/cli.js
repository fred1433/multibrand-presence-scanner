#!/usr/bin/env node
// multibrand-presence-scanner
//
// Reads a small, representative set of public pages for every brand in a list
// and writes what it observed, in five states, with the URL and the literal
// text behind each line. It concludes nothing: an observation, its limit, and
// the check that would settle it.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapLimit } from './http.js';
import { scanBrand, SCANNER_VERSION, STATES } from './scan.js';
import { summariseBrand, groupSummary, OPERATING_QUESTIONS } from './report.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = { brands: join(ROOT, 'example-brands.json'), out: join(ROOT, 'data'), concurrency: 3, render: true, listings: false, only: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--brands') args.brands = resolve(next());
    else if (a === '--out') args.out = resolve(next());
    else if (a === '--concurrency') args.concurrency = Number(next());
    else if (a === '--no-render') args.render = false;
    else if (a === '--with-listings') args.listings = true;
    else if (a === '--only') args.only = next().split(',');
    else if (a === '--reuse') args.reuse = true;
    else if (a === '--refresh') { args.reuse = true; args.refresh = next().split(','); }
    else if (a === '--help' || a === '-h') { usage(); process.exit(0); }
  }
  return args;
}

function usage() {
  console.log(`multibrand-presence-scanner v${SCANNER_VERSION}

  node src/cli.js [options]

  --brands <file>     brand list to read           (default example-brands.json)
  --out <dir>         where the JSON is written    (default data/)
  --only a,b          read these slugs only
  --reuse             reuse the JSON already in --out and refresh the extras
  --refresh a,b       reuse every brand, refresh the extras of these slugs only
  --concurrency <n>   parallel brands              (default 3)
  --no-render         never open headless Chromium for pages built in the browser
  --with-listings     open the Google listing each site links to, in headless Chromium

States used throughout: ${STATES.join(', ')}.
An unknown is never written as a zero and never as a failure of the site.`);
}

const loadOptional = async (path) => { try { return await import(path); } catch { return null; } };

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const list = JSON.parse(await readFile(args.brands, 'utf8'));
  let brands = list.brands ?? list;
  if (args.only) brands = brands.filter((b) => args.only.includes(b.slug));
  if (!brands.length) { console.error('no brands to read'); process.exit(1); }

  const renderMod = args.render ? await loadOptional('./render.js') : null;
  const renderer = renderMod ? await renderMod.makeRenderer() : null;

  let scans;
  if (args.reuse) {
    console.log(`reusing the brand JSON already in ${args.out}`);
    scans = [];
    for (const brand of brands) scans.push(JSON.parse(await readFile(join(args.out, 'brands', `${brand.slug}.json`), 'utf8')));
  } else {
    console.log(`reading ${brands.length} brand site(s) from ${args.brands}`);
    scans = await mapLimit(brands, args.concurrency, async (brand) => {
      const t0 = Date.now();
      const scan = await scanBrand(brand, { render: args.render, renderer });
      console.log(`  ${scan.state === 'observed' ? 'ok ' : 'ERR'} ${brand.slug.padEnd(16)} ${scan.pages_scanned ?? 0} page(s)  ${Date.now() - t0}ms`);
      return scan;
    });
  }

  if (args.listings) {
    const mod = await loadOptional('./listings.js');
    const wanted = (s) => !args.refresh || args.refresh.includes(s.slug);
    if (!mod) console.warn('  listings skipped: playwright is not installed');
    else for (const scan of scans) {
      if (scan.state !== 'observed' || !wanted(scan)) continue;
      scan.google_listing_lookup = await mod.lookupListing(scan);
      console.log(`  listing ${scan.slug.padEnd(15)} ${scan.google_listing_lookup.state} (${scan.google_listing_lookup.listings.length})`);
    }
  }

  if (renderer?.close) await renderer.close();

  const rows = scans.map(summariseBrand);
  const summary = {
    group: list.group ?? null,
    what_this_is: 'A dated reading of public pages, in five states. Each line is an observation and its limit, not a conclusion about the business.',
    states: STATES,
    generated_at: new Date().toISOString(),
    scanner_version: SCANNER_VERSION,
    method: 'A small, representative set of public pages per brand, fetched over HTTPS and read with declared patterns. No model call, no paid data source, no crawl.',
    scope_note: list.scope_note ?? null,
    counts: groupSummary(rows),
    operating_questions: OPERATING_QUESTIONS,
    brands: rows,
  };

  await mkdir(join(args.out, 'brands'), { recursive: true });
  for (const scan of scans) await writeFile(join(args.out, 'brands', `${scan.slug}.json`), JSON.stringify(scan, null, 2) + '\n');
  await writeFile(join(args.out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');

  console.log(`\nwrote ${scans.length} brand file(s) and summary.json to ${args.out}`);
  console.log(`  ${summary.counts.with_a_measurement_id_observed} of ${summary.counts.sites_read} site(s) carried a measurement ID in the pages tested`);
}

main().catch((err) => { console.error(err); process.exit(1); });
