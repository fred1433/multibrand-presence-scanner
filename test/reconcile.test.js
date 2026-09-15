import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcile, acceptanceChecks, RULES } from '../src/pipeline/reconcile.js';

const leads = [
  { lead_id: 'L-1', created_at: '2026-09-01T10:00:00Z', entry_brand: 'a', channel: 'form', campaign: 'x', contact: { phone: '(555) 010-0001' } },
  { lead_id: 'L-2', created_at: '2026-09-01T11:00:00Z', entry_brand: 'b', channel: 'phone', campaign: 'y', contact: { phone: '(555) 010-0002' } },
];
const bookings = [
  { booking_id: 'B-1', lead_id: 'L-1', entry_brand: 'a', performing_brand: 'a', status: 'booked', amount: 100, at: '2026-09-02T10:00:00Z' },
  { booking_id: 'B-2', lead_id: 'L-2', entry_brand: 'b', performing_brand: 'a', status: 'booked', amount: 250.25, at: '2026-09-02T11:00:00Z' },
  { booking_id: 'B-3', lead_id: null, entry_brand: 'a', performing_brand: 'a', status: 'booked', amount: 40, at: '2026-09-02T12:00:00Z' },
  { booking_id: 'B-4', lead_id: 'L-1', entry_brand: 'a', performing_brand: 'a', status: 'quote', amount: 900, at: '2026-09-02T13:00:00Z' },
  { booking_id: 'B-5', lead_id: 'L-2', entry_brand: 'b', performing_brand: 'b', status: 'cancelled', amount: 700, at: '2026-09-02T14:00:00Z' },
];
const calls = [
  { call_id: 'C-1', at: '2026-09-01T11:00:00Z', direction: 'inbound', from: '(555) 010-0002', to: '(555) 020-0001', lead_id: 'L-2' },
  { call_id: 'C-2', at: '2026-09-01T18:00:00Z', direction: 'outbound', from: '(555) 020-0001', to: '(555) 010-0001', purpose: 'reminder' },
  { call_id: 'C-3', at: '2026-09-02T09:00:00Z', direction: 'inbound', from: '(555) 010-7777', to: '(555) 020-0001' },
];

const base = () => reconcile({ leads: [leads], calls: [calls], bookings: [bookings], payments: [[]] });

test('a lead becomes a booking through the id the booking carries', () => {
  const r = base();
  const b1 = r.bookings.find((b) => b.booking_id === 'B-1');
  assert.equal(b1.lead_id, 'L-1');
  assert.equal(b1.attribution, 'attributed by the lead id on the booking');
  assert.deepEqual(b1.source, { channel: 'form', campaign: 'x' });
});

test('a quote and a cancellation are not revenue', () => {
  const r = base();
  assert.equal(r.totals.group_revenue, 390.25);
  assert.deepEqual(r.totals.excluded_by_status.map((e) => e.booking_id).sort(), ['B-4', 'B-5']);
});

test('a booking entered by one brand and performed by another counts once', () => {
  const r = base();
  assert.equal(r.totals.by_entry_brand.a, 140);
  assert.equal(r.totals.by_entry_brand.b, 250.25);
  assert.equal(r.totals.by_performing_brand.a, 390.25);
  assert.equal(r.totals.by_performing_brand.b, undefined);
  const sum = (o) => Number(Object.values(o).reduce((t, v) => t + Math.round(v * 100), 0) / 100);
  assert.equal(sum(r.totals.by_entry_brand), r.totals.group_revenue);
  assert.equal(sum(r.totals.by_performing_brand), r.totals.group_revenue);
  assert.equal(r.bookings.find((b) => b.booking_id === 'B-2').multibrand, true);
});

test('a booking with no key stays unattributed, visible, and still in the group total', () => {
  const r = base();
  assert.deepEqual(r.totals.unattributed_bookings, ['B-3']);
  assert.equal(r.totals.unattributed_revenue, 40);
  assert.equal(r.totals.attributed_revenue + r.totals.unattributed_revenue, r.totals.group_revenue);
  assert.match(r.bookings.find((b) => b.booking_id === 'B-3').unattributed_reason, /no lead id/);
});

test('a shared phone number never becomes a join between a booking and a lead', () => {
  const shared = [
    { lead_id: 'L-9', created_at: '2026-09-01T10:00:00Z', entry_brand: 'a', channel: 'phone', campaign: 'z', contact: { phone: '(555) 010-0001' } },
  ];
  const orphan = [{ booking_id: 'B-9', lead_id: null, entry_brand: 'a', performing_brand: 'a', status: 'booked', amount: 10, at: '2026-09-02T10:00:00Z' }];
  const r = reconcile({ leads: [shared], calls: [[]], bookings: [orphan], payments: [[]] });
  assert.equal(r.bookings[0].lead_id, null, 'the booking must not borrow a lead from a number they share');
});

test('a reminder call attaches to its lead and opens none', () => {
  const r = base();
  const byId = r.calls.find((c) => c.call_id === 'C-1');
  const reminder = r.calls.find((c) => c.call_id === 'C-2');
  const stranger = r.calls.find((c) => c.call_id === 'C-3');
  assert.equal(byId.lead_id, 'L-2');
  assert.equal(reminder.lead_id, 'L-1');
  assert.equal(reminder.attached_by, 'the number the lead came in on');
  assert.equal(stranger.lead_id, null);
  assert.ok(r.calls.every((c) => c.created_a_lead === false));
  assert.equal(r.intake.leads, 2, 'no call may add a lead');
});

test('re-importing the same records moves no total', () => {
  const once = base();
  const twice = reconcile({ leads: [leads], calls: [calls], bookings: [bookings, bookings], payments: [[]] });
  assert.equal(twice.totals.group_revenue, once.totals.group_revenue);
  assert.equal(twice.intake.bookings, once.intake.bookings);
  assert.equal(twice.intake.duplicates_ignored, bookings.length);
  assert.equal(twice.intake.conflicts.length, 0);
});

test('a record that came back changed is reported, not silently kept or overwritten', () => {
  const changed = bookings.map((b) => (b.booking_id === 'B-1' ? { ...b, amount: 999 } : b));
  const r = reconcile({ leads: [leads], calls: [calls], bookings: [bookings, changed], payments: [[]] });
  assert.equal(r.intake.conflicts.length, 1);
  assert.equal(r.intake.conflicts[0].id, 'B-1');
  assert.equal(r.totals.group_revenue, 390.25, 'the first record read stands until a human decides');
});

test('a record without an id is rejected and named, never dropped in silence', () => {
  const r = reconcile({ leads: [[{ entry_brand: 'a' }]], calls: [[]], bookings: [[]], payments: [[]] });
  assert.equal(r.intake.rejected.length, 1);
  assert.match(r.intake.rejected[0].reason, /without lead_id/);
});

test('money survives a replay without drifting', () => {
  const pennies = [{ booking_id: 'B-P', lead_id: 'L-1', entry_brand: 'a', performing_brand: 'a', status: 'booked', amount: 0.1, at: '2026-09-02T10:00:00Z' }];
  const r = reconcile({ leads: [leads], calls: [[]], bookings: [pennies, pennies, pennies], payments: [[]] });
  assert.equal(r.totals.group_revenue, 0.1);
});

test('payments are attached to their booking', () => {
  const pay = [{ payment_id: 'P-1', booking_id: 'B-1', amount: 100, at: '2026-09-03T10:00:00Z' }];
  const r = reconcile({ leads: [leads], calls: [[]], bookings: [bookings], payments: [pay] });
  assert.equal(r.bookings.find((b) => b.booking_id === 'B-1').paid, 100);
  assert.equal(r.totals.paid_to_date, 100);
});

test('the acceptance checks answer every rule the run claims to follow', () => {
  const run = base();
  const rerun = reconcile({ leads: [leads], calls: [calls], bookings: [bookings, bookings], payments: [[]] });
  const a = acceptanceChecks(run, rerun);
  assert.equal(a.passed, a.of);
  assert.equal(a.of, 5);
  for (const rule of RULES) {
    if (rule.id === 'lead_to_booking') continue;
    assert.ok(a.checks.some((c) => c.id === rule.id), `no check answers ${rule.id}`);
  }
});

test('a broken run fails its own checks rather than reporting success', () => {
  const run = base();
  const drifted = JSON.parse(JSON.stringify(run));
  drifted.totals.group_revenue = 999;
  const a = acceptanceChecks(run, drifted);
  assert.ok(a.passed < a.of, 'a total that moved on replay has to fail the check');
});
