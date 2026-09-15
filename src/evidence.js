// Every claim this scanner makes carries the literal text that produced it.

const MAX_SNIPPET = 190;

export function collapse(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

/**
 * Source excerpts are stored and republished, so a personal address found in
 * one is masked. The page it came from is linked next to every excerpt, so the
 * original is always one click away.
 */
export function maskEmails(text) {
  return String(text).replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[address removed]');
}

/** The literal source excerpt around a match, trimmed and whitespace-collapsed. */
export function snippetAt(source, index, matchLength, pad = 55) {
  const start = Math.max(0, index - pad);
  const end = Math.min(source.length, index + matchLength + pad);
  let out = maskEmails(collapse(source.slice(start, end)));
  if (out.length > MAX_SNIPPET) out = out.slice(0, MAX_SNIPPET) + '…';
  return (start > 0 ? '…' : '') + out + (end < source.length ? '…' : '');
}

/**
 * A finding: what was found, where, and the exact bytes that prove it.
 * `method` says how it was obtained so a reader can reproduce it.
 */
export function finding({ value, url, source, index, length, method = 'html', extra }) {
  const f = { value, evidence_url: url, method };
  if (source != null && index != null) f.snippet = snippetAt(source, index, length ?? String(value).length);
  if (extra) Object.assign(f, extra);
  return f;
}

/** A thing we could not resolve. Never guessed, always labelled. */
export function notVerified(reason, extra = {}) {
  return { status: 'not_verified', reason, ...extra };
}
