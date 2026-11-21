// Deployglass proxy: GET-only allowlist over Cloudflare REST v4.
// Secret lives ONLY here (env.CLOUDFLARE_API_TOKEN, Pages encrypted secret).
// Verified 2026-11-22: route shapes, id charsets, per_page maxima (accounts 50,
// workers deployments 100; Pages lists undocumented -> conservative 25).
const ROUTES = [
  { re: /^accounts$/, per: 50 },
  { re: /^accounts\/[a-f0-9]{32}\/pages\/projects$/, per: 25 },
  { re: /^accounts\/[a-f0-9]{32}\/pages\/projects\/[a-z0-9][a-z0-9-]{0,127}\/deployments$/, per: 25, env: true },
  { re: /^accounts\/[a-f0-9]{32}\/workers\/scripts$/, per: 0 },
  { re: /^accounts\/[a-f0-9]{32}\/workers\/scripts\/[a-zA-Z0-9_-]{1,128}\/deployments$/, per: 100 },
  { re: /^accounts\/[a-f0-9]{32}\/workers\/subdomain$/, per: 0 },
  { re: /^user\/tokens\/verify$/, per: 0 },
];
const BASE = "https://api.cloudflare.com/client/v4/";
const HEADERS = {
  "Content-Type": "application/json",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
};
const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });
const fail = (status, code, message) =>
  json({ success: false, errors: [{ code, message }] }, status);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Best-effort per-isolate guards (isolates do not share state; see README limitations).
let inflight = 0;
const window5 = [];
const WINDOW_MS = 300_000, WINDOW_CAP = 1100, MAX_CONCURRENT = 6;
const budgetTake = () => {
  const now = Date.now();
  while (window5.length && now - window5[0] > WINDOW_MS) window5.shift();
  if (window5.length >= WINDOW_CAP) return false;
  window5.push(now); return true;
};
async function fetchUpstream(target, token) {
  let last = { status: 502, body: { success: false, errors: [{ code: 502, message: "upstream unreachable" }] } };
  for (let n = 0; n < 4; n++) { // 1 attempt + 3 retries, full jitter, Retry-After honored
    if (!budgetTake()) return { status: 429, body: { success: false, errors: [{ code: 429, message: "proxy rate budget exhausted (best-effort, per isolate)" }] } };
    while (inflight >= MAX_CONCURRENT) await sleep(40);
    inflight++;
    let res = null, netErr = false;
    try { res = await fetch(target, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }); }
    catch { netErr = true; }
    finally { inflight--; }
    if (!netErr) {
      let body; try { body = await res.json(); }
      catch { body = { success: false, errors: [{ code: res.status, message: `upstream non-JSON (${res.status})` }] }; }
      if (res.status !== 429 && res.status < 500) return { status: res.status, body };
      last = { status: res.status, body };
      if (n === 3) return last;
      const ra = Number(res.headers.get("Retry-After"));
      await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 30_000) : Math.min(8000, 500 * 2 ** n) * Math.random());
      continue;
    }
    if (n === 3) return last;
    await sleep(Math.min(8000, 500 * 2 ** n) * Math.random());
  }
  return last;
}
export async function onRequest({ request, env }) {
  if (request.method !== "GET")
    return json({ success: false, errors: [{ code: 405, message: "GET only" }] }, 405, { Allow: "GET" });
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/+$/, "");
  const route = ROUTES.find((r) => r.re.test(path));
  if (!route) return fail(404, 404, "route not allowed");
  const allowed = (env.ACCOUNT_IDS || env.CLOUDFLARE_ACCOUNT_ID || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const acct = path.match(/^accounts\/([a-f0-9]{32})(?:\/|$)/)?.[1];
  if (acct && !allowed.includes(acct)) return fail(403, 403, "account not monitored");
  if (!env.CLOUDFLARE_API_TOKEN) return fail(500, 500, "server missing CLOUDFLARE_API_TOKEN");
  const q = new URLSearchParams();
  for (const [k, v] of url.searchParams) { // strict query allowlist; anything else -> 400
    if (k === "env" && route.env && /^(production|preview)$/.test(v)) { q.set(k, v); continue; }
    if (k === "page" && route.per > 0 && /^\d+$/.test(v) && +v >= 1 && +v <= 10_000) { q.set(k, v); continue; }
    if (k === "per_page" && route.per > 0 && /^\d+$/.test(v) && +v >= 1 && +v <= route.per) { q.set(k, v); continue; }
    return fail(400, 400, `parameter not allowed: ${k}`);
  }
  const qs = [...q].sort().map(([k, v]) => `${k}=${v}`).join("&");
  const target = BASE + path + (qs ? `?${qs}` : "");
  // Cache API: per-colo, GET keys only; unavailable behind Cloudflare Access -> guarded.
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const key = new Request(`https://radar-cache.internal/${path}?${qs}`, { method: "GET" });
  if (cache) {
    try {
      const hit = await cache.match(key);
      if (hit) return json({ ...(await hit.json()), cache: "HIT" }, 200, { "X-Radar-Cache": "HIT" });
    } catch { /* cache unavailable: continue uncached */ }
  }
  const { status, body } = await fetchUpstream(target, env.CLOUDFLARE_API_TOKEN);
  let out = body;
  if (path === "accounts" && Array.isArray(body?.result))
    out = { ...body, result: body.result.filter((a) => allowed.includes(a.id)) };
  if (status !== 200 || body?.success === false) return json(out, status, { "X-Radar-Cache": "BYPASS" });
  const envelope = { ...out, fetched_at: new Date().toISOString(), cache: "MISS" };
  if (cache) {
    try {
      await cache.put(key, new Response(JSON.stringify(envelope),
        { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" } }));
    } catch { /* too large / disabled: serve uncached */ }
  }
  return json(envelope, 200, { "X-Radar-Cache": "MISS" });
}
