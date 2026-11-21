// Self-host pinned CDN assets: download, verify sha384, rewrite index.html + _headers.
// Run: npm run vendor   (idempotent; requires network)
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
const ASSETS = [
  { url: "https://cdn.jsdelivr.net/npm/@picocss/pico@2.1.1/css/pico.min.css", file: "pico.min.css",
    sri: "sha384-L1dWfspMTHU/ApYnFiMz2QID/PlP1xCW9visvBdbEkOLkSSWsP6ZJWhPw6apiXxU" },
  { url: "https://cdn.jsdelivr.net/npm/tabulator-tables@6.7.1/dist/css/tabulator.min.css", file: "tabulator.min.css",
    sri: "sha384-xnEc77Tm0GtDMa5SK6wMci55eU0E+KodAqTli8SS1h1yHo/bRbtEZ+gTgwCEs3d6" },
  { url: "https://cdn.jsdelivr.net/npm/tabulator-tables@6.7.1/dist/js/tabulator.min.js", file: "tabulator.min.js",
    sri: "sha384-1M1aGyKpzLZTYIWClgDVwtSkPjR2lvQIkbhZvQ3A3VPKhU2H6EjeXeCBEmyXluer" },
];
const html = readFileSync("public/index.html", "utf8");
if (html.includes("/vendor/pico.min.css")) { console.log("already vendored — nothing to do"); process.exit(0); }
mkdirSync("public/vendor", { recursive: true });
for (const a of ASSETS) {
  const res = await fetch(a.url);
  if (!res.ok) { console.error(`FAIL download ${a.url} (${res.status})`); process.exit(1); }
  const buf = Buffer.from(await res.arrayBuffer());
  const sri = "sha384-" + createHash("sha384").update(buf).digest("base64");
  if (sri !== a.sri) { console.error(`FAIL integrity ${a.file}\n  got      ${sri}\n  expected ${a.sri}`); process.exit(1); }
  writeFileSync(`public/vendor/${a.file}`, buf);
  console.log(`OK ${a.file} (${buf.length} bytes, integrity verified)`);
}
let out = html;
for (const a of ASSETS) out = out.replaceAll(a.url, `/vendor/${a.file}`);
out = out.replaceAll(' crossorigin="anonymous"', ""); // same-origin: SRI kept, CORS attr dropped
writeFileSync("public/index.html", out);
writeFileSync("public/_headers",
  readFileSync("public/_headers", "utf8").replaceAll(" https://cdn.jsdelivr.net", ""));
console.log("vendored: index.html now uses /vendor/*; CSP origins reduced to 'self'. Redeploy.");
