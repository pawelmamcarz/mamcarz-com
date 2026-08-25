# Flight Plan Pages and Content Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dodać strony Aplikacje, Lotnictwo i Wiedza oraz przenieść wszystkie istniejące strony PL/EN i materiały pomocnicze do jednego systemu Flight Plan bez tworzenia nowych, niepotwierdzonych faktów.

**Architecture:** Wszystkie strony używają istniejącego statycznego page shell, jednego CSS i defensywnego `main.js` z Planu 1. Nowe huby są osobnymi plikami HTML, a istniejące trasy zachowują canonical URL. Treść jest redagowana z rejestru `content/site-facts.json`: rekordy `review` i `retired` nie mogą pojawić się w HTML, metadanych ani powiązanych opisach.

**Tech Stack:** statyczny HTML5, jeden CSS, vanilla JavaScript, Node.js 20+ validator, Cloudflare Pages.

**Spec:** `docs/superpowers/specs/2026-08-25-mamcarz-platform-redesign-design.md`

## Global Constraints

- Ten plan zaczyna się dopiero po pełnym przejściu Planu 1 i `npm run verify:home`.
- Każda nowa lub zmieniona treść merytoryczna ma wersję PL i EN w tej samej strukturze, z wyjątkiem jawnie jednojęzycznych materiałów pomocniczych.
- Slugi usług w EN pozostają polskie.
- Nowe pary: `/aplikacje-operacyjne/` ↔ `/en/aplikacje-operacyjne/`, `/lotnictwo/` ↔ `/en/lotnictwo/`, `/wiedza/` ↔ `/en/wiedza/`.
- `/case-studies/` pozostaje canonical URL mimo etykiety „Projekty/Projects”. Nie tworzymy duplikatu `/projekty/`.
- `/procurement-2026/` pozostaje PL-only. Nie tworzymy `/en/procurement-2026/` i nie dodajemy fałszywego hreflang EN.
- Lotnictwo jest ofertą i działalnością core; nie jest etykietowane jako hobby ani „po godzinach”.
- Nie wolno dodawać klienta, roli, wyniku, statusu projektu, uprawnienia, formatu szkolenia ani dostępności bez zatwierdzonego rekordu faktu.
- Źródło `existing website` nie wystarcza do podniesienia rekordu z `review` do `approved`.
- Nie używać wyszukiwarkowego snippetu jako dowodu. Źródło publiczne musi prowadzić bezpośrednio do strony właściciela danych; źródło prywatne wymaga owner verification.
- Brak dowodu oznacza usunięcie albo opis funkcjonalny bez twierdzenia o wyniku lub aktualnym statusie.
- Bez nowych logo klientów, zdjęć stockowych, obrazów generowanych i zmian zatwierdzonego portretu.
- Bez dekoracyjnych em dash, „nie tylko/not just”, marketingowych superlatywów i powtarzalnych CTA.
- Linia trasy występuje tylko przy realnej sekwencji.
- Każda publiczna strona ma jeden `h1`; pełne SEO i schema finalizuje Plan 3, ale żadna nowa strona nie może być opublikowana bez poprawnego canonical i hreflang.
- Bez pushu, merge i deployu w ramach tego planu.

---

## File Responsibility Map

### Create

- `aplikacje-operacyjne/index.html` - PL service hub aplikacji operacyjnych.
- `en/aplikacje-operacyjne/index.html` - EN semantic mirror.
- `lotnictwo/index.html` - PL aviation business hub.
- `en/lotnictwo/index.html` - EN semantic mirror.
- `wiedza/index.html` - PL knowledge hub.
- `en/wiedza/index.html` - EN semantic mirror.

### Modify: existing mirrored pages

- `uslugi/transformacja-zakupow/index.html`
- `en/uslugi/transformacja-zakupow/index.html`
- `uslugi/wdrozenie-sap-ariba/index.html`
- `en/uslugi/wdrozenie-sap-ariba/index.html`
- `uslugi/doradztwo-zamowienia-publiczne/index.html`
- `en/uslugi/doradztwo-zamowienia-publiczne/index.html`
- `case-studies/index.html`
- `en/case-studies/index.html`
- `wystapienia/index.html`
- `en/wystapienia/index.html`

### Modify: intentionally non-mirrored materials

- `procurement-2026/index.html` - PL-only parent page.
- `diagrams/diagram1_universal.html` - interactive process artifact.
- `diagrams/diagram2_ariba.html` - SAP taxonomy artifact.
- `diagrams/diagram3_maturity.html` - maturity artifact.
- `diagrams/infographic.html` - embedded EN infographic artifact.
- `infographic_procurement_2026_EN.html` - standalone EN infographic.

### Modify: shared controls

- `assets/css/style.css` - page patterns and artifact styles only; no second visual system.
- `assets/js/main.js` - only if an optional page component needs null-safe initialization.
- `content/site-facts.json` - new approved/review/retired records and surfaces.
- `scripts/verify-site.mjs` - route pairs, page shell, copy, links and assets.
- `package.json` - add `verify:pages`.

## Shared Interfaces

### Route pair manifest

Add this exact data to `scripts/verify-site.mjs`:

```js
const ROUTE_PAIRS = [
  ["index.html", "en/index.html", "/", "/en/", "home"],
  ["uslugi/transformacja-zakupow/index.html", "en/uslugi/transformacja-zakupow/index.html", "/uslugi/transformacja-zakupow/", "/en/uslugi/transformacja-zakupow/", "services"],
  ["uslugi/wdrozenie-sap-ariba/index.html", "en/uslugi/wdrozenie-sap-ariba/index.html", "/uslugi/wdrozenie-sap-ariba/", "/en/uslugi/wdrozenie-sap-ariba/", "services"],
  ["uslugi/doradztwo-zamowienia-publiczne/index.html", "en/uslugi/doradztwo-zamowienia-publiczne/index.html", "/uslugi/doradztwo-zamowienia-publiczne/", "/en/uslugi/doradztwo-zamowienia-publiczne/", "services"],
  ["aplikacje-operacyjne/index.html", "en/aplikacje-operacyjne/index.html", "/aplikacje-operacyjne/", "/en/aplikacje-operacyjne/", "applications"],
  ["lotnictwo/index.html", "en/lotnictwo/index.html", "/lotnictwo/", "/en/lotnictwo/", "aviation"],
  ["case-studies/index.html", "en/case-studies/index.html", "/case-studies/", "/en/case-studies/", "projects"],
  ["wiedza/index.html", "en/wiedza/index.html", "/wiedza/", "/en/wiedza/", "knowledge"],
  ["wystapienia/index.html", "en/wystapienia/index.html", "/wystapienia/", "/en/wystapienia/", "speaking"]
];
```

The CLI accepts `--family=home|services|applications|aviation|projects|knowledge|speaking|artifacts|all`; it rejects every other value. A family run checks only that independently editable family, while `npm run verify:pages` keeps `all` as the default final gate.

### Page shell contract

Every paired page has:

```html
<body data-page="route-name">
  <a class="skip-link" href="#main">...</a>
  <nav class="site-nav" aria-label="...">...</nav>
  <div class="nav-overlay" id="nav-overlay"></div>
  <main id="main" tabindex="-1">
    <header class="page-hero">...</header>
    ...
  </main>
  <footer class="site-footer">...</footer>
  <script src="/assets/js/main.js?v=20260825-flightplan-2" defer></script>
</body>
```

The language switch uses the exact paired route. A non-paired page links to the appropriate language hub with visible text explaining the language change and does not claim hreflang equivalence.

### Evidence row contract

```html
<article class="evidence-row" data-fact-ids="fact.id.one fact.id.two">
  <p class="evidence-row__context">...</p>
  <h2 class="evidence-row__title">...</h2>
  <dl class="evidence-row__ledger">
    <div><dt>Rola</dt><dd>...</dd></div>
    <div><dt>Zakres</dt><dd>...</dd></div>
    <div><dt>Dowód</dt><dd>...</dd></div>
  </dl>
</article>
```

Every ID in `data-fact-ids` must exist and be `approved`. Text without an ID may describe navigation, process or the page's purpose, but cannot introduce a client, result, number, qualification or current status.

---

### Task 1: Extend verification to the complete route architecture

**Files:**
- Modify: `scripts/verify-site.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `ROUTE_PAIRS` above.
- Produces: `verifyPages()` and `npm run verify:pages`.

- [ ] **Step 1: Add failing route-pair tests**

Implement:

```js
const familyArg = process.argv.find((arg) => arg.startsWith("--family="));
const family = familyArg?.split("=")[1] ?? "all";
const VALID_FAMILIES = new Set([
  "all", "home", "services", "applications", "aviation",
  "projects", "knowledge", "speaking", "artifacts"
]);
check(VALID_FAMILIES.has(family), "cli-family", "scripts/verify-site.mjs", `unsupported family ${family}`);

async function verifyPages(factData) {
  const selectedPairs = ROUTE_PAIRS.filter((pair) => family === "all" || pair[4] === family);
  for (const [plFile, enFile, plRoute, enRoute] of selectedPairs) {
    const [pl, en] = await Promise.all([
      readRequired(plFile, "route-file"),
      readRequired(enFile, "route-file")
    ]);
    verifyPageShell(plFile, pl, "pl", plRoute, enRoute);
    verifyPageShell(enFile, en, "en", enRoute, plRoute);
    verifyFactIds(plFile, pl, factData);
    verifyFactIds(enFile, en, factData);
  }
  if (family === "speaking" || family === "all") await verifyProcurementParent(factData);
  if (family === "artifacts" || family === "all") await verifyArtifacts(factData);
}
```

`readRequired(path, checkId)` catches `ENOENT`, adds `ERROR <checkId> <path>: required file is missing`, and returns an empty string so the verifier reports every absent route in one run instead of terminating on the first raw exception.

`verifyPageShell()` checks one `h1`, one `main`, canonical, three real hreflang entries, the shared stylesheet/script version, main navigation routes and paired language link. `verifyFactIds()` splits `data-fact-ids`, confirms each record exists and rejects any status other than `approved`.

- [ ] **Step 2: Add a local-link resolver**

Extract `href`, `src` and `srcset` URLs that begin `/`. Ignore fragments, `mailto:`, external URLs and the hardcoded Worker API. Map trailing-slash routes to `index.html` and fail if the target does not exist.

```js
function routeToFile(urlPath) {
  const clean = urlPath.split(/[?#]/)[0];
  if (clean === "/") return "index.html";
  if (clean.endsWith("/")) return `${clean.slice(1)}index.html`;
  return clean.slice(1);
}
```

- [ ] **Step 3: Add the pages command and prove the expected failure**

```json
"verify:pages": "node scripts/verify-site.mjs --scope=pages"
```

Run `npm run verify:pages`. Expected: FAIL because the six new hub files do not exist and old page shells use legacy navigation.

- [ ] **Step 4: Commit the failing contract only with an explicit red-state message**

Do not commit a deliberately failing default command. `verify:site` remains scoped to completed surfaces until all new pages exist. Commit the route test behind `--scope=pages`:

```bash
node --check scripts/verify-site.mjs
git add scripts/verify-site.mjs package.json package-lock.json
git commit -m "test: define Flight Plan route contracts"
```

---

### Task 2: Build the Operational Applications pair

**Files:**
- Create: `aplikacje-operacyjne/index.html`
- Create: `en/aplikacje-operacyjne/index.html`
- Modify: `assets/css/style.css`
- Modify: `content/site-facts.json`
- Modify: `scripts/verify-site.mjs`

**Interfaces:**
- Produces route pair `/aplikacje-operacyjne/` ↔ `/en/aplikacje-operacyjne/`.
- Produces `data-page="applications"` and sections `problem`, `delivery`, `evidence`, `fit`, `contact`.

- [ ] **Step 1: Add application-page content-contract checks**

Require H1 `Aplikacje operacyjne` / `Operational applications`, the five section markers, `Service` JSON-LD, paired hreflang and no phrases suggesting a generic software house.

Run `npm run verify:pages -- --family=applications`; expected FAIL on missing files.

- [ ] **Step 2: Create both pages with an exact, claim-safe opening**

PL:

```html
<h1>Aplikacje operacyjne</h1>
<p class="page-lead">Buduję narzędzia wokół rzeczywistego procesu pracy. Zaczynam od decyzji, danych i odpowiedzialności użytkowników, a kończę na rozwiązaniu uruchomionym w codziennej operacji.</p>
```

EN:

```html
<h1>Operational applications</h1>
<p class="page-lead">I build tools around the way an operation actually works. The starting point is the decision, data and user responsibility; the endpoint is a solution used in day-to-day work.</p>
```

These are method statements approved by the positioning, not claims of a named delivery.

- [ ] **Step 3: Implement the page structure**

- `problem`: procurement, field service and aviation as three domains in a ruled ledger, not cards.
- `delivery`: Discovery → Model danych → Workflow → Uruchomienie; route line is valid because order is real.
- `evidence`: only approved portfolio/project records; no project is labelled active without approved status and `as_of`.
- `fit`: exact boundary conditions, such as a named process owner and access to domain knowledge; no promise of timing or price.
- `contact`: mailto intent `Aplikacja operacyjna` / `Operational application`.

- [ ] **Step 4: Add Service JSON-LD using only page-purpose facts**

Use `@type: "Service"`, page URL, localized `name`, localized description and provider `Paweł Mamcarz`. Do not add `aggregateRating`, `offers`, client names or `areaServed` beyond an approved fact.

- [ ] **Step 5: Verify and commit the pair**

```bash
npm run verify:pages -- --family=applications
rg -n '—|nie tylko|not just|kompleksow|comprehensive|#1|największ|largest' aplikacje-operacyjne en/aplikacje-operacyjne
git diff --check
git add aplikacje-operacyjne en/aplikacje-operacyjne assets/css/style.css content/site-facts.json scripts/verify-site.mjs
git commit -m "feat: add operational applications pages"
```

Expected: the pair passes its route, fact and shell checks; forbidden-copy scan is empty.

---

### Task 3: Build Aviation as a core business pair

**Files:**
- Create: `lotnictwo/index.html`
- Create: `en/lotnictwo/index.html`
- Modify: `assets/css/style.css`
- Modify: `content/site-facts.json`
- Modify: `scripts/verify-site.mjs`

**Interfaces:**
- Produces route pair `/lotnictwo/` ↔ `/en/lotnictwo/`.
- Produces `data-page="aviation"` and groups `operations`, `training-safety`, `media`, `software`, `ventures`, `contact`.

- [ ] **Step 1: Add failing aviation-core checks**

Require the H1 pair, all six group markers and at least one direct nav link from each homepage. Reject `hobby`, `pasja po godzinach`, `outside work`, `beyond work` and equivalent framing in the aviation pages. Run `npm run verify:pages -- --family=aviation` and expect FAIL on missing files.

- [ ] **Step 2: Create a claim-safe opening**

PL:

```html
<h1>Lotnictwo</h1>
<p class="page-lead">Lotnictwo jest jednym z głównych obszarów mojej działalności. Łączę operacje, sprzedaż, szkolenie, bezpieczeństwo, media i software w projektach, które wymagają jasnych procedur oraz odpowiedzialności.</p>
```

EN:

```html
<h1>Aviation</h1>
<p class="page-lead">Aviation is one of the core areas of my business. I connect operations, sales, training, safety, media and software in work that depends on clear procedures and accountability.</p>
```

This scope comes directly from the approved design. It does not prove an individual credential or current venture status.

- [ ] **Step 3: Populate capability groups without inferred credentials**

Each group explains the type of problem and links to approved evidence. `PPL(H)`, `PPL(A)`, aerobatics rating, display pilot, Forum Agency, TVP, Samos, Chios and ATAM may appear only if their individual records are `approved`. Do not infer an instructor certificate, ATO status, operator certificate, commercial pilot privilege or current school status from any other fact.

- [ ] **Step 4: Render ventures with explicit fact-state behavior**

- Akrobacja.com, WarsawFlightSafety and FilmoLot are the only aviation venture names required by the approved spec.
- An approved URL is rendered as a link; an unverified URL is plain text.
- An approved `status` is shown with its `as_of` date; otherwise no active/inactive tag is shown.
- Use the existing Akrobacja screenshot. FilmoLot and WarsawFlightSafety remain text-led until an approved asset is provided.
- Do not reuse an unrelated screenshot as an aviation image.

- [ ] **Step 5: Add Service JSON-LD without unsupported service details**

The schema may state the localized service name, page URL and provider. Do not add prices, ratings, service area, certificates or availability without approved facts.

- [ ] **Step 6: Verify and commit the pair**

```bash
npm run verify:pages -- --family=aviation
rg -n -i 'hobby|po godzinach|outside work|beyond work|instructor|ATO|commercial pilot|#1|największ|largest' lotnictwo en/lotnictwo
git diff --check
git add lotnictwo en/lotnictwo assets/css/style.css content/site-facts.json scripts/verify-site.mjs
git commit -m "feat: establish aviation as a core business area"
```

Expected: no disallowed framing or inferred credentials.

---

### Task 4: Build the Knowledge pair without a fake translation

**Files:**
- Create: `wiedza/index.html`
- Create: `en/wiedza/index.html`
- Modify: `assets/css/style.css`
- Modify: `scripts/verify-site.mjs`

**Interfaces:**
- Produces route pair `/wiedza/` ↔ `/en/wiedza/`.
- Links to speaking pages, Procurement 2026 and the standalone EN infographic with honest language labels.

- [ ] **Step 1: Add failing hub checks**

Require H1 `Wiedza` / `Insights`, item metadata `type`, `language`, `date/status`, and `CollectionPage` JSON-LD. Reject `/en/procurement-2026/` in every file.

Run `npm run verify:pages -- --family=knowledge`; expected FAIL on missing files.

- [ ] **Step 2: Create both hubs with an exact purpose statement**

PL: `Analizy, wystąpienia i narzędzia, które porządkują decyzje w procurement, technologii i operacjach.`

EN: `Analysis, talks and tools that clarify decisions in procurement, technology and operations.`

- [ ] **Step 3: Add only existing resources**

- PL hub links to `/procurement-2026/` and `/wystapienia/`.
- EN hub links to `/en/wystapienia/` and `/infographic_procurement_2026_EN.html`.
- EN may link to `/procurement-2026/` only with visible label `Polish-language resource` and `lang="pl"`.
- Dates come from approved publication records; if unavailable, show no date rather than the file mtime.

- [ ] **Step 4: Verify and commit**

```bash
npm run verify:pages -- --family=knowledge
rg -n '/en/procurement-2026/' . -g '*.html' -g '!.superpowers/**'
git diff --check
git add wiedza en/wiedza assets/css/style.css scripts/verify-site.mjs
git commit -m "feat: add bilingual knowledge hubs"
```

Expected: route check PASS; fake EN route scan is empty.

---

### Task 5: Migrate the three advisory service pairs

**Files:**
- Modify: all six files under `uslugi/*/index.html` and `en/uslugi/*/index.html`
- Modify: `content/site-facts.json`
- Modify: `scripts/verify-site.mjs`
- Modify: `assets/css/style.css`

**Interfaces:**
- Produces page sequence: problem → fit → scope → method → evidence → contextual CTA.
- Retains exact canonical and hreflang routes.

- [ ] **Step 1: Add a service-page structure test**

For every service pair require markers `problem`, `fit`, `scope`, `method`, `evidence`, `contact`, one `Service` JSON-LD and the current H1 topic. Reject inline `style=` and legacy `<em>` display styling.

- [ ] **Step 2: Migrate Procurement Transformation PL/EN**

Use H1 `Transformacja zakupów` / `Procurement transformation`. Preserve SAP and procurement taxonomy. Every PZU, PwC, PGE, PGNiG, ORLEN, CAPP, portfolio amount and client relationship requires approved IDs. Replace broad promises of savings or measurable value with the concrete deliverable of the approved method.

Run the pair-specific verifier and commit:

```bash
git add uslugi/transformacja-zakupow/index.html en/uslugi/transformacja-zakupow/index.html content/site-facts.json assets/css/style.css scripts/verify-site.mjs
git commit -m "feat: migrate procurement transformation pages"
```

- [ ] **Step 3: Migrate SAP Ariba Implementation PL/EN**

Use H1 `Wdrożenie SAP Ariba` / `SAP Ariba implementation`. Retain accurate SAP module names. Claims about partner awards, Gold Partner status, corporate ownership from March 2026, country count, project count and named customers must each have an approved record; otherwise omit them. Do not replace a removed rank with another unsourced adjective.

```bash
git add uslugi/wdrozenie-sap-ariba/index.html en/uslugi/wdrozenie-sap-ariba/index.html content/site-facts.json assets/css/style.css scripts/verify-site.mjs
git commit -m "feat: migrate SAP Ariba service pages"
```

- [ ] **Step 4: Migrate Public Procurement PL/EN**

Use H1 `Doradztwo w zamówieniach publicznych` / `Public procurement advisory`. Validate all legal descriptions against the intended service scope at implementation time. Career roles, tender values, framework agreement, Marketplanet audit and client names require approved records. Avoid current-law claims unless backed by an up-to-date primary legal source; otherwise describe experience historically.

```bash
git add uslugi/doradztwo-zamowienia-publiczne/index.html en/uslugi/doradztwo-zamowienia-publiczne/index.html content/site-facts.json assets/css/style.css scripts/verify-site.mjs
git commit -m "feat: migrate public procurement pages"
```

- [ ] **Step 5: Verify all three pairs together**

```bash
npm run verify:pages -- --family=services
rg -n '—|nie tylko|not just|kompleksow|comprehensive|#1|największ|largest|wiodąc|leading' uslugi en/uslugi
git diff --check
```

Expected: all service pairs PASS and the scan is empty.

---

### Task 6: Turn Case Studies into the Projects evidence register

**Files:**
- Modify: `case-studies/index.html:1-191`
- Modify: `en/case-studies/index.html:1-191`
- Modify: `content/site-facts.json`
- Modify: `scripts/verify-site.mjs`

**Interfaces:**
- Produces `CollectionPage` plus `ItemList` schema structure for Plan 3 validation.
- Produces groups `advisory`, `applications`, `aviation` using evidence rows.

- [ ] **Step 1: Add failing project-register checks**

Require localized label `Projekty/Projects`, all three group identifiers, evidence row ledgers and identical ordered project IDs in PL/EN. Reject dynamic values unless the corresponding fact has `kind: "dated"`, non-null `as_of`, source label and `approved` status.

Run `npm run verify:pages -- --family=projects`; expected FAIL until the evidence-register contract is implemented.

- [ ] **Step 2: Audit each existing project before rewriting**

For ORLEN, Żabka, KGHM, PLL LOT and Motor Oil Hellas, classify independently:

- relationship,
- Paweł's role,
- actual scope,
- numerical evidence,
- external organization facts,
- current/ongoing status.

Do not infer role from the technology list. Do not infer an outcome from project scope. Żabka store count, KGHM rank, LOT age and Motor Oil throughput are removed unless separately approved with source/date.

- [ ] **Step 3: Add own projects using the same evidence standard**

Include only approved own-project records. A product screenshot proves the page existed when captured; it does not prove current operation, ownership, customer count or business result. Render role and status only from registry.

- [ ] **Step 4: Rewrite both pages and verify parity**

Use the shared evidence row contract. Filters, if used, are plain anchor links to groups and work without JavaScript. Avoid card grids and client logo treatments.

- [ ] **Step 5: Commit the evidence register**

```bash
npm run verify:pages -- --family=projects
rg -n '12 823|12,823|12 800|12,800|220 000|220,000|#1|największ|largest' case-studies en/case-studies
git diff --check
git add case-studies en/case-studies content/site-facts.json scripts/verify-site.mjs
git commit -m "feat: rebuild projects as an evidence register"
```

Expected: dynamic/ranking scan is empty unless exact occurrences are approved and validator-recognized.

---

### Task 7: Migrate Speaking and the Procurement 2026 parent page

**Files:**
- Modify: `wystapienia/index.html:1-213`
- Modify: `en/wystapienia/index.html:1-213`
- Modify: `procurement-2026/index.html:1-164`
- Modify: `content/site-facts.json`
- Modify: `scripts/verify-site.mjs`
- Modify: `assets/css/style.css`

**Interfaces:**
- Produces speaking page groups `topics`, `formats`, `audience`, `contact`.
- Preserves Procurement 2026 as PL-only.

- [ ] **Step 1: Add speaking and PL-only checks**

Require the speaking group markers and paired routes. `verifyProcurementParent()` checks Procurement 2026 for canonical, only `pl` and `x-default`, plus a language-aware link to `/en/wiedza/` that is not marked hreflang.

Run `npm run verify:pages -- --family=speaking`; expected FAIL until both the speaking pair and Procurement parent contract are implemented.

- [ ] **Step 2: Migrate Speaking PL/EN**

Topics may describe procurement, SAP Ariba, digital procurement, public procurement and leadership only when they are genuinely offered. Keynote length, workshop duration, course hours, languages and university collaboration claims require approved records. Unknown formats are omitted, not rounded or generalized.

- [ ] **Step 3: Migrate Procurement 2026 parent shell**

Remove inline Playfair styling and use Flight Plan tokens/classes. Keep iframe titles and the four-artifact order. Label embedded EN infographic as English. Do not rewrite the procurement model's factual taxonomy during this task; only remove unsupported marketing claims and align shell/navigation.

- [ ] **Step 4: Verify and commit**

```bash
npm run verify:pages -- --family=speaking
rg -n '/en/procurement-2026/|Playfair Display|style="border-top' wystapienia en/wystapienia procurement-2026
git diff --check
git add wystapienia en/wystapienia procurement-2026 content/site-facts.json scripts/verify-site.mjs assets/css/style.css
git commit -m "feat: migrate speaking and Procurement 2026 pages"
```

---

### Task 8: Bring auxiliary diagrams into the Flight Plan family

**Files:**
- Modify: `diagrams/diagram1_universal.html`
- Modify: `diagrams/diagram2_ariba.html`
- Modify: `diagrams/diagram3_maturity.html`
- Modify: `diagrams/infographic.html`
- Modify: `infographic_procurement_2026_EN.html`
- Modify: `scripts/verify-site.mjs`

**Interfaces:**
- Produces `data-artifact` values `process`, `ariba-map`, `maturity`, `infographic`.
- Preserves existing interaction behavior and factual SAP labels.

- [ ] **Step 1: Add artifact-specific checks**

Implement `verifyArtifacts()` over the five exact artifact files. Require one `h1`, `lang`, viewport, title, `data-artifact`, a direct-return link when opened standalone and no broken local asset. Exempt embedded artifacts from the full site navigation but require their own accessible toolbar.

Run `npm run verify:pages -- --family=artifacts`; expected FAIL until all five artifact contracts are present.

- [ ] **Step 2: Replace unrelated neon/editorial framing with artifact tokens**

Use CSS custom properties local to each self-contained artifact:

```css
:root {
  --artifact-bg: #102831;
  --artifact-panel: #193D49;
  --artifact-paper: #E9EDEF;
  --artifact-line: #8E9CA1;
  --artifact-signal: #D94B2B;
}
```

Do not alter semantic colors required to distinguish SAP modules or maturity levels until contrast and meaning are checked. Preserve interaction data structures and labels.

- [ ] **Step 3: Remove AI-tells from prose, not taxonomy**

Remove decorative em dash and generic filler in explanations. Keep official SAP names, procurement stages and acronym labels even if they look technical. Do not simplify a factual taxonomy to satisfy a text pattern.

- [ ] **Step 4: Verify interactions and commit**

Open every artifact standalone and through the Procurement 2026 iframe. Click every interactive segment, test keyboard reachability and confirm no console error.

```bash
npm run verify:pages -- --family=artifacts
node --check assets/js/main.js
git diff --check
git add diagrams infographic_procurement_2026_EN.html scripts/verify-site.mjs
git commit -m "style: align procurement artifacts with Flight Plan"
```

---

### Task 9: Synchronize navigation, footer and cache version across all migrated pages

**Files:**
- Modify: every public `.html` file except self-contained embedded diagram bodies where the artifact toolbar contract applies.
- Modify: `scripts/verify-site.mjs`

**Interfaces:**
- Produces shared asset version `20260825-flightplan-2`.
- Produces exact primary nav order on every site-shell page.

- [ ] **Step 1: Extend global shell checks**

Require exactly one `.site-nav`, one `.site-footer`, one localized language link, asset version `20260825-flightplan-2`, no old `navLinks`/`navHamburger` IDs and no legacy labels `Case studies` in PL navigation or `Services` as a single direct link.

- [ ] **Step 2: Update every page shell**

Use the same Advisory `details/summary` group and direct routes defined in Plan 1. Set `aria-current="page"` only on the active direct link; for an advisory subpage, set it on the matching submenu link.

- [ ] **Step 3: Synchronize footers without inventing a copyright range**

Retain the existing owner-approved copyright start only if its fact record is approved. Otherwise use `© 2026 Paweł Mamcarz` without implying a 1993 business start. Footer links mirror primary routes but may omit `O mnie/About` if already present in the same page.

- [ ] **Step 4: Run the full Plan 2 gate**

```bash
npm run verify:home
npm run verify:pages
node --check assets/js/main.js
git diff --check
git status --short
```

Expected: all completed surfaces pass; only Plan 3 checks remain outside the default verifier.

- [ ] **Step 5: Commit shell synchronization**

```bash
git add index.html en/index.html \
  aplikacje-operacyjne/index.html en/aplikacje-operacyjne/index.html \
  lotnictwo/index.html en/lotnictwo/index.html \
  wiedza/index.html en/wiedza/index.html \
  uslugi/transformacja-zakupow/index.html en/uslugi/transformacja-zakupow/index.html \
  uslugi/wdrozenie-sap-ariba/index.html en/uslugi/wdrozenie-sap-ariba/index.html \
  uslugi/doradztwo-zamowienia-publiczne/index.html en/uslugi/doradztwo-zamowienia-publiczne/index.html \
  case-studies/index.html en/case-studies/index.html \
  wystapienia/index.html en/wystapienia/index.html \
  procurement-2026/index.html diagrams/diagram1_universal.html diagrams/diagram2_ariba.html \
  diagrams/diagram3_maturity.html diagrams/infographic.html infographic_procurement_2026_EN.html \
  assets/css/style.css assets/js/main.js scripts/verify-site.mjs content/site-facts.json
git commit -m "refactor: synchronize Flight Plan page shells"
```

Before commit, inspect `git diff --cached --name-only` and unstage any `.superpowers/` artifact or unrelated user change.

---

### Task 10: Perform the complete content and visual review

**Files:**
- Modify only files with concrete findings from this review.

**Interfaces:**
- Produces a verified, deployable-looking but not deployed Plan 2 state.

- [ ] **Step 1: Run the comprehensive factual-copy scan**

```bash
rg -n -i 'Polpharma|największ|largest|#1|wiodąc|leading|12[ .]?8|12,823|220[ .]?000|currently|aktualnie|active|aktywn' \
  . -g '*.html' -g '*.txt' -g 'worker/index.js' -g '!.superpowers/**' -g '!docs/**'
```

Classify every match against `content/site-facts.json`. Remove or approve with evidence; do not waive the scan because wording existed before the redesign.

- [ ] **Step 2: Run the AI-tells scan**

```bash
rg -n '—|nie tylko|not just|kompleksow|comprehensive|innowacyjn|innovative|realnie|seamless|unlock|leverage' \
  . -g '*.html' -g '!.superpowers/**' -g '!docs/**'
```

Review each match in context. SAP taxonomy and literal publication titles are not rewritten merely to satisfy the scanner; prose filler is.

- [ ] **Step 3: Render every page family**

At minimum inspect one page from each family at 390 and 1280 px, then inspect every unique new page. Confirm readable hierarchy, one primary CTA per view, hard-boundary evidence rows, correct language switch, no decorative route line on unordered content and no missing JPG/WebP.

- [ ] **Step 4: Verify all local links and finish the plan**

```bash
npm run verify:home
npm run verify:pages
git diff --check
git status --short --branch
```

Commit review fixes with a narrow message and exact file list. Do not push or deploy.

## Plan 2 Completion Gate

- All six new hub pages exist and pass route, shell, fact and language checks.
- Lotnictwo is visibly core and contains no hobby framing or inferred credentials.
- Every existing PL/EN pair uses the same information architecture and meaning.
- `/case-studies/` remains canonical and behaves as Projects/Projekty.
- Procurement 2026 remains PL-only; no fake EN route exists.
- Auxiliary artifacts retain interaction and taxonomy while fitting the visual family.
- Every client, number, role, status and result is approved or omitted.
- The full navigation, footer and asset version are synchronized.
- No push, deploy, generated media, client logo or unrelated file was added.
