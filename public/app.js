// Deployglass client. Pipeline: fetch -> paginate -> normalize -> Tabulator.
// Browser only ever calls same-origin /api/*; the token never reaches this file.
const PER = { accounts: 50, pages: 25, workersDeps: 100 }; // verified API maxima; Pages max undocumented -> 25
const AUTO_MS = 60_000, STALE_MS = 90_000, MAX_FANOUT = 150, HARD_PAGE_CAP = 200;
const $ = (s) => document.querySelector(s);
const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const state = { table: null, data: [], lastUpdated: null, refreshing: false, firstLoad: true,
  budget: 0, budgetHit: false, autoTimer: null, fallback: false };

async function api(path, params = {}) {
  if (state.budget >= MAX_FANOUT) { state.budgetHit = true;
    throw Object.assign(new Error("fan-out cap reached"), { path: "budget" }); }
  state.budget++;
  const res = await fetch(`/api/${path}?${new URLSearchParams(params)}`);
  let body; try { body = await res.json(); } catch { body = { success: false, errors: [{ message: `non-JSON response (${res.status})` }] }; }
  if (!res.ok || body.success === false)
    throw Object.assign(new Error(body.errors?.[0]?.message ?? `HTTP ${res.status}`), { path });
  if (body.fetched_at) {
    const t = Date.parse(body.fetched_at);
    state.oldest = Math.min(state.oldest ?? t, t);
  }
  return body;
}
async function paginate(path, per_page, params = {}) {
  let page = 1, rows = [], meta;
  do {
    meta = await api(path, { ...params, page, per_page });
    rows.push(...(Array.isArray(meta.result) ? meta.result : meta.result?.deployments ?? []));
    page++;
  } while (meta.result_info?.total_pages && page <= meta.result_info.total_pages && page <= HARD_PAGE_CAP);
  return rows;
}
async function pool(jobs, n) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, jobs.length)) }, async () => {
    while (i < jobs.length) { const j = i++; await jobs[j](); }
  }));
}
const pagesRow = (a, p, d) => ({
  source: "pages", account_id: a, project: p, deployment_id: d.id,
  environment: d.environment ?? null, status: d.latest_stage?.status ?? "unknown",
  branch: d.deployment_trigger?.metadata?.branch ?? null,
  commit_hash: d.deployment_trigger?.metadata?.commit_hash ?? null,
  commit_message: d.deployment_trigger?.metadata?.commit_message ?? null,
  url: d.url ?? null, author: d.deployment_trigger?.metadata?.author ?? null,
  created_on: d.created_on ?? null, versions: null,
});
const workerRow = (a, s, d, i, sub) => ({
  source: "workers", account_id: a, project: s, deployment_id: d.id,
  environment: d.versions?.length > 1 ? "version-split" : i === 0 ? "production" : "inactive",
  status: i === 0 ? "active" : "superseded", // derived: API list item 0 is actively serving (doc-stated)
  branch: null, commit_hash: null, commit_message: null,
  url: sub ? `https://${s}.${sub}.workers.dev` : null,
  author: d.author_email ?? null, created_on: d.created_on ?? null, versions: d.versions ?? null,
});
async function collect() {
  const errors = [], rows = []; state.oldest = null;
  const accounts = await paginate("accounts", PER.accounts); // catastrophic failure handled by refresh()
  await pool(accounts.map((a) => async () => {
    const [projects, scripts, sub] = await Promise.allSettled([
      paginate(`accounts/${a.id}/pages/projects`, PER.pages),
      api(`accounts/${a.id}/workers/scripts`),
      api(`accounts/${a.id}/workers/subdomain`),
    ]);
    for (const r of [projects, scripts, sub]) if (r.status === "rejected") errors.push(r.reason);
    const subdomain = sub.status === "fulfilled" ? sub.value.result?.subdomain ?? null : null;
    const jobs = [];
    if (projects.status === "fulfilled") for (const p of projects.value) jobs.push(async () => {
      try { rows.push(...(await paginate(`accounts/${a.id}/pages/projects/${p.name}/deployments`, PER.pages))
        .map((d) => pagesRow(a.id, p.name, d))); } catch (e) { errors.push(e); }
    });
    if (scripts.status === "fulfilled") for (const s of scripts.value.result ?? []) jobs.push(async () => {
      try { rows.push(...(await paginate(`accounts/${a.id}/workers/scripts/${s.id}/deployments`, PER.workersDeps))
        .map((d, i) => workerRow(a.id, s.id, d, i, subdomain))); } catch (e) { errors.push(e); }
    });
    await pool(jobs, 4);
  }), 2);
  return { rows, errors };
}
const COLUMNS = [
  { title: "Source", field: "source", headerFilter: "list", headerFilterParams: { values: { "": "all", pages: "pages", workers: "workers" } } },
  { title: "Account", field: "account_id", visible: false },
  { title: "Project / script", field: "project", headerFilter: "input" },
  { title: "Deployment", field: "deployment_id", formatter: (c) => c.getValue()?.slice(0, 8) ?? "" },
  { title: "Env", field: "environment", headerFilter: "input", formatter: (c) => {
      const v = c.getValue(), vs = c.getRow().getData().versions;
      return v === "version-split" && vs ? `split ${vs.map((x) => x.percentage + "%").join("/")}` : v ?? ""; } },
  { title: "Status", field: "status", headerFilter: "input" }, // text badges: never color-only
  { title: "Branch", field: "branch", headerFilter: "input", responsive: 2 },
  { title: "Commit", field: "commit_hash", responsive: 3, formatter: (c) => c.getValue()?.slice(0, 7) ?? "" },
  { title: "Message", field: "commit_message", tooltip: true, responsive: 3 },
  { title: "URL", field: "url", formatter: "link", formatterParams: { target: "_blank", rel: "noopener" }, responsive: 2 },
  { title: "Author", field: "author", responsive: 3 },
  { title: "Created", field: "created_on", responsive: 1,
    // ISO-8601 UTC strings sort lexicographically; avoids Tabulator's Luxon dependency.
    sorter: (a, b) => (a ?? "") < (b ?? "") ? -1 : (a ?? "") > (b ?? "") ? 1 : 0,
    formatter: (c) => { const v = c.getValue(); if (!v) return "";
      const el = document.createElement("time"); el.dateTime = v; el.title = v;
      el.textContent = fmt.format(new Date(v)); return el; } },
  { title: "Versions", field: "versions", visible: false, accessorDownload: (v) => v ? JSON.stringify(v) : "" },
];
function render({ rows, errors }) {
  if (rows.length) state.data = rows; // one failure must never blank the table
  const data = rows.length ? rows : state.data;
  if (state.oldest) state.lastUpdated = state.oldest;
  const stale = errors.length > 0 || (state.lastUpdated !== null && Date.now() - state.lastUpdated > STALE_MS);
  const banner = $("#banner");
  if (errors.length) {
    banner.textContent = `${errors.length} source${errors.length === 1 ? "" : "s"} failed — showing partial data. First: ${errors[0]?.path ?? "unknown"} (${errors[0]?.message ?? "error"})`;
    banner.hidden = false;
  } else if (!state.fallback) banner.hidden = true;
  $("#stale").hidden = !stale;
  $("#freshness").textContent = state.lastUpdated
    ? `Last updated ${fmt.format(new Date(state.lastUpdated))}${stale ? " — stale" : ""}`
    : "No successful fetch yet";
  $("#freshness").title = state.lastUpdated ? new Date(state.lastUpdated).toISOString() : "";
  $("#empty").hidden = data.length > 0;
  $("#skeleton").hidden = true;
  if (state.fallback) return renderFallback(data);
  if (!state.table) {
    state.table = new Tabulator("#grid", {
      data, layout: "fitColumns", responsiveLayout: "hide",
      pagination: "local", paginationSize: 50, paginationSizeSelector: [25, 50, 100, true],
      paginationCounter: "rows", initialSort: [{ column: "created_on", dir: "desc" }],
      keybindings: true, groupBy: $("#group").value, columns: COLUMNS,
    });
    document.querySelectorAll("#cols input").forEach((cb) => {
      const col = state.table.getColumn(cb.value);
      if (col && col.isVisible() !== cb.checked) state.table.toggleColumn(cb.value);
    });
  } else state.table.replaceData(data);
}
function renderFallback(data) { // CDN blocked / CSP failure: data stays usable
  const grid = $("#grid"); grid.textContent = "";
  const t = document.createElement("table"); t.className = "fallback";
  const fields = COLUMNS.filter((c) => c.field !== "versions").map((c) => [c.field, c.title]);
  const hr = t.createTHead().insertRow();
  for (const [, title] of fields) { const th = document.createElement("th"); th.scope = "col"; th.textContent = title; hr.append(th); }
  const tb = t.createTBody();
  for (const r of data) {
    const tr = tb.insertRow();
    for (const [f] of fields) {
      const td = tr.insertCell(); const v = r[f];
      if (f === "url" && v) { const a = document.createElement("a"); a.href = v; a.target = "_blank"; a.rel = "noopener"; a.textContent = v; td.append(a); }
      else td.textContent = v == null ? "" : String(v);
    }
  }
  grid.append(t);
}
function downloadFallback(kind) {
  const rows = state.table ? state.table.getData("active") : state.data;
  let text, mime;
  if (kind === "json") { text = JSON.stringify(rows, null, 2); mime = "application/json"; }
  else {
    const cols = COLUMNS.map((c) => c.field);
    const esc = (v) => { const s = v == null ? "" : (typeof v === "object" ? JSON.stringify(v) : String(v));
      return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; };
    text = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
    mime = "text/csv";
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = `deployglass.${kind}`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function refresh() {
  if (state.refreshing) return;
  state.refreshing = true; state.budget = 0; state.budgetHit = false;
  $("#grid").setAttribute("aria-busy", "true");
  $("#refresh").setAttribute("aria-busy", "true");
  try { render(await collect()); }
  catch (e) { render({ rows: [], errors: [e] }); }
  finally {
    state.refreshing = false; state.firstLoad = false;
    $("#grid").setAttribute("aria-busy", "false");
    $("#refresh").removeAttribute("aria-busy");
    if (state.budgetHit) {
      $("#auto").checked = false; clearInterval(state.autoTimer);
      const b = $("#banner");
      b.textContent = `Fan-out cap (${MAX_FANOUT} requests/refresh) reached — auto-refresh disabled. Narrow ACCOUNT_IDS or refresh manually.`;
      b.hidden = false;
    }
  }
}
// ---- controls & a11y wiring ----
$("#refresh").addEventListener("click", refresh);
$("#auto").addEventListener("change", (e) => {
  clearInterval(state.autoTimer);
  if (e.target.checked) state.autoTimer = setInterval(() => { if (!document.hidden) refresh(); }, AUTO_MS);
});
const themeBtn = $("#theme-toggle");
const syncTheme = () => themeBtn.setAttribute("aria-pressed", String(document.documentElement.dataset.theme === "dark"));
themeBtn.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("deployglass-theme", next); } catch { /* storage blocked */ }
  syncTheme();
});
syncTheme();
$("#group").addEventListener("change", (e) => state.table?.setGroupBy(e.target.value));
document.querySelectorAll("#cols input").forEach((cb) =>
  cb.addEventListener("change", () => state.table?.toggleColumn(cb.value)));
$("#csv").addEventListener("click", () => state.table ? state.table.download("csv", "deployglass.csv") : downloadFallback("csv"));
$("#json").addEventListener("click", () => state.table ? state.table.download("json", "deployglass.json") : downloadFallback("json"));
if (typeof window.Tabulator === "undefined") {
  state.fallback = true;
  $("#banner").textContent = "Table library failed to load (CDN/CSP). Rendering a plain table; run `npm run vendor` to self-host assets.";
  $("#banner").hidden = false;
  $("#group").disabled = true;
  document.querySelectorAll("#cols input").forEach((cb) => { cb.disabled = true; });
}
refresh();
