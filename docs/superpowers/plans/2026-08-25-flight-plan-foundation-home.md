# Flight Plan Facts Foundation and Homepage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zbudować fail-closed rejestr faktów, jeden system wizualny Flight Plan oraz nową stronę główną PL/EN, bez publikowania niepotwierdzonych twierdzeń.

**Architecture:** Najpierw powstają rejestr faktów i walidator Node bez zewnętrznych zależności. Następnie jeden arkusz `assets/css/style.css` przejmuje tokeny, typografię i komponenty, a obie strony główne używają wspólnego kontraktu klas oraz semantycznie równoważnej treści. JavaScript pozostaje progresywnym ulepszeniem: nawigacja, kontakt i treść działają bez niego, a czat nie renderuje danych użytkownika przez `innerHTML`.

**Tech Stack:** statyczny HTML5, CSS, vanilla JavaScript ES modules/runtime browser APIs, Node.js 20+ do walidacji, lokalne WOFF2, Cloudflare Pages bez kroku build.

**Spec:** `docs/superpowers/specs/2026-08-25-mamcarz-platform-redesign-design.md`

## Global Constraints

- Witryna pozostaje statycznym HTML bez frameworka, CMS i obowiązkowego buildu.
- PL i EN są lustrami znaczeniowymi; każda zmiana strony głównej obejmuje `index.html` i `en/index.html` w tym samym zadaniu lub w dwóch kolejnych, zamkniętych taskach.
- Główna obietnica PL: `Od decyzji do działającego systemu.`
- Główna obietnica EN: `From decision to an operational system.`
- Hero zachowuje cztery zatwierdzone display values: `25+`, `20+`, `500M EUR`, `50 mld PLN`; znaczenie każdej wartości musi być zapisane w rejestrze.
- Kolejność home: Hero, Trust Bar, Process, Case Studies, About, Education, Resume, Skills, Portfolio, Clients, Contact.
- CTA występuje po Process i po Case Studies; ghost CTA hero prowadzi do `/case-studies/`.
- Lotnictwo jest jednym z trzech obszarów core, obok doradztwa i aplikacji operacyjnych.
- Polpharma nie jest klientem i nie może wystąpić w Trust Bar, Clients, metadanych, JSON-LD, plikach LLM ani prompcie Workera.
- Nie dodawać logo klientów, nowych portretów ani generowanych obrazów bez osobnej zgody.
- Nie publikować faktu o kliencie, wyniku, liczbie, aktywności, uprawnieniu lub statusie projektu bez `status: "approved"` w `content/site-facts.json`.
- `status: "review"` oznacza blokadę użycia. `status: "retired"` oznacza obowiązek usunięcia ze wszystkich powierzchni.
- Brak dowodu oznacza pominięcie twierdzenia lub opis neutralny. Nie wolno uzupełniać luk prawdopodobnym tekstem.
- Jeden aktywny arkusz: `/assets/css/style.css`. Bez kolejnej warstwy override na końcu pliku.
- Kolory, typografia, siatka i signature element muszą być zgodne ze specyfikacją Flight Plan.
- Bez pushu, merge i deployu w ramach tego planu.

---

## File Responsibility Map

### Create

- `content/site-facts.json` - publicznie bezpieczne źródło zatwierdzonych i odrzuconych faktów.
- `scripts/verify-site.mjs` - bez-zależnościowy walidator, w tym planie uruchamiany ze scope `home`.
- `assets/fonts/barlow-semi-condensed-latin-500-normal.woff2` - display, regular emphasis.
- `assets/fonts/barlow-semi-condensed-latin-ext-500-normal.woff2` - display PL, regular emphasis.
- `assets/fonts/barlow-semi-condensed-latin-600-normal.woff2` - display, headings.
- `assets/fonts/barlow-semi-condensed-latin-ext-600-normal.woff2` - display PL, headings.
- `assets/fonts/barlow-semi-condensed-latin-700-normal.woff2` - display, large metrics.
- `assets/fonts/barlow-semi-condensed-latin-ext-700-normal.woff2` - display PL, large metrics.
- `assets/fonts/OFL-barlow-semi-condensed.txt` - licencja skopiowana z paczki Fontsource 5.3.0.

### Modify

- `package.json` - skrypty `verify:site` i `verify:home`; bez dodawania runtime dependency.
- `assets/css/style.css:1-2878` - pełna konsolidacja starego CSS do jednego systemu Flight Plan.
- `assets/js/main.js:1-235` - null-safe navigation, reduced-motion behavior and safe chat rendering.
- `index.html:1-736` - metadata wstępne, nawigacja i 11 sekcji home PL.
- `en/index.html:1-735` - semantyczny mirror home EN.

### Preserve

- `IMG_3284.jpeg` - nieedytowany master, nadal nieużywany bezpośrednio w HTML.
- `assets/img/IMG_3284-{480,960,1920}.{jpg,webp}` - zatwierdzone pochodne portretu.
- Wszystkie istniejące podstrony - do czasu Planu 2 muszą pozostać czytelne dzięki warstwie kompatybilności w nowym CSS.

## Shared Interfaces

### Fact record

```text
FactRecord = {
  id: string,
  value: string | number,
  display_pl: string,
  display_en: string,
  kind: "constant" | "dated",
  as_of: string | null,
  source_type: "owner_verified" | "public_source" | "internal_evidence",
  source_label: string,
  source_url: string | null,
  surfaces: string[],
  status: "approved" | "review" | "retired"
}
```

### Validator CLI

```text
node scripts/verify-site.mjs --scope=home --lang=pl
node scripts/verify-site.mjs --scope=home --lang=en
node scripts/verify-site.mjs --scope=home --lang=all
npm run verify:facts
npm run verify:foundation
npm run verify:home -- --lang=pl
```

Exit code `0` oznacza brak błędów. Każdy błąd ma format `ERROR <check-id> <path>: <message>` i kończy proces kodem `1`.

### Home section contract

```text
hero → trust → process → process CTA → cases → cases CTA →
about → education → resume → skills → portfolio → clients → contact
```

Sekcje liczone jako wymagane 11 używają identyfikatorów `hero`, `process`, `cases`, `about`, `education`, `resume`, `skills`, `portfolio`, `clients`, `contact`; Trust Bar jest wykrywana przez `data-section="trust"`.

---

### Task 1: Establish the fail-closed fact registry

**Files:**
- Create: `content/site-facts.json`
- Create: `scripts/verify-site.mjs`
- Modify: `package.json:6-8`
- Inspect: `index.html`, `en/index.html`, `llms.txt`, `llms-full.txt`, `worker/index.js`

**Interfaces:**
- Produces: `FactRecord[]` at `content/site-facts.json#facts`.
- Produces: `readFacts(): { facts: FactRecord[]; blocked_claims: BlockedClaim[] }` in `scripts/verify-site.mjs`.
- Produces: independent `verify:facts`, `verify:foundation` and `verify:home` commands so unfinished copy cannot mask CSS/navigation checks.

- [ ] **Step 1: Record the current high-risk claim inventory without editing product copy**

Run:

```bash
rg -n -i 'największ|largest|#1|wiodąc|leading|100\+|12[ .]?8|12,823|220[ .]?000|500 ?m|50 mld|50 bn|20\+|25\+' \
  index.html en/index.html llms.txt llms-full.txt worker/index.js
```

Expected: output includes the four hero figures plus claims such as `100+`, Żabka store count, KGHM rank and superlatives. This output is evidence to classify, not a source proving the claims.

- [ ] **Step 2: Write the initial registry with only the exact brand promise marked approved**

Create this top-level shape and records. The four required number displays are seeded as `review` because their exact semantic labels still require the owner gate in Step 6. All additional existing claims also start as `review`, never `approved` merely because they already occur in the repository.

```json
{
  "version": 1,
  "facts": [
    {
      "id": "brand.promise",
      "value": "decision-to-operational-system",
      "display_pl": "Od decyzji do działającego systemu.",
      "display_en": "From decision to an operational system.",
      "kind": "constant",
      "as_of": null,
      "source_type": "owner_verified",
      "source_label": "Zatwierdzona specyfikacja Flight Plan, 2026-08-25",
      "source_url": null,
      "surfaces": ["index.html", "en/index.html"],
      "status": "approved"
    },
    {
      "id": "hero.experience_years",
      "value": "25+",
      "display_pl": "25+",
      "display_en": "25+",
      "kind": "constant",
      "as_of": null,
      "source_type": "owner_verified",
      "source_label": "Zatwierdzona specyfikacja Flight Plan, 2026-08-25",
      "source_url": null,
      "surfaces": ["index.html", "en/index.html"],
      "status": "review"
    },
    {
      "id": "hero.implementations",
      "value": "20+",
      "display_pl": "20+",
      "display_en": "20+",
      "kind": "constant",
      "as_of": null,
      "source_type": "owner_verified",
      "source_label": "Zatwierdzona specyfikacja Flight Plan, 2026-08-25",
      "source_url": null,
      "surfaces": ["index.html", "en/index.html"],
      "status": "review"
    },
    {
      "id": "hero.project_value_eur",
      "value": "500000000 EUR",
      "display_pl": "500M EUR",
      "display_en": "EUR 500M",
      "kind": "constant",
      "as_of": null,
      "source_type": "owner_verified",
      "source_label": "Zatwierdzona specyfikacja Flight Plan, 2026-08-25",
      "source_url": null,
      "surfaces": ["index.html", "en/index.html"],
      "status": "review"
    },
    {
      "id": "hero.managed_spend_pln",
      "value": "50000000000 PLN",
      "display_pl": "50 mld PLN",
      "display_en": "PLN 50bn",
      "kind": "constant",
      "as_of": null,
      "source_type": "owner_verified",
      "source_label": "Zatwierdzona specyfikacja Flight Plan, 2026-08-25",
      "source_url": null,
      "surfaces": ["index.html", "en/index.html"],
      "status": "review"
    }
  ],
  "blocked_claims": [
    {
      "id": "client.polpharma",
      "pattern": "Polpharma",
      "forbidden_contexts": ["trust", "clients", "client list", "worked for"],
      "reason": "Owner confirmed Polpharma is not a client"
    }
  ]
}
```

Add review records for these exact current claim families: `client.*`, `project.orlen.*`, `project.zabka.*`, `project.kghm.*`, `project.lot.*`, `project.motor_oil.*`, `career.*`, `education.*`, `aviation.*`, `portfolio.*`, `availability.current`. Their source labels must identify the owner-provided CV, named internal evidence or a public URL; `source_label: "existing website"` is not accepted as proof.

- [ ] **Step 3: Write the validator harness**

Create `scripts/verify-site.mjs` with these concrete primitives:

```js
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const scopeArg = process.argv.find((arg) => arg.startsWith("--scope="));
const scope = scopeArg?.split("=")[1] ?? "all";
const langArg = process.argv.find((arg) => arg.startsWith("--lang="));
const lang = langArg?.split("=")[1] ?? "all";
const errors = [];

if (!["all", "pl", "en"].includes(lang)) {
  errors.push(`ERROR cli-lang scripts/verify-site.mjs: unsupported language ${lang}`);
}
if (!["all", "facts", "foundation", "home"].includes(scope)) {
  errors.push(`ERROR cli-scope scripts/verify-site.mjs: unsupported scope ${scope}`);
}

async function read(relativePath) {
  return readFile(resolve(root, relativePath), "utf8");
}

function check(condition, id, path, message) {
  if (!condition) errors.push(`ERROR ${id} ${path}: ${message}`);
}

async function readFacts() {
  let parsed;
  try {
    parsed = JSON.parse(await read("content/site-facts.json"));
  } catch (error) {
    check(false, "facts-json", "content/site-facts.json", error.message);
    return { version: 0, facts: [], blocked_claims: [] };
  }
  check(parsed.version === 1, "facts-version", "content/site-facts.json", "expected version 1");
  check(Array.isArray(parsed.facts), "facts-array", "content/site-facts.json", "facts must be an array");
  return Array.isArray(parsed.facts) ? parsed : { ...parsed, facts: [] };
}

function verifyFactSchema(factData) {
  const required = ["id", "value", "display_pl", "display_en", "kind", "as_of", "source_type", "source_label", "source_url", "surfaces", "status"];
  for (const [index, fact] of factData.facts.entries()) {
    if (!fact || typeof fact !== "object" || Array.isArray(fact)) {
      check(false, "fact-record", "content/site-facts.json", `facts[${index}] must be an object`);
      continue;
    }
    for (const key of required) {
      check(Object.hasOwn(fact, key), "fact-key", "content/site-facts.json", `facts[${index}] missing ${key}`);
    }
  }
}

async function verifyFoundation() {
  const [css, js] = await Promise.all([
    read("assets/css/style.css"),
    read("assets/js/main.js")
  ]);
  check(css.length > 0, "foundation-css", "assets/css/style.css", "stylesheet is empty");
  check(js.length > 0, "foundation-js", "assets/js/main.js", "browser script is empty");
}

function occurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

async function verifyHome(factData) {
  const pages = [
    { path: "index.html", lang: "pl" },
    { path: "en/index.html", lang: "en" }
  ].filter((page) => lang === "all" || page.lang === lang);

  for (const page of pages) {
    const html = await read(page.path);
    check(occurrences(html, "<h1") === 1, "home-h1", page.path, "expected exactly one h1");
    for (const fact of factData.facts.filter((item) => Array.isArray(item?.surfaces) && item.surfaces.includes(page.path))) {
      const display = page.lang === "pl" ? fact.display_pl : fact.display_en;
      if (fact.status === "approved") {
        check(html.includes(display), `fact-${fact.id}`, page.path, `missing approved display: ${display}`);
      } else {
        check(!html.includes(display), `fact-${fact.id}`, page.path, `non-approved fact is still published: ${display}`);
      }
    }
  }
}

const facts = await readFacts();
if (scope === "facts" || scope === "all") await verifyFactSchema(facts);
if (scope === "foundation" || scope === "all") await verifyFoundation();
if (scope === "home" || scope === "all") await verifyHome(facts);

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`OK site verification (${scope})`);
}
```

- [ ] **Step 4: Add deterministic npm commands**

Modify `package.json` scripts to:

```json
{
  "scripts": {
    "optimize:images": "node scripts/optimize-images.js",
    "verify:site": "node scripts/verify-site.mjs --scope=all",
    "verify:facts": "node scripts/verify-site.mjs --scope=facts",
    "verify:foundation": "node scripts/verify-site.mjs --scope=foundation",
    "verify:home": "node scripts/verify-site.mjs --scope=home"
  }
}
```

- [ ] **Step 5: Run the first fail-closed verification**

Run:

```bash
npm run verify:facts
npm run verify:home
```

Expected: fact-schema scope PASSes; home scope FAILs while current pages still publish a `review` or miss an approved display. The failure must name the fact and surface; a JSON parse exception without a check ID is not sufficient.

- [ ] **Step 6: Execute the human fact gate**

Present every record still marked `review` and used by `index.html` or `en/index.html` as a compact table: `id`, proposed PL/EN display, claimed meaning, source label and affected sections. Apply only explicit owner decisions:

- confirmed: change to `approved` and record `owner_verified`, date and exact wording;
- rejected: change to `retired` and remove from both languages;
- unknown: keep `review` and remove from both languages.

Do not mark Task 5 complete while PL references a `review` record, and do not mark Task 6 complete while either language references one. The redesign tasks remove unresolved occurrences rather than requiring them to disappear before the files are edited.

- [ ] **Step 7: Commit the registry and verifier only after their own checks pass**

Run:

```bash
node --check scripts/verify-site.mjs
npm run verify:facts
git diff --check
git add content/site-facts.json scripts/verify-site.mjs package.json package-lock.json
git commit -m "test: add fail-closed site fact verification"
```

Expected: JavaScript syntax PASS; commit includes no HTML, CSS, Worker or deployment files.

---

### Task 2: Add the licensed Flight Plan display font and core tokens

**Files:**
- Create: `assets/fonts/barlow-semi-condensed-*-normal.woff2`
- Create: `assets/fonts/OFL-barlow-semi-condensed.txt`
- Modify: `assets/css/style.css:1-62`
- Modify: `scripts/verify-site.mjs`

**Interfaces:**
- Produces CSS family name: `"Barlow Semi Condensed"` at weights 500, 600 and 700.
- Produces tokens: `--sky-paper`, `--runway-ink`, `--signal`, `--panel`, `--boundary`, `--white`, `--muted`.

- [ ] **Step 1: Extend the verifier with failing font and token checks**

Add to `verifyFoundation()`:

```js
const css = await read("assets/css/style.css");
for (const token of [
  "--sky-paper: #E9EDEF",
  "--runway-ink: #102831",
  "--signal: #D94B2B",
  "--panel: #193D49",
  "--boundary: #8E9CA1",
  "--white: #F7F9F8",
  "--muted: #52707A"
]) {
  check(css.includes(token), "flight-token", "assets/css/style.css", `missing ${token}`);
}
check(css.includes("font-family: 'Barlow Semi Condensed'"), "display-font", "assets/css/style.css", "Barlow face missing");
```

Run `npm run verify:foundation` and expect FAIL on `flight-token` and `display-font`.

- [ ] **Step 2: Acquire the exact font files from a pinned package in a temporary directory**

Run:

```bash
TASK_FONT_DIR=$(mktemp -d /tmp/mamcarz-barlow.XXXXXX)
npm pack @fontsource/barlow-semi-condensed@5.3.0 --pack-destination "$TASK_FONT_DIR"
tar -xzf "$TASK_FONT_DIR/fontsource-barlow-semi-condensed-5.3.0.tgz" -C "$TASK_FONT_DIR"
cp "$TASK_FONT_DIR/package/files/barlow-semi-condensed-latin-500-normal.woff2" assets/fonts/
cp "$TASK_FONT_DIR/package/files/barlow-semi-condensed-latin-ext-500-normal.woff2" assets/fonts/
cp "$TASK_FONT_DIR/package/files/barlow-semi-condensed-latin-600-normal.woff2" assets/fonts/
cp "$TASK_FONT_DIR/package/files/barlow-semi-condensed-latin-ext-600-normal.woff2" assets/fonts/
cp "$TASK_FONT_DIR/package/files/barlow-semi-condensed-latin-700-normal.woff2" assets/fonts/
cp "$TASK_FONT_DIR/package/files/barlow-semi-condensed-latin-ext-700-normal.woff2" assets/fonts/
cp "$TASK_FONT_DIR/package/LICENSE" assets/fonts/OFL-barlow-semi-condensed.txt
```

Expected: six WOFF2 files plus the license. Do not add the Fontsource package to `package.json`.

- [ ] **Step 3: Replace the font-face declarations and root tokens**

Use three weights with latin and latin-ext ranges. The root block begins with:

```css
@font-face {
  font-family: 'Barlow Semi Condensed';
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: url('/assets/fonts/barlow-semi-condensed-latin-500-normal.woff2') format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+20AC;
}

@font-face {
  font-family: 'Barlow Semi Condensed';
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: url('/assets/fonts/barlow-semi-condensed-latin-ext-500-normal.woff2') format('woff2');
  unicode-range: U+0100-024F, U+1E00-1EFF, U+20A0-20AB;
}

:root {
  color-scheme: light;
  --sky-paper: #E9EDEF;
  --runway-ink: #102831;
  --signal: #D94B2B;
  --panel: #193D49;
  --boundary: #8E9CA1;
  --white: #F7F9F8;
  --muted: #52707A;
  --content-max: 1280px;
  --page-gutter: clamp(20px, 4vw, 56px);
  --line: 1px solid color-mix(in srgb, var(--boundary) 58%, transparent);
  --font-display: 'Barlow Semi Condensed', sans-serif;
  --font-body: 'DM Sans', sans-serif;
  --font-mono: 'DM Mono', monospace;
}
```

Repeat the two `@font-face` blocks with exact file names for weights 600 and 700. Retain the existing DM Sans and DM Mono local files.

- [ ] **Step 4: Verify assets and commit**

Run:

```bash
file assets/fonts/barlow-semi-condensed-*-normal.woff2
npm run verify:foundation
git diff --check
git add assets/fonts assets/css/style.css scripts/verify-site.mjs
git commit -m "style: add Flight Plan typography and tokens"
```

Expected: `file` identifies all six as Web Open Font Format; token checks PASS.

---

### Task 3: Consolidate CSS into one coherent Flight Plan system

**Files:**
- Modify: `assets/css/style.css:1-2878`
- Modify: `scripts/verify-site.mjs`

**Interfaces:**
- Produces shared classes: `.site-nav`, `.nav-list`, `.nav-group`, `.section-shell`, `.section-index`, `.route-sequence`, `.evidence-row`, `.status-tag`, `.btn-primary`, `.btn-ghost`, `.site-footer`.
- Preserves compatibility classes needed by unmigrated subpages: `.page-hero`, `.page-hero-content`, `.page-title`, `.page-subtitle`, `.page-content`, `.page-two-col`, `.service-cards`, `.service-card`, `.related-links`, `.related-link`, `.cta-banner`, `.breadcrumb`.

- [ ] **Step 1: Add failing consolidation assertions**

Add:

```js
check((css.match(/:root\s*\{/g) ?? []).length === 1, "css-root", "assets/css/style.css", "expected one :root block");
check(!css.includes("OPERATIONS DOSSIER"), "css-layer", "assets/css/style.css", "old override layer remains");
check(!css.includes("Playfair Display"), "css-playfair", "assets/css/style.css", "Playfair remains active");
check(!css.includes(".hero-plot"), "css-dead-hero", "assets/css/style.css", "decorative plot selectors remain");
```

Run `npm run verify:foundation`; expected FAIL on old layer, Playfair and hero plot.

- [ ] **Step 2: Replace the stylesheet instead of appending overrides**

Rebuild `style.css` in this exact order:

```css
/* 01 Fonts and tokens */
/* 02 Reset and document */
/* 03 Layout primitives */
/* 04 Navigation */
/* 05 Buttons and links */
/* 06 Homepage: hero through contact */
/* 07 Shared subpage compatibility */
/* 08 Chat and footer */
/* 09 Accessibility and reduced motion */
/* 10 Responsive: <=1179, <=759, <=359 */
```

Core layout rules:

```css
*, *::before, *::after { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  overflow-x: clip;
  background: var(--sky-paper);
  color: var(--runway-ink);
  font-family: var(--font-body);
  font-size: 1rem;
  font-weight: 400;
  line-height: 1.65;
}
img { display: block; max-width: 100%; height: auto; }
a { color: inherit; }
.section-shell {
  width: min(100% - (2 * var(--page-gutter)), var(--content-max));
  margin-inline: auto;
}
.section-index,
.status-tag {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
h1, h2, h3 {
  margin: 0;
  font-family: var(--font-display);
  font-weight: 600;
  line-height: 0.98;
  text-wrap: balance;
}
p { max-width: 68ch; }
```

Component rules must use hard boundaries and square/low-radius surfaces. Do not define glass, glow, decorative gradients, generic card shadows or italic display treatments. The route line is implemented only by `.route-sequence` and `.timeline`.

- [ ] **Step 3: Add no-JS and accessible responsive states**

Use progressive enhancement:

```css
@media (max-width: 759px) {
  .nav-list { display: block; }
  .nav-toggle { display: none; }
  .js .nav-list { display: none; }
  .js .nav-toggle { display: inline-flex; }
  .js .nav-list.is-open { display: block; }
}

:focus-visible {
  outline: 3px solid var(--signal);
  outline-offset: 4px;
}

@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

At 320 px: no horizontal scroll, all interactive targets at least 44 px, evidence rows stack in reading order. At 760–1179 px use eight logical columns; at 1180+ use twelve.

- [ ] **Step 4: Keep unmigrated subpages readable**

Implement the compatibility classes listed under Interfaces using the same tokens, font roles and boundaries. They must not preserve Playfair, terracotta editorial styling or inline dependency on old `--gold` aliases. Existing pages may remain content-heavy until Plan 2, but their typography, contrast, nav clearance and CTA must not break.

- [ ] **Step 5: Verify consolidation and commit**

Run:

```bash
npm run verify:foundation
rg -n 'OPERATIONS DOSSIER|Playfair Display|hero-plot|--gold|--bg2|--bg3' assets/css/style.css
git diff --check
git add assets/css/style.css scripts/verify-site.mjs
git commit -m "style: consolidate the Flight Plan design system"
```

Expected: verifier PASS; `rg` returns no matches.

---

### Task 4: Replace homepage navigation and make JavaScript defensive

**Files:**
- Modify: `index.html:100-121`
- Modify: `en/index.html:100-121`
- Modify: `assets/js/main.js:1-235`
- Modify: `scripts/verify-site.mjs`

**Interfaces:**
- Consumes: `.site-nav`, `.nav-list`, `.nav-group` from Task 3.
- Produces DOM IDs: `nav-menu`, `nav-toggle`, `nav-overlay` once per page.
- Produces `initNavigation()`, `initBackToTop()`, `initChat()` as null-safe functions.

- [ ] **Step 1: Add failing nav assertions**

For PL require, in order: `/uslugi/transformacja-zakupow/`, `/aplikacje-operacyjne/`, `/lotnictwo/`, `/case-studies/`, `/wiedza/`, `/#about`, `/#contact`. For EN require the equivalent `/en/...` routes. Check one `details.nav-group`, one `button#nav-toggle` and a language link to the paired homepage.

Run `npm run verify:foundation`; expected FAIL because the old navigation has only five items.

- [ ] **Step 2: Replace PL and EN navigation with accessible markup**

PL advisory group:

```html
<li>
  <details class="nav-group">
    <summary>Doradztwo</summary>
    <ul class="nav-submenu">
      <li><a href="/uslugi/transformacja-zakupow/">Transformacja zakupów</a></li>
      <li><a href="/uslugi/wdrozenie-sap-ariba/">Wdrożenie SAP Ariba</a></li>
      <li><a href="/uslugi/doradztwo-zamowienia-publiczne/">Zamówienia publiczne</a></li>
    </ul>
  </details>
</li>
```

EN uses `Advisory`, `Procurement transformation`, `SAP Ariba implementation` and `Public procurement`, with all three `/en/uslugi/.../` paths. Direct items follow the approved order. `O mnie/About` and `Kontakt/Contact` use absolute localized anchors so they also define the cross-page contract for Plan 2.

- [ ] **Step 3: Rewrite `main.js` as independent null-safe initializers**

Start with:

```js
document.documentElement.classList.add("js");

function initNavigation() {
  const toggle = document.getElementById("nav-toggle");
  const menu = document.getElementById("nav-menu");
  const overlay = document.getElementById("nav-overlay");
  if (!toggle || !menu) return;

  const close = () => {
    menu.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
    overlay?.classList.remove("is-open");
  };

  toggle.addEventListener("click", () => {
    const open = !menu.classList.contains("is-open");
    menu.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    overlay?.classList.toggle("is-open", open);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menu.classList.contains("is-open")) {
      close();
      toggle.focus();
    }
  });
  menu.querySelectorAll("a").forEach((link) => link.addEventListener("click", close));
  overlay?.addEventListener("click", close);
}
```

Call each initializer at file end. Remove scroll reveal and staggered timeline code. Guard every `querySelector` result before dereferencing it.

- [ ] **Step 4: Remove unsafe chat HTML injection while retaining trusted links**

User and model content use `textContent`:

```js
function addChatMessage(text, role) {
  const message = document.createElement("div");
  message.className = `chat-msg chat-msg--${role}`;
  message.textContent = text;
  chatMessages.append(message);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return message;
}
```

Build the static fallback contact link with DOM methods. Do not assign `data.reply`, user input or caught error text to `innerHTML`. Set `maxlength="2000"` in both HTML inputs. Keep the hardcoded Worker URL unchanged.

- [ ] **Step 5: Verify JS syntax, no-JS behavior and commit**

Run:

```bash
node --check assets/js/main.js
npm run verify:foundation
git diff --check
git add index.html en/index.html assets/js/main.js scripts/verify-site.mjs
git commit -m "feat: add accessible Flight Plan navigation"
```

Expected: syntax and verifier PASS. With JavaScript disabled, the full navigation list and mailto links remain visible.

---

### Task 5: Rebuild the Polish homepage around verified evidence

**Files:**
- Modify: `index.html:6-733`
- Modify: `scripts/verify-site.mjs`

**Interfaces:**
- Consumes: only `approved` fact displays from `content/site-facts.json`.
- Produces the 11-section home contract and two mid-page CTA positions.

- [ ] **Step 1: Add failing structural and forbidden-copy checks**

Add ordered marker assertions for:

```js
const markers = [
  'id="hero"',
  'data-section="trust"',
  'id="process"',
  'data-cta-after="process"',
  'id="cases"',
  'data-cta-after="cases"',
  'id="about"',
  'id="education"',
  'id="resume"',
  'id="skills"',
  'id="portfolio"',
  'id="clients"',
  'id="contact"'
];
```

Fail when marker indexes are not strictly increasing. Also reject visible-copy patterns `—`, `nie tylko`, `kompleksow`, `innowacyjn`, `realnie`, `#1`, `największ` and `Polpharma` in the two home bodies. Metadata is audited in Plan 3.

- [ ] **Step 2: Replace hero and Trust Bar**

Use exact hero copy:

```html
<h1>Od decyzji do działającego systemu.</h1>
<p class="hero-lead">Prowadzę transformacje zakupowe, buduję aplikacje operacyjne i rozwijam przedsięwzięcia lotnicze. Odpowiadam za przejście od rozpoznania problemu do rozwiązania używanego w codziennej pracy.</p>
```

Add three non-card route links: `Doradztwo`, `Aplikacje operacyjne`, `Lotnictwo`. Use the approved four display values from the registry and labels that state their meaning. The portrait uses current JPG/WebP variants, explicit `width="960" height="1280"`, `fetchpriority="high"` and no `loading="lazy"`.

Trust Bar contains only client names that passed the owner gate. If no name is approved, keep the label and omit the name row rather than filling it from memory.

- [ ] **Step 3: Implement Process and its CTA as the signature route**

Use exact step contracts:

| Step | Decision text | Artifact |
|---|---|---|
| Diagnoza | Ustalam problem, interesariuszy, ograniczenia i stan danych. | Mapa decyzji |
| Strategia | Wybieram docelowy model, priorytety i kolejność zmian. | Plan operacyjny |
| Wdrożenie | Łączę proces, ludzi, dane i technologię w działającym rozwiązaniu. | Uruchomiony system |
| Wartość | Sprawdzam użycie, wynik i kolejne decyzje rozwojowe. | Pomiar i iteracja |

The CTA immediately after this section says `Zacznijmy od diagnozy` and links to `#contact` with `?`-free static href.

- [ ] **Step 4: Rebuild Cases with verified role, scope and proof only**

Keep ORLEN, Żabka and KGHM only if their relationship and scope records are approved. Allowed evergreen structure:

```html
<article class="evidence-row" data-domain="advisory">
  <p class="evidence-row__context">...</p>
  <h3 class="evidence-row__title">...</h3>
  <dl class="evidence-row__ledger">
    <div><dt>Rola</dt><dd>...</dd></div>
    <div><dt>Zakres</dt><dd>...</dd></div>
    <div><dt>Dowód</dt><dd>...</dd></div>
  </dl>
</article>
```

Do not publish Żabka store count, KGHM rank, Motor Oil capacity or any superlative unless the matching registry record is approved, dated and sourced. The CTA immediately after Cases is `Zobacz wszystkie projekty` and links to `/case-studies/`.

- [ ] **Step 5: Rebuild About, Education and Resume without duplicated claims**

- About explains decisions and the relationship among procurement, applications and aviation; it does not repeat the full chronology.
- Education contains only approved institution, program and year records.
- Resume contains organization, date, role and one responsibility sentence per approved role.
- Remove rankings and client lists from Resume descriptions.
- Use the route line for Resume because chronology is a real sequence.

If a role, date or qualification remains `review`, omit the row. Do not replace it with an inferred year or translated title.

- [ ] **Step 6: Rebuild Skills, Portfolio, Clients and Contact**

Skills has three primary problem areas plus specific advisory services. Each item states `Problem`, `Działanie`, `Możliwy wynik`; do not promise a numerical outcome.

Portfolio shows an item only when `portfolio.<id>.status` and role are approved. Use existing screenshots only. FilmoLot and WarsawFlightSafety render as typographic evidence rows when no approved image exists; do not create substitute art.

Clients is populated only from approved `client.*` records. Contact exposes three mailto intents:

```html
<a href="mailto:pawel@mamcarz.com?subject=Doradztwo">Doradztwo</a>
<a href="mailto:pawel@mamcarz.com?subject=Aplikacja%20operacyjna">Aplikacja operacyjna</a>
<a href="mailto:pawel@mamcarz.com?subject=Lotnictwo">Lotnictwo</a>
```

Remove the unconditional availability statement. Show availability only if `availability.current` is approved and dated; otherwise use `Opisz kontekst i decyzję, przed którą stoisz.`

- [ ] **Step 7: Run Polish home verification and commit**

Run:

```bash
npm run verify:home -- --lang=pl
rg -n '—|nie tylko|kompleksow|innowacyjn|realnie|#1|największ|Polpharma' index.html
git diff --check
git add index.html content/site-facts.json scripts/verify-site.mjs
git commit -m "feat: rebuild the Polish Flight Plan homepage"
```

Use `npm run verify:home -- --lang=pl` in this task. Expected: no forbidden visible-copy matches and the PL structural verifier PASSes independently of the unfinished EN page.

---

### Task 6: Build the semantic English mirror

**Files:**
- Modify: `en/index.html:6-732`
- Modify: `content/site-facts.json`
- Modify: `scripts/verify-site.mjs`

**Interfaces:**
- Consumes: identical approved fact IDs as PL.
- Produces matching section markers, localized links and EN display strings.

- [ ] **Step 1: Add parity checks that fail on missing IDs, links or facts**

Compare the ordered section markers and count of `data-fact-id`, `article.evidence-row`, process steps, portfolio items and client items between PL and EN. Do not compare raw paragraph text.

Run `npm run verify:home`; expected FAIL until EN markup matches the already verified PL page.

- [ ] **Step 2: Replace the EN hero and process with fixed semantic copy**

Hero:

```html
<h1>From decision to an operational system.</h1>
<p class="hero-lead">I lead procurement transformations, build operational applications and develop aviation ventures. I take work from a defined problem to a solution used in day-to-day operations.</p>
```

Process labels: `Diagnosis`, `Strategy`, `Implementation`, `Value`. Translate meaning naturally; retain the same artifact relationship and ordering.

- [ ] **Step 3: Mirror evidence and biography by fact ID**

Every number, client, role, qualification and project status uses the same `data-fact-id` as PL and the registry's `display_en`. Do not translate a Polish claim that is still `review`. Do not introduce `largest`, `leading`, `not just`, decorative em dashes or new results.

- [ ] **Step 4: Mirror Portfolio, Clients and Contact**

Use the same set and order of approved project/client IDs. Contact subjects are `Advisory`, `Operational application`, `Aviation`. The language switch points to `/`; every direct nav route uses `/en/` except external links.

- [ ] **Step 5: Verify parity and commit**

Run:

```bash
npm run verify:home
rg -n '—|not just|comprehensive|innovative|leading|#1|largest|Polpharma' en/index.html
git diff --check
git add en/index.html content/site-facts.json scripts/verify-site.mjs
git commit -m "feat: add the English Flight Plan homepage"
```

Expected: parity and fact checks PASS; forbidden visible-copy scan returns no matches.

---

### Task 7: Complete responsive, accessibility and performance verification

**Files:**
- Modify: `assets/css/style.css`
- Modify: `assets/js/main.js`
- Modify: `index.html`
- Modify: `en/index.html`
- Modify: `scripts/verify-site.mjs`

**Interfaces:**
- Consumes all prior home contracts.
- Produces a locally verified home baseline for Plan 2.

- [ ] **Step 1: Add static accessibility/performance assertions**

Check for one `main`, one skip link, `aria-expanded="false"`, `aria-controls="nav-menu"`, input `maxlength="2000"`, explicit hero image dimensions, `fetchpriority="high"`, stylesheet/script `v=20260825-flightplan-1`, and no inline `style=` on home.

Run `npm run verify:home`; expected FAIL until all attributes and version strings are synchronized.

- [ ] **Step 2: Apply the shared cache-busting version to both home pages**

```html
<link rel="stylesheet" href="/assets/css/style.css?v=20260825-flightplan-1">
<script src="/assets/js/main.js?v=20260825-flightplan-1" defer></script>
```

Preload only the Barlow 600 latin/latin-ext files if render inspection shows the hero uses them before first paint. Do not preload all six font files.

- [ ] **Step 3: Run a local static server and inspect target widths**

Run:

```bash
python3 -m http.server 4173 --directory .
```

Inspect PL and EN at 320, 390, 768, 1280 and 1440 px. Confirm:

- no horizontal overflow,
- route order remains legible on mobile,
- no duplicate primary CTA in one viewport,
- nav group is keyboard operable,
- Escape closes the JS-enhanced mobile menu and restores focus,
- no-JS navigation and mailto links remain usable,
- user/model chat text is displayed as text, not HTML,
- reduced-motion mode contains no animated route or hidden content.

- [ ] **Step 4: Check local budgets in the validator**

Extend `verifyFoundation()` with `gzipSync` from `node:zlib` and `stat` from `node:fs/promises`. Require compressed CSS at most 75,000 bytes, compressed browser JavaScript at most 25,000 bytes and `assets/img/IMG_3284-480.webp` at most 220,000 bytes. Then run:

```bash
npm run verify:foundation
```

Expected: all three named budget checks PASS. These are local asset budgets, not production Core Web Vitals.

- [ ] **Step 5: Run final Plan 1 gate and commit fixes**

Run:

```bash
npm run verify:home
node --check assets/js/main.js
git diff --check
git status --short
```

Commit any verification fixes with:

```bash
git add index.html en/index.html assets/css/style.css assets/js/main.js scripts/verify-site.mjs content/site-facts.json
git commit -m "fix: complete Flight Plan homepage verification"
```

Expected: all commands PASS; no deploy or push performed; `.superpowers/` remains outside commits unless the user separately requests its inclusion.

## Plan 1 Completion Gate

- `npm run verify:home` exits 0.
- Both homepages contain the exact approved headline and section order.
- Every published high-risk fact has an approved registry record.
- No unresolved fact is hidden behind softer but still factual wording.
- Barlow is locally licensed and loaded; Playfair is not active.
- CSS is one coherent file, with compatibility styles for pages awaiting Plan 2.
- Home works without JS; JavaScript is null-safe and does not inject chat text as HTML.
- Desktop/mobile screenshots and keyboard walkthrough have been reviewed.
- Repository has no product deploy, Worker deploy, push or unrequested asset change.
