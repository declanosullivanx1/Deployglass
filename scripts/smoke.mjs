// Smoke tests. Run: npm install && npx playwright install chromium
//   BASE_URL=http://127.0.0.1:8788 node scripts/smoke.mjs [--only=proxy,guard,headers,rows,failure,theme,pagination]
// rows/failure need >=1 real Pages project AND >=1 Worker with deployments in monitored accounts.
import { readFileSync } from "node:fs";
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:8788";
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const only = onlyArg ? onlyArg.slice(7).split(",") : null;
const want = (k) => !only || only.includes(k);
const results = [];
const ok = (name, cond, hint = "") => {
  results.push([name, !!cond]);
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && hint ? ` — ${hint}` : ""}`);
};
let secret = null;
try { secret = readFileSync(".dev.vars", "utf8").match(/^\s*CLOUDFLARE_API_TOKEN\s*=\s*"?([^"\n#]+)"?/m)?.[1]?.trim() ?? null; } catch {}

if (want("proxy")) {
  const r = await fetch(`${BASE}/api/accounts`); const b = await r.json().catch(() => ({}));
  ok("proxy-200", r.status === 200 && b.success === true, "is wrangler dev running with .dev.vars set?");
}
if (want("guard")) {
  const p = await fetch(`${BASE}/api/accounts`, { method: "POST" });
  const n = await fetch(`${BASE}/api/definitely-not-allowed`);
  ok("proxy-guard-405-404", p.status === 405 && n.status === 404);
}
if (want("headers")) {
  const r = await fetch(`${BASE}/`);
  const csp = r.headers.get("content-security-policy") ?? "";
  ok("security-headers", csp.includes("script-src")
    && r.headers.get("x-content-type-options") === "nosniff"
    && !!r.headers.get("referrer-policy") && !!r.headers.get("permissions-policy"));
  const a = await fetch(`${BASE}/api/accounts`);
  ok("api-nosniff", a.headers.get("x-content-type-options") === "nosniff");
}

const browserTests = ["rows", "failure", "theme", "pagination"].some(want) || (want("token") && secret);
if (browserTests) {
  let chromium;
  try { ({ chromium } = await import("playwright")); }
  catch { console.error("playwright missing: npm install && npx playwright install chromium"); process.exit(1); }
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const bodies = [];
  page.on("response", async (r) => { try { bodies.push(await r.text()); } catch {} });
  const DEP = /\/api\/accounts\/[a-f0-9]{32}\/pages\/projects\/[^/]+\/deployments/;
  let forced = false;
  if (want("failure")) await page.route(DEP, async (route) => {
    if (!forced) { forced = true;
      return route.fulfill({ status: 502, contentType: "application/json",
        body: JSON.stringify({ success: false, errors: [{ code: 502, message: "forced failure" }] }) }); }
    return route.continue();
  });
  await page.goto(BASE, { waitUntil: "networkidle" });
  if (want("rows")) {
    const srcs = await page.locator(".tabulator-row [tabulator-field='source']").allTextContents();
    ok("rows-both-sources", srcs.includes("pages") && srcs.includes("workers"),
      "needs >=1 Pages project and >=1 Worker with deployments");
  }
  if (want("failure")) ok("partial-failure-banner",
    await page.locator("#banner").isVisible() && (await page.locator(".tabulator-row").count()) > 0);
  if (want("theme")) {
    const before = await page.getAttribute("html", "data-theme");
    await page.click("#theme-toggle");
    const after = await page.getAttribute("html", "data-theme");
    await page.reload({ waitUntil: "networkidle" });
    const persisted = await page.getAttribute("html", "data-theme");
    const stored = await page.evaluate(() => localStorage.getItem("deployglass-theme"));
    ok("theme-persist", after !== before && persisted === after && stored === after);
  }
  if (want("pagination")) { // deterministic 60-row fixture, independent of real data
    await page.unroute(DEP);
    await page.route(/\/api\/accounts\/[a-f0-9]{32}\/pages\/projects(\?|$)/, (route) => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ success: true, fetched_at: new Date().toISOString(),
        result_info: { page: 1, per_page: 25, total_pages: 1 },
        result: [{ name: "fixture-proj", subdomain: "fixture.pages.dev" }] }),
    }));
    await page.route(DEP, (route) => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ success: true, fetched_at: new Date().toISOString(),
        result_info: { page: 1, per_page: 25, total_pages: 1 },
        result: Array.from({ length: 60 }, (_, i) => ({
          id: `fixture-${i}`, environment: "production", url: "https://fixture.pages.dev",
          created_on: new Date(Date.now() - i * 60_000).toISOString(),
          latest_stage: { status: "success" },
          deployment_trigger: { metadata: { branch: "main", commit_hash: "abc1234def", commit_message: "fixture" } },
        })) }),
    }));
    await page.reload({ waitUntil: "networkidle" });
    const visible = await page.locator(".tabulator-row").count();
    const page2 = await page.locator(".tabulator-page[data-page='2']").count();
    ok("paginate-gt50", visible === 50 && page2 > 0, `visible=${visible} page2=${page2}`);
  }
  if (want("token")) {
    if (secret) ok("token-absent", !bodies.some((t) => t.includes(secret)));
    else console.log("SKIP token-absent (no .dev.vars token found)");
  }
  await browser.close();
}
const failed = results.filter(([, pass]) => !pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exitCode = failed ? 1 : 0;
