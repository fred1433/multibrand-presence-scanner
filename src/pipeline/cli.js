#!/usr/bin/env node
// Runs the reconciliation over the fictional records in fixtures/records/,
// runs it a second time with the same records re-imported, and writes both
// with the acceptance checks. No network, no model, no clock in the result.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reconcile, acceptanceChecks, RULES } from './reconcile.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const load = async (name) => JSON.parse(await readFile(join(ROOT, 'fixtures/records', name), 'utf8'));

async function main() {
  const outDir = process.argv.includes('--out') ? resolve(process.argv[process.argv.indexOf('--out') + 1]) : join(ROOT, 'data');

  const leads = await load('leads.json');
  const calls = await load('calls.json');
  const bookings = await load('bookings.json');
  const reimport = await load('bookings.reimport.json');
  const payments = await load('payments.json');

  const run = reconcile({ leads: [leads], calls: [calls], bookings: [bookings], payments: [payments] });
  const rerun = reconcile({ leads: [leads], calls: [calls], bookings: [bookings, reimport], payments: [payments] });
  const acceptance = acceptanceChecks(run, rerun);

  const out = {
    what_this_is: 'A lead to booking reconciliation executed over invented records, so the rules it follows can be replayed and checked. Nothing here describes any real business.',
    records_are_fictional: true,
    rules: RULES,
    run,
    replayed_with_the_same_records: {
      group_revenue: rerun.totals.group_revenue,
      duplicates_ignored: rerun.intake.duplicates_ignored,
      conflicts: rerun.intake.conflicts.length,
    },
    acceptance,
  };

  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'pipeline.json'), JSON.stringify(out, null, 2) + '\n');

  console.log(`reconciled ${run.intake.bookings} booking(s) from ${run.intake.leads} lead(s) and ${run.intake.calls} call(s)`);
  console.log(`  group revenue ${run.totals.group_revenue}, unattributed ${run.totals.unattributed_revenue} (${run.totals.unattributed_bookings.join(', ') || 'none'})`);
  console.log(`  replayed with the same records: ${rerun.totals.group_revenue}, ${rerun.intake.duplicates_ignored} duplicate(s) ignored`);
  for (const c of acceptance.checks) console.log(`  ${c.pass ? 'pass' : 'FAIL'}  ${c.id}: ${c.observed}`);
  console.log(`wrote ${join(outDir, 'pipeline.json')}`);
  if (acceptance.passed !== acceptance.of) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
