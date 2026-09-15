// Fails the run if the output is incomplete, if a state outside the declared
// five appears, or if the reconciliation did not answer its own checks.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const dir = process.argv[2] ?? "data";
const brandsFile = JSON.parse(await readFile("example-brands.json", "utf8"));
const summary = JSON.parse(await readFile(join(dir, "summary.json"), "utf8"));
const pipeline = JSON.parse(await readFile(join(dir, "pipeline.json"), "utf8"));

const STATES = new Set(summary.states);
const problems = [];

if (summary.brands.length !== brandsFile.brands.length) {
  problems.push(`summary holds ${summary.brands.length} brands, expected ${brandsFile.brands.length}`);
}
for (const b of brandsFile.brands) {
  const row = summary.brands.find((r) => r.slug === b.slug);
  if (!row) { problems.push(`${b.slug} is missing from the summary`); continue; }
  if (!STATES.has(row.state)) problems.push(`${b.slug} carries an undeclared state: ${row.state}`);
  for (const [field, value] of Object.entries(row)) {
    if (value && typeof value === "object" && typeof value.state === "string" && !STATES.has(value.state)) {
      problems.push(`${b.slug}.${field} carries an undeclared state: ${value.state}`);
    }
  }
  try { await readFile(join(dir, "brands", `${b.slug}.json`), "utf8"); }
  catch { problems.push(`${b.slug}.json was not written`); }
}
if (!summary.generated_at || !summary.counts) problems.push("summary is missing its header");
if (summary.operating_questions?.length !== 3) problems.push("the three operating questions are missing");

if (!pipeline.records_are_fictional) problems.push("the reconciliation did not declare its records fictional");
if (pipeline.acceptance.passed !== pipeline.acceptance.of) {
  problems.push(`the reconciliation answered ${pipeline.acceptance.passed} of ${pipeline.acceptance.of} of its own checks`);
}
if (pipeline.replayed_with_the_same_records.group_revenue !== pipeline.run.totals.group_revenue) {
  problems.push("a replay moved the group total");
}

if (problems.length) {
  console.error("incomplete output:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log(`ok: ${summary.brands.length} site(s) read, ${summary.counts.pages_read} page(s), generated ${summary.generated_at}`);
console.log(`ok: reconciliation answered ${pipeline.acceptance.of} of ${pipeline.acceptance.of} checks, replay held the total at ${pipeline.run.totals.group_revenue}`);
