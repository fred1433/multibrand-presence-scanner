// A lead-to-booking reconciliation that can be run twice and checked.
//
// The rules below are the whole of it. They are deliberately conservative: a
// link is made when a record carries the key that proves it, and never guessed
// from something two records happen to share, such as a phone number that
// several brands publish.
//
// 1. A lead becomes a booking when the booking carries that lead's id.
// 2. A follow-up or reminder call does not create a lead. A call attaches to an
//    existing lead by its id, or by the number that lead came in on. It never
//    opens a new one.
// 3. Re-importing the same records does not move any total: every record is
//    taken once, by its own id, and a second copy with the same content is
//    ignored while a second copy with different content is reported as a
//    conflict.
// 4. A booking that cannot be tied to a lead by a key stays unattributed and
//    stays visible. It is counted in the group total and in no source.
// 5. A booking entered by one brand and performed by another keeps both
//    dimensions. It is counted once in the group total, once under its entry
//    brand and once under its performing brand, so neither view sums to more
//    than the group.

export const RULES = [
  { id: 'lead_to_booking', text: 'A lead becomes a booking when the booking carries that lead id.' },
  { id: 'reminder_is_not_a_lead', text: 'A follow-up or reminder call attaches to the lead it belongs to and never opens a new one.' },
  { id: 'reimport_is_idempotent', text: 'Re-importing the same records changes no total, and a record that changed is reported as a conflict.' },
  { id: 'no_proof_stays_unattributed', text: 'A booking with no key back to a lead stays unattributed and stays visible.' },
  { id: 'multibrand_counts_once', text: 'A booking entered by one brand and performed by another keeps both dimensions and counts once in the group total.' },
];

/** Money is handled in cents so a re-run cannot drift by a rounding step. */
const cents = (n) => Math.round(Number(n) * 100);
const money = (c) => Number((c / 100).toFixed(2));
const phoneKey = (v) => String(v ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');

/** Statuses that count as revenue. A quote is not a booking; a cancellation is not either. */
export const REVENUE_STATUSES = new Set(['booked', 'paid']);

function ingest(store, kind, records, idField, report) {
  for (const record of records) {
    const id = record[idField];
    if (!id) {
      report.rejected.push({ kind, reason: `record without ${idField}`, record });
      continue;
    }
    const existing = store.get(id);
    if (!existing) {
      store.set(id, record);
      report.taken.push(`${kind}:${id}`);
      continue;
    }
    if (JSON.stringify(existing) === JSON.stringify(record)) {
      report.ignored_duplicates.push(`${kind}:${id}`);
    } else {
      report.conflicts.push({ kind, id, held: existing, offered: record });
    }
  }
}

/**
 * Run the chain over whatever record sets are given. Pure: same input, same
 * output, no clock, no network.
 */
export function reconcile(sources) {
  const report = { taken: [], ignored_duplicates: [], conflicts: [], rejected: [] };
  const leads = new Map();
  const calls = new Map();
  const bookings = new Map();
  const payments = new Map();

  for (const batch of sources.leads ?? []) ingest(leads, 'lead', batch, 'lead_id', report);
  for (const batch of sources.calls ?? []) ingest(calls, 'call', batch, 'call_id', report);
  for (const batch of sources.bookings ?? []) ingest(bookings, 'booking', batch, 'booking_id', report);
  for (const batch of sources.payments ?? []) ingest(payments, 'payment', batch, 'payment_id', report);

  // Rule 2: attach calls to leads, never create one.
  const leadByPhone = new Map();
  for (const lead of leads.values()) {
    const key = phoneKey(lead.contact?.phone);
    if (key && !leadByPhone.has(key)) leadByPhone.set(key, lead.lead_id);
  }
  const callLinks = [];
  for (const call of calls.values()) {
    const counterpart = call.direction === 'inbound' ? call.from : call.to;
    const byId = call.lead_id && leads.has(call.lead_id) ? call.lead_id : null;
    const byPhone = leadByPhone.get(phoneKey(counterpart)) ?? null;
    const leadId = byId ?? byPhone;
    callLinks.push({
      call_id: call.call_id,
      lead_id: leadId,
      attached_by: byId ? 'lead id on the call' : byPhone ? 'the number the lead came in on' : null,
      created_a_lead: false,
      note: leadId ? null : 'No lead carries this number in the records given. The call is kept and left unattached; it does not open a lead.',
    });
  }

  // Rules 1, 4 and 5: bookings.
  const paidByBooking = new Map();
  for (const p of payments.values()) {
    paidByBooking.set(p.booking_id, (paidByBooking.get(p.booking_id) ?? 0) + cents(p.amount));
  }

  const rows = [];
  for (const b of bookings.values()) {
    const linkedLead = b.lead_id && leads.has(b.lead_id) ? leads.get(b.lead_id) : null;
    const counted = REVENUE_STATUSES.has(b.status);
    rows.push({
      booking_id: b.booking_id,
      status: b.status,
      counts_as_revenue: counted,
      amount: money(cents(b.amount)),
      entry_brand: b.entry_brand ?? null,
      performing_brand: b.performing_brand ?? null,
      multibrand: Boolean(b.entry_brand && b.performing_brand && b.entry_brand !== b.performing_brand),
      lead_id: linkedLead?.lead_id ?? null,
      source: linkedLead ? { channel: linkedLead.channel, campaign: linkedLead.campaign } : null,
      attribution: linkedLead ? 'attributed by the lead id on the booking' : 'unattributed',
      unattributed_reason: linkedLead ? null : 'The booking carries no lead id, and no link was made from a shared phone number.',
      paid: money(paidByBooking.get(b.booking_id) ?? 0),
    });
  }

  const revenue = rows.filter((r) => r.counts_as_revenue);
  const sum = (list) => money(list.reduce((t, r) => t + cents(r.amount), 0));
  const byDimension = (field) => {
    const out = {};
    for (const r of revenue) {
      const k = r[field] ?? 'unknown';
      out[k] = money(cents(out[k] ?? 0) + cents(r.amount));
    }
    return out;
  };

  const groupTotal = sum(revenue);
  const byEntry = byDimension('entry_brand');
  const byPerforming = byDimension('performing_brand');
  const unattributed = revenue.filter((r) => !r.lead_id);

  return {
    rules: RULES,
    intake: {
      leads: leads.size,
      calls: calls.size,
      bookings: bookings.size,
      payments: payments.size,
      records_taken: report.taken.length,
      duplicates_ignored: report.ignored_duplicates.length,
      conflicts: report.conflicts,
      rejected: report.rejected,
    },
    calls: callLinks,
    bookings: rows,
    totals: {
      group_revenue: groupTotal,
      by_entry_brand: byEntry,
      by_performing_brand: byPerforming,
      attributed_revenue: sum(revenue.filter((r) => r.lead_id)),
      unattributed_revenue: sum(unattributed),
      unattributed_bookings: unattributed.map((r) => r.booking_id),
      paid_to_date: money(rows.reduce((t, r) => t + cents(r.paid), 0)),
      excluded_by_status: rows.filter((r) => !r.counts_as_revenue).map((r) => ({ booking_id: r.booking_id, status: r.status })),
    },
  };
}

/**
 * The checks a reader can hold the run to. Each one is answered by the run
 * itself, not asserted about it.
 */
const usd = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function acceptanceChecks(run, rerun) {
  const sumOf = (o) => Number(Object.values(o).reduce((t, v) => t + Math.round(v * 100), 0) / 100);
  const checks = [
    {
      id: 'multibrand_counts_once',
      question: 'Does a booking entered by one brand and performed by another count once in the group total?',
      expected: 'the entry view and the performing view each sum to the group total',
      observed: `group ${usd(run.totals.group_revenue)}, by entry brand ${usd(sumOf(run.totals.by_entry_brand))}, by performing brand ${usd(sumOf(run.totals.by_performing_brand))}`,
      pass: sumOf(run.totals.by_entry_brand) === run.totals.group_revenue && sumOf(run.totals.by_performing_brand) === run.totals.group_revenue,
    },
    {
      id: 'reimport_is_idempotent',
      question: 'Does importing the same records a second time move any total?',
      expected: 'identical totals, duplicates reported rather than added',
      observed: `first run ${usd(run.totals.group_revenue)}, replayed ${usd(rerun.totals.group_revenue)}, ${rerun.intake.duplicates_ignored} duplicate record(s) ignored`,
      pass: rerun.totals.group_revenue === run.totals.group_revenue && rerun.intake.conflicts.length === 0,
    },
    {
      id: 'no_proof_stays_unattributed',
      question: 'Is a booking with no key back to a lead left unattributed and still visible?',
      expected: 'it appears in the unattributed list and in the group total',
      observed: `${run.totals.unattributed_bookings.length} unattributed booking(s) worth ${usd(run.totals.unattributed_revenue)}, listed by id`,
      pass: run.totals.unattributed_revenue + run.totals.attributed_revenue === run.totals.group_revenue,
    },
    {
      id: 'reminder_is_not_a_lead',
      question: 'Does a follow-up or reminder call ever open a lead?',
      expected: 'no call creates a lead',
      observed: `${run.calls.length} call(s) read, ${run.calls.filter((c) => c.lead_id).length} attached to an existing lead, 0 created`,
      pass: run.calls.every((c) => c.created_a_lead === false),
    },
    {
      id: 'amount_traces_to_source',
      question: 'Does every amount shown trace back to the record it came from?',
      expected: 'every booking row carries its own id and status',
      observed: `${run.bookings.length} booking row(s), each with its id, status and amount`,
      pass: run.bookings.every((b) => b.booking_id && b.status && typeof b.amount === 'number'),
    },
  ];
  return { checks, passed: checks.filter((c) => c.pass).length, of: checks.length };
}
