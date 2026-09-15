// Plain HTTP fetching with an explicit redirect chain, so every result can be
// traced back to the exact URL that produced it.

export const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

/**
 * Fetch one URL, following redirects by hand so the chain is recorded.
 * Never throws on an HTTP error status; only on network/timeout failures.
 */
export async function fetchPage(url, opts = {}) {
  const { timeoutMs = 30000, maxRedirects = 8, accept = 'text/html,application/xhtml+xml,*/*;q=0.8' } = opts;
  const chain = [];
  const seen = new Set();
  let current = url;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (seen.has(current)) throw new Error(`redirect loop at ${current}`);
    seen.add(current);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();
    let res;
    try {
      res = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'user-agent': USER_AGENT, accept, 'accept-language': 'en-US,en;q=0.9' },
      });
    } finally {
      clearTimeout(timer);
    }
    const ms = Date.now() - started;
    chain.push({ url: current, status: res.status, ms });

    if (REDIRECT_CODES.has(res.status)) {
      const location = res.headers.get('location');
      if (!location) break;
      current = new URL(location, current).toString();
      continue;
    }

    const body = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      requestedUrl: url,
      finalUrl: current,
      html: body,
      bytes: Buffer.byteLength(body, 'utf8'),
      headers: Object.fromEntries(res.headers.entries()),
      chain,
      fetchedAt: new Date().toISOString(),
    };
  }
  throw new Error(`too many redirects for ${url}`);
}

/** Does http:// upgrade to https:// ? Returns a small, quotable record. */
export async function checkHttpsUpgrade(origin, opts = {}) {
  const insecure = origin.replace(/^https:/, 'http:');
  try {
    const r = await fetchPage(insecure, { ...opts, timeoutMs: opts.timeoutMs ?? 20000 });
    return {
      status: 'checked',
      from: insecure,
      to: r.finalUrl,
      upgraded: r.finalUrl.startsWith('https://'),
      chain: r.chain,
      hsts: r.headers['strict-transport-security'] ?? null,
    };
  } catch (err) {
    return { status: 'not_verified', from: insecure, reason: String(err.message || err) };
  }
}

/** Run promise-returning jobs with a small concurrency cap. */
export async function mapLimit(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}
