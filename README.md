# Deployglass

One pane of glass for every Cloudflare Pages deployment and every Workers deployment, across every account you monitor. Read-only. Single page. No framework build step.

| | |
|---|---|
| Document ID | `01a204a8-de2c-7efd-8c2c-474a741826eb` (UUID v7, RFC 9562) |
| Generated | `2026-11-22T19:08:25.516Z` (unix_ms `1795374505516`) |
| Platform facts verified | 2026-11-22 against live Cloudflare docs, npm registry, and CDN bytes |
| Status | v0.1.0 — implementation per milestones M0–M4; `(verify)` = label unconfirmed, `runtime-required` = needs a live check |
| Former working title | Deployment Radar |
| License | MIT (add `LICENSE` at M0) |

```
deployment-radar/
├─ public/
│  ├─ index.html          # semantic Pico markup, CDN tags + SRI, no inline JS/CSS
│  ├─ theme-init.js       # pre-paint theme (external → CSP needs no nonces)
│  ├─ app.js              # ES module: fetch → paginate → normalize → Tabulator
│  ├─ styles.css          # Pico↔Tabulator theme bridge, skeletons, focus, reduced-motion
│  └─ _headers            # security headers for static assets (full listing §7)
├─ functions/api/[[path]].js   # catch-all read-only proxy (doc-verified [[path]] routing)
├─ scripts/smoke.mjs      # Playwright + fetch smoke tests (§9)
├─ .dev.vars.example      # placeholders only
└─ .gitignore             # .dev.vars, node_modules
```
---

## 1. What it does

- Lists **all** Pages deployments (production + preview, full history) and **all** Workers deployments (active + historical, version splits with traffic percentages) in one grid.
- Multi-account via one read-only API token; accounts iterated from `GET /accounts`, filtered to `ACCOUNT_IDS`.
- Browser never calls `api.cloudflare.com` and never sees the token: a same-origin Pages Function proxies seven allowlisted GET routes.
- Tabulator 6.7.1 grid: local pagination, multi-column sort, header filters, column visibility, responsive hiding, group-by, CSV/JSON export. Pico 2.1.1 semantic base, light default, persisted dark toggle.
- Resilience: jittered exponential backoff on 429/5xx, per-project partial-failure banner (one failure never blanks the table), `last_updated` + stale badge, 60 s edge cache, manual + optional 60 s auto-refresh.

## 2. Architecture

```
Browser (SPA, no token) ──GET /api/*──► Pages Function /functions/api/[[path]].js
                                        │ GET-only allowlist, regex-validated ids,
                                        │ account_id ∈ ACCOUNT_IDS, query clamp,
                                        │ 60s Cache API, backoff+jitter, ≤6 concurrent
                                        ▼
                          https://api.cloudflare.com/client/v4
                          Authorization: Bearer env.CLOUDFLARE_API_TOKEN (encrypted secret, server-side only)
```

## 3. Prerequisites

| Requirement | Notes |
|---|---|
| Cloudflare account, Free tier | Workers/Pages need no zone/domain |
| Node.js 22+ | Wrangler supports Current/Active/Maintenance Node lines ([docs](https://developers.cloudflare.com/workers/wrangler/install-and-update/)); Node 20 reached EOL 2026-04-30 |
| Wrangler via `npx` | No global install needed |
| Evergreen browser | CSP uses `style-src-attr`; no legacy browsers |
| GitHub/GitLab account | **Optional** — only if your monitored Pages projects use Git integration |
| Zero Trust (Free) | **Optional** — to gate the app for teams (§5.10) |

## 4. Quick start

```bash
git clone https://github.com/<you>/deployglass.git && cd deployglass
cp .dev.vars.example .dev.vars        # paste real token + account id locally; never commit
npx wrangler pages dev public         # http://127.0.0.1:8788 (compiles ./functions)
npx wrangler pages deploy public --project-name=deployglass
```

```
deployglass/
├─ public/            index.html · theme-init.js · app.js · styles.css · _headers
├─ functions/api/[[path]].js   read-only proxy (catch-all routing per Pages docs)
├─ scripts/smoke.mjs  Playwright + fetch smoke tests
├─ .dev.vars.example  placeholders only
└─ LICENSE
```

## 5. Accounts & providers

### 5.1 Cloudflare — sign up
1. `https://dash.cloudflare.com/sign-up` → email + password → **Sign up**.
2. Click the verification link in the email (check spam; resend from the verification screen if missing).
3. Onboarding: skip the domain step (skip/"add later" label `(verify)`). No zone is required; the account is Free tier. If a plan chooser appears later when adding a domain, pick **Free** `(verify)`.

### 5.2 Cloudflare — sign in + 2FA
1. `https://dash.cloudflare.com/login` → email + password (+ 2FA code once enabled).
2. Enable 2FA: **My Profile** dropdown → **My Profile** → **Authentication** → **Two-Factor Authentication** card → **Add** (**Manage** if already configured); enroll TOTP/security key; store recovery codes ([docs](https://developers.cloudflare.com/learning-paths/application-security/account-security/set-up-2fa/)).

### 5.3 Cloudflare — navigation map (labels as of 2026-11-22)

| Destination | Path | What you find |
|---|---|---|
| Workers & Pages overview | Sidebar **Compute (Workers)** → **Workers & Pages** (older layouts show "Workers & Pages" directly) | Pages projects, Workers scripts, **Account Details** panel |
| Pages project deployments | Workers & Pages → project → **Deployments** `(verify)` | Per-deployment env, status, URL, commit |
| Worker deployments | Workers & Pages → Worker → **Deployments** ([docs](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/)) | Active deployment, version splits, rollback |
| Project secrets/variables | Project → **Settings** → **Variables and Secrets** (formerly "Environment variables") | Production/Preview selector, **Add**, **Encrypt**, **Save** |
| API tokens | **My Profile** → **API Tokens** (`https://dash.cloudflare.com/profile/api-tokens`) | Create/roll/delete tokens |
| 2FA | **My Profile** → **Authentication** | TOTP, keys, recovery codes |
| Account home | `https://dash.cloudflare.com` → account selector | Search (`CMD/CTRL+K`) → `Copy account ID` |

### 5.4 Provision: read-only API token
`https://dash.cloudflare.com/profile/api-tokens` → **Create Token** → **Custom token** → **Get started** → name `deployglass-read` → add exactly:

| Scope | Permission | Access | Grants |
|---|---|---|---|
| Account | Cloudflare Pages | Read | List projects + deployments |
| Account | Workers Scripts | Read | List scripts, deployments, subdomain |
| Account | Account Settings | Read | `GET /accounts` iteration |

**Account Resources** = `Include` → each monitored account. **Continue to summary** → **Create Token** → **copy the secret immediately (shown once)**. Verify:

```bash
curl -s https://api.cloudflare.com/client/v4/user/tokens/verify \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
# expect: {"result":{"id":"…","status":"active"},"success":true,
#          "messages":[{"code":10000,"message":"This API Token is valid and active"}]}
```

Rotation: roll/recreate → update the Pages secret in **Production and Preview** → redeploy → delete old token. Deploying this app itself needs a *separate* token with Cloudflare Pages **Edit**; never store that one in the app.

### 5.5 Provision: Pages project + credentials
1. Create the project: `npx wrangler pages project create deployglass` (prompts: name, production branch). Dashboard alternatives: **Create application** → **Get started** → **Drag and drop your files** (Direct Upload) or **Create application** → **Pages** → **Connect to Git** ([docs](https://developers.cloudflare.com/pages/get-started/direct-upload/)). **Drag-and-drop does not compile `/functions` — deploy with Wrangler.**
2. Project → **Settings** → **Variables and Secrets** → **Add**:
   - `CLOUDFLARE_API_TOKEN` = token → **Encrypt** → **Save** (Production).
   - `CLOUDFLARE_ACCOUNT_ID` = 32-hex id (or `ACCOUNT_IDS` = comma-separated ids), plaintext → **Save** (Production).
   - Switch the environment selector to **Preview**; repeat both.
3. **Redeploy after any change** — bindings apply to new deployments only ([docs](https://developers.cloudflare.com/pages/functions/bindings/)).

### 5.6 Multiple accounts
- Token: edit it at `profile/api-tokens` (⋯ → **Edit** `(verify)`) → Account Resources → `Include` → add each account.
- App: set `ACCOUNT_IDS="id1,id2,…"` (overrides `CLOUDFLARE_ACCOUNT_ID`) in both environments; redeploy.
- The proxy iterates `GET /accounts` (`per_page` max 50) and rejects any `account_id` not in the list — the allowlist is enforced server-side, not in the UI.

### 5.7 Locate anything (accounts & providers)

| Information | Where | Format / notes |
|---|---|---|
| Account ID | Account home → Search (`CMD/CTRL+K`) → `Copy account ID`; or Workers & Pages → **Account Details**; or dashboard URL segment | 32-char hex ([docs](https://developers.cloudflare.com/fundamentals/setup/find-account-and-zone-ids/)) |
| Token secret | Shown once at creation; otherwise roll | Never retrievable later |
| Token health | `GET /user/tokens/verify` | `active / disabled / expired` |
| Pages project name | Overview; project settings; `<name>.pages.dev` | Lowercase alnum + hyphens, starts alnum |
| Pages deployment ID / URL / commit | In-app row (Deployment, URL, Commit columns); dashboard project → Deployments `(verify)` | `deployment_trigger.metadata{branch, commit_hash, commit_message}` |
| Workers script name | Overview → Workers; in-app Project/Script column | Script `id` |
| workers.dev subdomain | Workers & Pages overview right rail (**Subdomain**); API `GET /accounts/{id}/workers/subdomain` → `result.subdomain` | URL valid only if the script's workers.dev route is enabled (runtime-required) |
| Workers version IDs / traffic % | In-app Versions/Env columns; Worker → **Deployments** | First deployment in API list = actively serving |
| Secrets/variables per env | Project → Settings → Variables and Secrets → Production/Preview | Secrets unreadable after save |
| Git repo behind a Pages project | Project → Settings → Build `(verify)`; GitHub/GitLab repo settings | Direct Upload projects have no repo |
| Commit/branch provenance | GitHub: repo → commits / Actions run; GitLab: repo → CI/CD → Pipelines | `ad_hoc`/`deploy_hook` Pages deploys carry no git metadata → nulls |
| Pinned library ground truth | `https://registry.npmjs.org/@picocss/pico/latest`, `https://registry.npmjs.org/tabulator-tables/latest` | Verified 2.1.1 / 6.7.1 on 2026-11-22 |
| CDN bytes + SRI | jsDelivr URLs (§5.9) | Recompute with `openssl` before any version bump |
| Zero Trust / Access config | `https://one.dash.cloudflare.com` | Separate dashboard from `dash.cloudflare.com` |

### 5.8 Git providers (optional — Git-connected Pages only)
- **GitHub**: sign up `https://github.com/signup`, sign in `https://github.com/login`. In Cloudflare: **Create application** → **Pages** → **Connect to Git** → authorize the Cloudflare GitHub App on the account/repo ([docs](https://developers.cloudflare.com/pages/get-started/git-integration/)). Pushes then appear as `github:push` deployments with branch/commit metadata.
- **GitLab**: sign up `https://gitlab.com/users/sign_up`, sign in `https://gitlab.com/users/sign_in`; same **Connect to Git** flow ([docs](https://developers.cloudflare.com/pages/configuration/git-integration/gitlab-integration/)).
- Deployglass itself needs **no** Git-provider credentials; it reads the metadata Cloudflare already stores.

### 5.9 Asset providers (npm → jsDelivr), pinned 2026-11-22

| Asset | URL | integrity (sha384, computed from fetched bytes) |
|---|---|---|
| Pico 2.1.1 | `https://cdn.jsdelivr.net/npm/@picocss/pico@2.1.1/css/pico.min.css` | `sha384-L1dWfspMTHU/ApYnFiMz2QID/PlP1xCW9visvBdbEkOLkSSWsP6ZJWhPw6apiXxU` |
| Tabulator 6.7.1 CSS | `https://cdn.jsdelivr.net/npm/tabulator-tables@6.7.1/dist/css/tabulator.min.css` | `sha384-xnEc77Tm0GtDMa5SK6wMci55eU0E+KodAqTli8SS1h1yHo/bRbtEZ+gTgwCEs3d6` |
| Tabulator 6.7.1 JS | `https://cdn.jsdelivr.net/npm/tabulator-tables@6.7.1/dist/js/tabulator.min.js` | `sha384-1M1aGyKpzLZTYIWClgDVwtSkPjR2lvQIkbhZvQ3A3VPKhU2H6EjeXeCBEmyXluer` |

Pico upstream is marked "no longer maintained" (picocss.com, observed 2026-11-22) → self-host fallback:

```bash
mkdir -p public/vendor   # download the three pinned URLs into public/vendor/, then verify:
for f in public/vendor/*; do echo "$f sha384-$(openssl dgst -sha384 -binary "$f" | openssl base64 -A)"; done
# hashes must match the table; switch tags to /vendor/* and CSP origins to 'self'
```

### 5.10 Optional: gate the app with Cloudflare Access (teams)
1. `https://one.dash.cloudflare.com` → **Access** → **Applications** → **Add an application** → **Self-hosted**.
2. Application domain: `deployglass.pages.dev` (and custom domain if any); policy: allow your IdP emails/groups.
3. **Verified caveat:** the Cache API is unavailable behind Access ([docs](https://developers.cloudflare.com/workers/runtime-apis/cache/)) — the proxy degrades to uncached; re-check rate math (§9).

## 6. Configuration

| Name | Type | Where set | Value |
|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Encrypted secret | Dashboard Production **and** Preview; locally `.dev.vars` | Read-only token (§5.4) |
| `CLOUDFLARE_ACCOUNT_ID` | Env var | Same | One 32-hex account id |
| `ACCOUNT_IDS` | Env var (optional) | Same | Comma-separated ids; overrides the single id |

```bash
# .dev.vars.example — placeholders only; real .dev.vars is gitignored
CLOUDFLARE_API_TOKEN="replace-with-read-only-token"
CLOUDFLARE_ACCOUNT_ID="replace-with-32-hex-account-id"
# ACCOUNT_IDS="id1,id2"
```

Never in client code, `localStorage`, or the repo. The smoke test scans every response and bundle for the secret.

## 7. Run & deploy

| Action | Command | Expected |
|---|---|---|
| Local dev | `npx wrangler pages dev public` | Serves `http://127.0.0.1:8788`; `curl -s http://127.0.0.1:8788/api/accounts \| jq .success` → `true` |
| Production deploy | `npx wrangler pages deploy public --project-name=deployglass` | Deployment URL on `https://deployglass.pages.dev` |
| Preview deploy | `npx wrangler pages deploy public --project-name=deployglass --branch=staging` | `https://staging.deployglass.pages.dev` |
| Wrangler auth | `npx wrangler login` (or a separate Pages-Edit token in env) | Deploy succeeds; runtime token stays Read-only |

## 8. Using the app

| Action | How |
|---|---|
| Sort | Click header; **ctrl/shift-click** for multi-column ([Tabulator docs](https://tabulator.info/docs/6.3/sort)) |
| Filter | Header filter inputs; Source/Status lists |
| Group | Group-by select: `source` or `project` |
| Columns | Column checkboxes; responsive auto-hiding on narrow screens |
| Paginate | 25 / 50 / 100 / all, local |
| Export | CSV / JSON buttons (built-in, filtered+sorted view; hidden Versions column included via accessor) |
| Refresh | Manual button; optional 60 s auto-refresh switch |
| Theme | Toggle persists (`localStorage`); saved choice overrides OS preference; light default |
| Timestamps | Viewer locale/timezone; hover for ISO-8601 |
| Freshness | `last_updated` line; **STALE** badge when >90 s old or any source failed |
| Failures | Alert banner with count; remaining rows stay rendered |
| Keyboard | Skip-link, visible focus, ARIA toggle/switch, Tabulator keybindings (arrow-nav: runtime-required) |

## 9. Data & API

Unified row: `{source, account_id, project, deployment_id, environment, status, branch, commit_hash, commit_message, url, author, created_on, versions}`.
Pages: `status ← latest_stage.status`, git ← `deployment_trigger.metadata`, `environment ∈ {production, preview}`. Workers: first deployment = `production` (doc-stated), `versions.length > 1` → `version-split` with percentages, older → `inactive`; `author ← author_email`; branch/commit null unless metadata exists.

| GET endpoint | Permission | Pagination |
|---|---|---|
| [`/user/tokens/verify`](https://developers.cloudflare.com/api/resources/user/subresources/tokens/methods/verify/) | any valid token | — |
| [`/accounts`](https://developers.cloudflare.com/api/resources/accounts/methods/list/) | Account Settings Read | `per_page` ≤ 50 |
| [`/accounts/{id}/pages/projects`](https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/list/) | Cloudflare Pages Read | `page`/`per_page` (max undocumented; we use 25) |
| [`/accounts/{id}/pages/projects/{name}/deployments`](https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/deployments/methods/list/) | Cloudflare Pages Read | same; optional `env` |
| [`/accounts/{id}/workers/scripts`](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/list/) | Workers Scripts Read | none (full array) |
| [`/accounts/{id}/workers/scripts/{name}/deployments`](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/list/) | Workers Scripts Read | `per_page` ≤ 100; `since`/`until` |
| [`/accounts/{id}/workers/subdomain`](https://developers.cloudflare.com/api/resources/workers/subresources/subdomains/methods/get/) | Workers Scripts Read | — |

Budget: global limit **1,200 req / 5 min per user** ([docs](https://developers.cloudflare.com/fundamentals/api/reference/limits/)). Fan-out ≈ `1 + ceil(P/25) + Σ deployment-pages + 1 + 1 + S` per account; cap **150 logical requests/refresh** (auto-refresh disables above cap). 60 s Cache API TTL per colo; ≤3 retries, full jitter `min(8000, 500·2^n)·random()`, honors `Retry-After`; upstream concurrency ≤6, client pool 4.

## 10. Security model

- Read-only token, three permissions, account-scoped; encrypted secret server-side only; proxy rejects non-GET, unknown routes, unlisted accounts/params; ids regex-validated before forwarding.
- All viewers of the app see everything the token sees → **use Access (§5.10) for teams**.
- `_headers` covers static assets only (doc-verified); the Function sets its own `nosniff`/CSP/`no-store`. No inline scripts/styles exist → no nonces needed; `style-src-attr 'unsafe-inline'` is scoped to Tabulator's style-attribute writes.

```text
/*
  Content-Security-Policy: default-src 'none'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' https://cdn.jsdelivr.net; style-src-attr 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
```

## 11. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `401` code `1000` "Invalid API Token" | Truncated/rolled/expired secret | Re-copy or roll; update both envs; redeploy |
| `403` code `9109` "Unauthorized to access requested resource" | Missing permission or account not in token resources | Add exact Read permission / include account; re-verify |
| `success:true` but empty lists | Wrong account id | Re-copy id (§5.7); check `ACCOUNT_IDS` |
| Browser CORS error to `api.cloudflare.com` | Client bypassed proxy | All fetches are `/api/*`; CSP `connect-src 'self'` fails bypasses loudly |
| `429` | >1,200 req/5 min cumulative | Backoff built in; lower fan-out; lengthen refresh; rely on cache |
| CDN asset blocked | CSP origin or SRI mismatch | Fix `_headers`; re-verify hashes; or self-host (§5.9) |
| Proxy 500 "missing token" | Secret saved only in Production, or no redeploy | Set both envs; redeploy |
| Functions 404 after dashboard upload | Drag-and-drop doesn't compile `/functions` | Deploy with Wrangler |

## 12. Tests

```bash
npm i -D playwright && npx playwright install chromium
BASE_URL=http://127.0.0.1:8788 node scripts/smoke.mjs
```

Asserts: proxy 200 · token absent from all responses/bundles · Pages **and** Workers rows · theme persists · >50 rows paginate (fixture) · forced single-project 502 still renders banner + other rows · CSP/nosniff/Referrer/Permissions headers.

## 13. Known limitations

- Read-only by design: no rollbacks, deletes, or log retrieval.
- Per-isolate rate budgeting is best-effort (no cross-isolate counter without Durable Objects).
- Pages list `per_page` maximum is undocumented; 25 used conservatively.
- Workers URL assumes the script's workers.dev route is enabled (runtime-required).
- Tabulator `headerFilter`/keybinding specifics: runtime-required checks.
- Pico upstream unmaintained; pinned 2.1.1 + self-host fallback.
- Behind Access, edge caching is unavailable (verified) → higher upstream usage.
- Workers versions are retained 30 days / 100 most recent; deployment history persists but may reference deleted versions ([docs](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/)).

## 14. Roadmap

All items **planned**, not implemented. No dates promised.

| Phase | Feature | Notes / dependency |
|---|---|---|
| Next | Trigger-type + build-stage columns | Data already in Pages payload (`deployment_trigger.type`, `stages[]`) |
| Next | Server-side date window | Workers deployments `since`/`until` (verified params) |
| Next | Pages env filter toggle | `env=production\|preview` (verified param) |
| Next | Saved views + shareable URL state | localStorage + query string |
| Next | Self-hosted vendor bundle by default | Pico maintenance status |
| Later | Deployment detail drawer | Pages `stages[]` timeline; Workers version metadata (endpoint verify at implementation) |
| Later | Rollback assist | App emits copy-paste wrangler/dashboard steps; stays read-only |
| Later | Fleet summary cards | Failures, oldest prod deploy, active splits per account |
| Later | ETag/delta polling | Cache API honors `ETag`/`If-None-Match` (verified) |
| Later | Project tags/notes | KV binding; new permission surface → design review |
| Later | Scheduled digest (email/Slack) | Separate cron Worker; not in the SPA |
| Exploring | Access roles, per-account visibility | Zero Trust groups |
| Exploring | Other providers (Netlify/Vercel/Fly) via adapter interface | No commitment; Cloudflare-first |
| Exploring | i18n + printable report | Tabulator locales; print CSS |

## 15. Use cases & scenarios

### Solo developer / indie
| Scenario | How Deployglass serves it |
|---|---|
| Inventory every side project before a cleanup weekend | Group by project; CSV export |
| "Did my push actually deploy?" | Filter project, sort Created desc, Status = success |
| Which branch is live on production? | Env = production row → Branch column |
| Find the last good deploy after a bad release | Status filter → copy deployment ID → roll back via dashboard/wrangler (app read-only) |
| Recover a forgotten workers.dev URL | URL column via subdomain lookup |
| Watch a 50/50 canary | Env = version-split with percentages |
| Night-ops readability | Persisted dark theme, Pico-bridged table |

### Agency / consultancy (multi-client)
| Scenario | How |
|---|---|
| One grid across client accounts | `ACCOUNT_IDS` + token Include per account |
| Onboard a new client account | Edit token resources → append id → redeploy (§5.6) |
| Monthly client deploy report | Group by account/project → CSV |
| Catch a client's failed build before they email | Status = failure header filter |
| Verify staging matches prod commit | Compare Commit across preview/production rows |
| Engineer handoff | One Access-gated URL shows the whole estate |
| Scope tracking | Project/script counts per account in one view |

### Platform / SRE
| Scenario | How |
|---|---|
| Incident triage: "what changed in the last hour?" | Sort Created; locale timestamps + ISO tooltips |
| Reconstruct a cross-account deploy timeline | JSON export ordered by `created_on` |
| Confirm a rollback took effect | New Workers deployment appears first/active |
| Deploy-freeze audit | Created-window scan (server-side window: roadmap) |
| Fleet-wide failed-deployment sweep | Status filter across all accounts |
| Find stale/abandoned projects | Oldest Created per project group |
| Monitor 100+ projects without burning quota | Fan-out cap + 60 s cache + jittered backoff |
| Validate token rotation | `tokens/verify` status + banner behavior |

### Security / compliance
| Scenario | How |
|---|---|
| Change-management evidence (SOC 2 / ISO 27001) | Export IDs, authors, timestamps as CSV/JSON |
| Attribute Workers changes | Author column (`author_email`) |
| Spot out-of-band deploys (`ad_hoc`, `deploy_hook`) | Trigger-type column (roadmap; data already fetched) |
| Shadow-IT discovery | Unknown projects/scripts surface in the grid |
| Least-privilege proof | Token is Read-only, three permissions, account-scoped |
| Internal-only exposure | Cloudflare Access gate (§5.10) |
| Supply-chain audit of the dashboard itself | Pinned versions + SRI + self-host fallback (§5.9) |

### Support / on-call
| Scenario | How |
|---|---|
| "Site broke after lunch" | Locale-time Created scan → open deployment URL to reproduce |
| Ticket attachment | Copy deployment ID + URL + commit from the row |
| Shift handoff | Freshness badge shows data age at a glance |
| Cloudflare API degradation | Last-good rows + partial-failure banner keep context |
| Distributed team | Viewer-locale rendering, ISO-8601 tooltips for precision |

### Release / QA
| Scenario | How |
|---|---|
| PR preview verification | Env = preview + Branch filter |
| Release train: did N projects ship together? | Group by project; Created window |
| Gradual-rollout sign-off | Percentages in Env/Versions |
| Feed release-notes tooling | JSON export |
| Long histories | Local pagination keeps sort/filter across >50 rows |

### Finance / ops
| Scenario | How |
|---|---|
| Cost-allocation inventory | CSV of projects/scripts per account |
| Duplicate/abandoned project cleanup list | Group + oldest-Created sort |
| Asset/license review | Pinned CDN table with hashes |

### Resilience & edge scenarios
| Scenario | How |
|---|---|
| 429 mid-refresh | Jittered backoff honors `Retry-After`; table never blanks |
| One project returns 502 | Error-count banner; all other rows render |
| Token expires mid-session | Normalized error banner; verify runbook (§5.4) |
| Dark NOC wall display | Persisted dark theme; text status badges (never color-only) |
| Keyboard-only operation | Skip-link, focus rings, ARIA controls, grid keybindings |
| Corporate proxy blocks CDNs | Self-host `/vendor` + CSP `'self'` (§5.9) |
| New account added mid-incident | Token resources + `ACCOUNT_IDS` + redeploy (§5.6) |
| Multi-tab dashboards | 60 s edge cache dedupes upstream calls per colo |

## 16. Verification log

<details>
<summary>Sources checked 2026-11-22</summary>

- API endpoints/pagination/fields: the seven endpoint docs linked in §9 (Workers deployments doc states the first item is actively serving; `per_page` max 100; `versions[].percentage`, `author_email`, `annotations`).
- Token permission names: https://developers.cloudflare.com/fundamentals/api/reference/permissions/ and https://developers.cloudflare.com/pages/configuration/api/
- Rate limit: https://developers.cloudflare.com/fundamentals/api/reference/limits/
- Secrets/variables UI + `.dev.vars` + redeploy rule: https://developers.cloudflare.com/pages/functions/bindings/
- Token creation flow: https://developers.cloudflare.com/fundamentals/api/get-started/create-token/ and https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/
- 2FA: https://developers.cloudflare.com/fundamentals/user-profiles/2fa/
- Account ID: https://developers.cloudflare.com/fundamentals/setup/find-account-and-zone-ids/
- Direct Upload + Functions caveat: https://developers.cloudflare.com/pages/get-started/direct-upload/
- Git integration: https://developers.cloudflare.com/pages/get-started/git-integration/ , https://developers.cloudflare.com/pages/configuration/git-integration/gitlab-integration/
- `_headers` static-only scope: https://developers.cloudflare.com/pages/configuration/headers/
- Cache API (Access caveat, ETag, per-colo): https://developers.cloudflare.com/workers/runtime-apis/cache/
- Versions & deployments retention: https://developers.cloudflare.com/workers/configuration/versions-and-deployments/
- Wrangler Node support: https://developers.cloudflare.com/workers/wrangler/install-and-update/
- Versions/SRI: npm registry `latest` endpoints; sha384 computed from jsDelivr bytes on 2026-11-22.
- Sidebar "Compute (Workers)" grouping: observed in 2026 third-party guides; Cloudflare docs still label the inner page "Workers & Pages".
- Zero Trust dashboard + Access app labels: https://one.dash.cloudflare.com ; guides confirmed "Access → Applications → Add an application → Self-hosted" (e.g., https://support.hudu.com/hc/en-us/articles/35534775038615 ).
- Error codes 1000/9109: Cloudflare community reports (2026) and API error schema.
- Name collision search 2026-11-22: no product named "Deployglass" found; "FleetPane" and "Shipglass" are in use. Not a trademark clearance.

</details>

## License

MIT.
