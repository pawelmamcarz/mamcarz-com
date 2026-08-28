# Flight Plan Facts, SEO, Validation and Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Use cloudflare:workers-best-practices before editing `worker/index.js`, cloudflare:wrangler before validating `worker/wrangler.toml`, and superpowers:verification-before-completion before any completion claim. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zamknąć audyt faktów na wszystkich powierzchniach, ujednolicić SEO i odkrywalność, uruchomić pełną walidację regresji oraz utwardzić Worker czatowy bez publikacji strony ani Workera.

**Architecture:** `content/site-facts.json` pozostaje publicznie bezpiecznym rejestrem i jedyną bramką twierdzeń, ale HTML nadal jest serwowany bez buildu. `scripts/verify-site.mjs` dostaje jawny manifest tras i sprawdza HTML, metadata, schema, sitemap, pliki LLM, prompt Workera oraz synchronizację instrukcji. Worker importuje rejestr podczas bundlowania, przyjmuje tylko ograniczony kontrakt JSON, używa produkcyjnej allowlisty originów i zweryfikowanego bindingu rate limit. Pytania o klientów, liczby, kwalifikacje i bieżące statusy są obsługiwane wyłącznie na podstawie zatwierdzonych rekordów albo kończą się deterministycznym komunikatem o braku potwierdzenia.

**Tech Stack:** statyczny HTML5, Node.js `node:test`, vanilla JavaScript, Cloudflare Workers AI, Wrangler 4.125.0 lub nowszy zgodny ze schematem projektu, Cloudflare Pages.

**Spec:** `docs/superpowers/specs/2026-08-25-mamcarz-platform-redesign-design.md`

**Primary references:**

- Cloudflare Workers Rate Limiting API: <https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/>
- Cloudflare Workers Best Practices: <https://developers.cloudflare.com/workers/best-practices/workers-best-practices/>

## Global Constraints

- Ten plan zaczyna się po przejściu Planów 1 i 2: `npm run verify:home` oraz `npm run verify:pages` muszą zwracać kod `0`.
- Istniejąca strona, snippet wyszukiwarki, model językowy i pamięć wykonawcy nie są dowodem faktu.
- Rekord może otrzymać `approved` wyłącznie po jawnej decyzji właściciela albo sprawdzeniu bieżącego, bezpośredniego źródła pierwotnego.
- Brak dowodu oznacza `review` i usunięcie twierdzenia z powierzchni publicznych. Nie wolno tworzyć prawdopodobnej liczby, daty, roli, tłumaczenia tytułu, klienta, uprawnienia lub statusu.
- Fakt dynamiczny bez `as_of` i aktualnego źródła nie może być opisany jako aktualny.
- Wynik organizacji nie może zostać przypisany Pawłowi bez zatwierdzonego rekordu rozdzielającego rolę, zakres i rezultat.
- `content/site-facts.json` nie zawiera sekretów, prywatnych ścieżek, treści dokumentów wewnętrznych, danych kontaktowych klientów ani poufnych adresów.
- Polpharma nie występuje jako klient w HTML, metadatach, JSON-LD, plikach LLM ani prompcie Workera.
- Model Workera pozostaje `@cf/meta/llama-3.3-70b-instruct-fp8-fast`.
- CORS nie jest przedstawiany jako ochrona przed nadużyciem. Binding rate limit musi przejść test i walidację konfiguracji przed osobnym wydaniem Workera.
- Strona i Worker mają oddzielne commity kontrolne, push i deploy. Ten plan nie wykonuje pushu, deployu Pages, deployu Workera ani zmian w dashboardzie Cloudflare.

---

## File Responsibility Map

### Create

- `worker/index.test.mjs` - testy kontraktu HTTP, limitów, CORS, rate limitu, promptu i bezpiecznych błędów.

### Modify: facts and verification

- `content/site-facts.json` - końcowe statusy, źródła, daty i powierzchnie.
- `scripts/verify-site.mjs` - manifest publicznych stron i pełny zestaw kontroli.
- `package.json` - `verify:metadata`, `verify:discovery`, `verify:seo`, `verify:site`, `test:worker`.
- `package-lock.json` - tylko mechaniczna synchronizacja skryptów, bez nowych paczek.

### Modify: SEO and discovery

- `index.html`, `en/index.html`
- `uslugi/transformacja-zakupow/index.html`, `en/uslugi/transformacja-zakupow/index.html`
- `uslugi/wdrozenie-sap-ariba/index.html`, `en/uslugi/wdrozenie-sap-ariba/index.html`
- `uslugi/doradztwo-zamowienia-publiczne/index.html`, `en/uslugi/doradztwo-zamowienia-publiczne/index.html`
- `aplikacje-operacyjne/index.html`, `en/aplikacje-operacyjne/index.html`
- `lotnictwo/index.html`, `en/lotnictwo/index.html`
- `case-studies/index.html`, `en/case-studies/index.html`
- `wiedza/index.html`, `en/wiedza/index.html`
- `wystapienia/index.html`, `en/wystapienia/index.html`
- `procurement-2026/index.html`
- `diagrams/diagram1_universal.html`, `diagrams/diagram2_ariba.html`
- `diagrams/diagram3_maturity.html`, `diagrams/infographic.html`
- `infographic_procurement_2026_EN.html`
- `404.html`, `sitemap.xml`, `llms.txt`, `llms-full.txt`
- `_headers`, `_redirects` - zmienić tylko wtedy, gdy jawny test kontraktu nie przechodzi.

### Modify: Worker and shared browser client

- `worker/index.js`
- `worker/wrangler.toml`
- `assets/js/main.js`

### Keep verbatim synchronized

- `AGENTS.md`
- `CLAUDE.md`

## Shared Interfaces

### Public route manifest

Add one manifest to `scripts/verify-site.mjs`; derive sitemap, metadata and local-link expectations from it instead of maintaining separate lists:

```js
const PUBLIC_PAGES = [
  { file: "index.html", route: "/", lang: "pl", pair: "/en/", schema: ["Person", "WebSite"] },
  { file: "en/index.html", route: "/en/", lang: "en", pair: "/", schema: ["Person", "WebSite"] },
  { file: "uslugi/transformacja-zakupow/index.html", route: "/uslugi/transformacja-zakupow/", lang: "pl", pair: "/en/uslugi/transformacja-zakupow/", schema: ["Service"] },
  { file: "en/uslugi/transformacja-zakupow/index.html", route: "/en/uslugi/transformacja-zakupow/", lang: "en", pair: "/uslugi/transformacja-zakupow/", schema: ["Service"] },
  { file: "uslugi/wdrozenie-sap-ariba/index.html", route: "/uslugi/wdrozenie-sap-ariba/", lang: "pl", pair: "/en/uslugi/wdrozenie-sap-ariba/", schema: ["Service"] },
  { file: "en/uslugi/wdrozenie-sap-ariba/index.html", route: "/en/uslugi/wdrozenie-sap-ariba/", lang: "en", pair: "/uslugi/wdrozenie-sap-ariba/", schema: ["Service"] },
  { file: "uslugi/doradztwo-zamowienia-publiczne/index.html", route: "/uslugi/doradztwo-zamowienia-publiczne/", lang: "pl", pair: "/en/uslugi/doradztwo-zamowienia-publiczne/", schema: ["Service"] },
  { file: "en/uslugi/doradztwo-zamowienia-publiczne/index.html", route: "/en/uslugi/doradztwo-zamowienia-publiczne/", lang: "en", pair: "/uslugi/doradztwo-zamowienia-publiczne/", schema: ["Service"] },
  { file: "aplikacje-operacyjne/index.html", route: "/aplikacje-operacyjne/", lang: "pl", pair: "/en/aplikacje-operacyjne/", schema: ["Service"] },
  { file: "en/aplikacje-operacyjne/index.html", route: "/en/aplikacje-operacyjne/", lang: "en", pair: "/aplikacje-operacyjne/", schema: ["Service"] },
  { file: "lotnictwo/index.html", route: "/lotnictwo/", lang: "pl", pair: "/en/lotnictwo/", schema: ["Service"] },
  { file: "en/lotnictwo/index.html", route: "/en/lotnictwo/", lang: "en", pair: "/lotnictwo/", schema: ["Service"] },
  { file: "case-studies/index.html", route: "/case-studies/", lang: "pl", pair: "/en/case-studies/", schema: ["CollectionPage", "ItemList"] },
  { file: "en/case-studies/index.html", route: "/en/case-studies/", lang: "en", pair: "/case-studies/", schema: ["CollectionPage", "ItemList"] },
  { file: "wiedza/index.html", route: "/wiedza/", lang: "pl", pair: "/en/wiedza/", schema: ["CollectionPage"] },
  { file: "en/wiedza/index.html", route: "/en/wiedza/", lang: "en", pair: "/wiedza/", schema: ["CollectionPage"] },
  { file: "wystapienia/index.html", route: "/wystapienia/", lang: "pl", pair: "/en/wystapienia/", schema: ["CollectionPage"] },
  { file: "en/wystapienia/index.html", route: "/en/wystapienia/", lang: "en", pair: "/wystapienia/", schema: ["CollectionPage"] },
  { file: "procurement-2026/index.html", route: "/procurement-2026/", lang: "pl", pair: null, schema: ["Article"] },
  { file: "diagrams/diagram1_universal.html", route: "/diagrams/diagram1_universal.html", lang: "en", pair: null, schema: ["CreativeWork"] },
  { file: "diagrams/diagram2_ariba.html", route: "/diagrams/diagram2_ariba.html", lang: "en", pair: null, schema: ["CreativeWork"] },
  { file: "diagrams/diagram3_maturity.html", route: "/diagrams/diagram3_maturity.html", lang: "en", pair: null, schema: ["CreativeWork"] },
  { file: "diagrams/infographic.html", route: "/diagrams/infographic.html", lang: "en", pair: null, schema: ["CreativeWork"] },
  { file: "infographic_procurement_2026_EN.html", route: "/infographic_procurement_2026_EN.html", lang: "en", pair: null, schema: ["CreativeWork"] }
];
```

If a speaking or helper page does not contain the truthful required fields for `Event` or `Article`, use the exact conservative type shown above. Do not invent event dates, author dates, venue, organizer or publication dates to obtain richer schema.

### Fact publication invariant

```text
status=approved
AND source_label is auditable
AND (kind=constant AND as_of=null OR kind=dated AND as_of=YYYY-MM-DD)
AND every listed surface contains the approved localized display
= publishable
```

Every other state is non-publishable. A public URL is required for `source_type: "public_source"`. Owner verification and named internal evidence may use `source_url: null`, but the label must remain public-safe and sufficiently specific for a later audit.

### Worker request and response

```ts
type ChatMessage = { role: "user" | "assistant"; content: string };
type ChatRequest = { messages: ChatMessage[] };
type ChatSuccess = { reply: string; requestId: string };
type ChatError = { error: string; requestId?: string };
```

Limits: body 16,384 bytes; messages 1-20; trimmed content 1-2,000 Unicode code points; total content no more than 12,000 code points. Unknown fields are ignored and never copied to the model.

---

### Task 1: Activate the complete fail-closed validator

**Files:**
- Modify: `scripts/verify-site.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `PUBLIC_PAGES`, `content/site-facts.json`, all public text surfaces.
- Produces: `verifyMetadata()`, `verifyDiscovery()`, `verifyInstructions()`, composite `--scope=seo` and default `--scope=all`.

- [ ] **Step 1: Add named checks for every public page**

For each `PUBLIC_PAGES` entry, read the file with the `readRequired()` helper from Plan 2 and check:

- exactly one `<html lang="...">`, `<main` and `<h1`;
- absolute canonical equals `https://mamcarz.com${route}`;
- paired routes have exact `pl`, `en`, `x-default` hreflang; unpaired pages contain only their true language plus `x-default` pointing to themselves;
- non-empty `title`, description, `og:title`, `og:description`, `og:type`, `og:url`, `og:image`, `og:locale`;
- paired pages have the alternate OG locale;
- JSON-LD scripts parse and their flattened `@type` values contain every expected schema type;
- site-shell pages use CSS and JS version `20260825-flightplan-3`; the five self-contained artifact files keep their tested artifact shell and are exempt from loading unused shared JavaScript.

Use a parser helper that fails with the exact script index and filename:

```js
function parseJsonLd(path, html) {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  return blocks.flatMap((match, index) => {
    try {
      const value = JSON.parse(match[1]);
      return Array.isArray(value) ? value : [value];
    } catch (error) {
      check(false, "jsonld-parse", path, `block ${index + 1}: ${error.message}`);
      return [];
    }
  });
}
```

- [ ] **Step 2: Make fact validation structural, not substring-only**

Validate each record's required keys and enum values. Reject duplicate IDs, duplicate surfaces, dates later than the validation date, `public_source` without an HTTPS URL and any secret-like field name. For every `data-fact-id` and token in `data-fact-ids`, require an existing `approved` record whose `surfaces` includes the file.

For every `review` or `retired` record, fail if its non-empty localized display occurs in a listed public surface. For an `approved` record, require the localized display on every listed surface. Do not auto-change status in the validator.

Every visible numeric claim must sit inside an element carrying its approved fact ID. The only presentation-only numeric exemptions are section indices `01` through `11` and the literal error code `404`. Dates, career periods, product model numbers and quantities are facts; give them records instead of expanding the exemption list. Build known organization, credential and venture scans from all registry displays plus `blocked_claims`, so a known non-approved entity occurrence fails even when an author omitted `data-fact-id`.

- [ ] **Step 3: Add precise rejected-copy checks**

Strip `script`, `style`, comments and tags before scanning public copy. Reject these exact patterns, case-insensitively where applicable:

```js
const REJECTED_COPY = [
  /\u2014/u,
  /\bnie tylko\b/iu,
  /\bnot just\b/iu,
  /\bkompleksow(?:y|a|e|o|ych)?\b/iu,
  /\bcomprehensive\b/iu,
  /\binnowacyjn(?:y|a|e|ie|ych)?\b/iu,
  /\binnovative\b/iu
];
```

Superlatives and dynamic-status terms are not blindly rejected. If `#1`, `największy`, `largest`, `wiodący`, `leading`, `aktywny`, `active`, `currently` or a dated count occurs, require the enclosing element to carry an approved fact ID of `kind: "dated"` with non-null `as_of` and source URL.

- [ ] **Step 4: Add instruction and infrastructure checks**

Read `AGENTS.md` and `CLAUDE.md` as bytes and require equality. Check `_redirects` contains the exact permanent redirect:

```text
https://www.mamcarz.com/* https://mamcarz.com/:splat 301
```

Check `_headers` retains `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, immutable font/image caching and revalidation for CSS/JS. Do not add a CSP in this stream: current helper pages contain inline scripts/styles, so an untested CSP would break them.

- [ ] **Step 5: Wire deterministic commands**

Extend CLI dispatch without removing the completed scopes:

```js
const VALID_SCOPES = new Set([
  "all", "facts", "foundation", "home", "pages",
  "metadata", "discovery", "seo"
]);
check(VALID_SCOPES.has(scope), "cli-scope", "scripts/verify-site.mjs", `unsupported scope ${scope}`);

if (scope === "metadata" || scope === "seo" || scope === "all") await verifyMetadata(facts);
if (scope === "discovery" || scope === "seo" || scope === "all") await verifyDiscovery(facts);
if (scope === "all") await verifyInstructions();
```

Set scripts to include:

```json
{
  "verify:metadata": "node scripts/verify-site.mjs --scope=metadata",
  "verify:discovery": "node scripts/verify-site.mjs --scope=discovery",
  "verify:seo": "node scripts/verify-site.mjs --scope=seo",
  "verify:site": "node scripts/verify-site.mjs --scope=all",
  "test:worker": "node --test worker/index.test.mjs"
}
```

Run:

```bash
node --check scripts/verify-site.mjs
npm run verify:seo
```

Expected: syntax PASS; SEO scope FAILs with named findings that will be closed in Tasks 2-5. A raw file, JSON or regex exception is a validator defect and must be fixed before continuing.

- [ ] **Step 6: Commit the opt-in checks without making the completed scopes red**

Keep `verify:home` and `verify:pages` green. Do not make `verify:site` the release gate until Task 5 closes every expected finding.

```bash
git add scripts/verify-site.mjs package.json package-lock.json
git commit -m "test: define complete site verification"
```

---

### Task 2: Execute the final owner fact gate

**Files:**
- Modify: `content/site-facts.json`
- Modify: `worker/index.js`
- Modify: every surface containing a rejected or unresolved claim.

**Interfaces:**
- Produces: no published `review` or `retired` display.
- Produces: an owner-readable fact decision table before edits.

- [ ] **Step 1: Generate the complete decision report**

Extend `scripts/verify-site.mjs --report=facts` to print tab-separated rows with `id`, `status`, `kind`, PL display, EN display, source type, source label, `as_of` and surfaces. Run:

```bash
node scripts/verify-site.mjs --report=facts
rg -n -i '100\+|12[ .]?8|12,823|220[ .]?000|#1|największ|largest|wiodąc|leading|aktywn|active|currently|licenc|licen[cs]e|certyf|certif' \
  . -g '*.html' -g '*.txt' -g 'worker/index.js' -g '!docs/**' -g '!.superpowers/**'
```

Treat every match as an audit item, not as confirmation.

- [ ] **Step 2: Present unresolved claims to the owner before publication edits**

The report must show exact proposed wording and exact evidence for each unresolved client relationship, role, date, credential, result, current venture status, availability statement and the four hero-number meanings. Record only one of these explicit outcomes:

- `approved`: exact wording accepted; source and date recorded;
- `retired`: claim rejected and removed from every surface;
- `review`: insufficient evidence; claim removed from every surface and may return only after a future decision.

Do not infer approval from silence, prior presence on the site or approval of the visual design.

- [ ] **Step 3: Verify public sources only at their current primary URL**

For facts classified as `public_source`, open the current owner/issuer page, record the direct HTTPS URL and the date checked. Never use a search-results excerpt, aggregator, AI summary or another site's copied biography. For legal, certification or company-status claims, use the responsible authority or organization and preserve any material limitation.

- [ ] **Step 4: Remove every unresolved claim from every surface**

Synchronize HTML, titles, descriptions, JSON-LD, `llms.txt`, `llms-full.txt` and the Worker's fact surface list. Neutral replacement copy may describe a page's purpose or method, but cannot imply the missing client, credential, scale, success or current status.

- [ ] **Step 5: Prove that the registry is closed**

```bash
node scripts/verify-site.mjs --report=facts
npm run verify:home
npm run verify:pages
git diff --check
```

Expected: every surface-bound claim is `approved`; records left at `review` have zero public surfaces and zero published occurrences.

- [ ] **Step 6: Commit only the reviewed fact decisions and synchronized copy**

Inspect `git diff -- content/site-facts.json` and every affected surface before staging. Stage this closed set; Git skips paths without a diff:

```bash
git add content/site-facts.json worker/index.js \
  index.html en/index.html \
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
  sitemap.xml llms.txt llms-full.txt
git diff --cached --name-only
git commit -m "content: close the verified site fact audit"
```

The commit message does not imply that a public source exists for owner-verified facts.

---

### Task 3: Normalize metadata and Schema.org across every public route

**Files:**
- Modify: every file in `PUBLIC_PAGES`.
- Modify: `scripts/verify-site.mjs`.

**Interfaces:**
- Produces: exact canonical/hreflang/OG contract.
- Produces: schema types from the route manifest using approved facts only.

- [ ] **Step 1: Add route-specific failing metadata assertions**

Check that `og:url` equals canonical, `og:image` is an absolute local asset URL, descriptions are non-empty and do not contain an unresolved fact, and paired PL/EN pages use equivalent fact IDs. Require `Person` and `WebSite` to be connected by stable `@id` values on both homepages.

- [ ] **Step 2: Implement exact home graph**

Use an `@graph` with:

```json
{
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "WebSite", "@id": "https://mamcarz.com/#website", "url": "https://mamcarz.com/", "name": "Paweł Mamcarz" },
    { "@type": "Person", "@id": "https://mamcarz.com/#person", "name": "Paweł Mamcarz", "url": "https://mamcarz.com/" }
  ]
}
```

Add job titles, affiliations, `sameAs`, credentials and `knowsAbout` only when their individual fact records are approved for that homepage. Do not convert Trust Bar names into `worksFor`.

- [ ] **Step 3: Implement conservative schemas for other route families**

- advisory, applications and aviation: `Service` with localized name, URL, description and provider reference only;
- Projects: `CollectionPage` with `ItemList`; each item uses only approved project name, URL and description;
- Knowledge and Speaking: `CollectionPage`; use `Event` only for a row with approved event name, date and organizer;
- Procurement 2026: `Article` only with truthful headline, author and approved publication/modified date;
- helper diagrams and the standalone EN infographic: `CreativeWork`.

Never add ratings, offers, prices, awards, audience size, venue, service area or date merely to satisfy a recommended schema field.

- [ ] **Step 4: Apply language and Open Graph metadata**

For true pairs, use `pl`, `en`, `x-default`, `og:locale` `pl_PL` or `en_US`, and the other locale as `og:locale:alternate`. Procurement 2026 uses only `pl` and `x-default`, both pointing to itself. Each unpaired EN helper uses only `en` and `x-default`, both pointing to itself; its language switch links visibly to `/en/wiedza/` and is not marked as hreflang equivalence.

- [ ] **Step 5: Verify metadata without network assumptions**

```bash
npm run verify:metadata
rg -n 'aggregateRating|reviewCount|priceRange|offers|worksFor' . -g '*.html' -g '!docs/**' -g '!.superpowers/**'
git diff --check
```

Expected: metadata checks PASS for HTML; the rich-claim scan is empty unless every occurrence maps to an explicitly approved fact and required schema semantics.

- [ ] **Step 6: Commit metadata as a reviewable unit**

Stage only the public HTML files and validator changed in this task. Git skips files without a diff. Inspect `git diff --cached --stat` and `git diff --cached` before the commit:

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
  scripts/verify-site.mjs
git diff --cached --stat
git diff --cached
git commit -m "seo: normalize metadata and structured data"
```

---

### Task 4: Synchronize sitemap and LLM discovery files

**Files:**
- Modify: `sitemap.xml`
- Modify: `llms.txt`
- Modify: `llms-full.txt`
- Modify: `scripts/verify-site.mjs`

**Interfaces:**
- Consumes: `PUBLIC_PAGES` and approved fact records.
- Produces: exact canonical route coverage and no unapproved narrative claims.

- [ ] **Step 1: Add deterministic sitemap checks**

Parse every `<url>` block. Require each `PUBLIC_PAGES.route` exactly once, no unknown URL, no `/projekty/`, no fictitious `/en/procurement-2026/`, correct alternate links, and an ISO `lastmod` no later than the current date.

The expected `lastmod` comes from a route-to-date map in the validator. Set `2026-08-25` only for pages whose content or metadata changed in these plans; preserve the actual prior content date for an untouched route. Do not stamp all URLs with the deploy date.

- [ ] **Step 2: Rewrite `sitemap.xml` from the approved route map**

Include only `https://mamcarz.com` canonical URLs. Paired entries repeat the true PL/EN/x-default set. PL-only and EN-only entries carry only true language alternatives. Use the route's actual change date and omit speculative `changefreq` claims if they do not reflect an editorial schedule.

- [ ] **Step 3: Rewrite `llms.txt` as navigation, not marketing copy**

List the three equal core areas, canonical route URLs, languages and contact route. Include only short approved fact displays. Explicitly label `/procurement-2026/` as Polish-only and helper materials by their actual language.

- [ ] **Step 4: Rewrite `llms-full.txt` from approved statements**

Every client, number, role, qualification, project status and result must have an approved fact ID whose surfaces include `llms-full.txt`. Omit a section when no supporting facts remain. Do not fill gaps with a narrative biography generated from the old Worker prompt.

- [ ] **Step 5: Verify exact parity with the route and fact manifests**

```bash
npm run verify:discovery
rg -n -i 'Polpharma|#1|największ|largest|wiodąc|leading|aktywn|active|currently' sitemap.xml llms.txt llms-full.txt
git diff --check
```

Classify any dynamic match against the registry; zero unresolved matches are allowed.

Run `npm run verify:seo` after the discovery check; expected: the combined metadata and discovery scope PASSes.

- [ ] **Step 6: Commit discovery files**

```bash
git add sitemap.xml llms.txt llms-full.txt scripts/verify-site.mjs
git commit -m "seo: synchronize canonical discovery surfaces"
```

---

### Task 5: Repair 404 and repository contracts, then turn on the full gate

**Files:**
- Modify: `404.html`
- Modify: `assets/js/main.js`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `scripts/verify-site.mjs`
- Inspect: `_headers`, `_redirects`

**Interfaces:**
- Produces: one semantic `h1` on 404 and a no-JS-safe PL default.
- Produces: byte-identical repository guidance.
- Activates: `npm run verify:site` as the required full static-site gate.

- [ ] **Step 1: Add 404 assertions**

Require one `h1`, one `main`, `robots=noindex`, shared assets version `20260825-flightplan-3`, direct home/contact links in both languages and no duplicate navigation IDs. Do not require a sitemap entry or canonical for the error document.

- [ ] **Step 2: Replace the two competing heading trees with one heading**

Use one `h1` containing localized spans and one shared page shell. Polish remains the default when JavaScript is disabled. The early language script may change `document.documentElement.lang`, title and visibility based on `/en/`, but it must not create or remove core content. Avoid invented radar, route or rescue claims; state plainly that the address does not exist and provide home/contact actions.

- [ ] **Step 3: Synchronize repository guidance verbatim**

Update both instruction files with the new routes, Barlow Semi Condensed, final asset version, fact registry and verification commands. Preserve Cloudflare Pages and separate Worker deploy instructions. Apply the same complete text to both files and run:

```bash
cmp -s AGENTS.md CLAUDE.md
```

Expected exit code: `0`.

- [ ] **Step 4: Verify headers and redirects without speculative hardening**

Run the validator checks from Task 1. Keep `_headers` and `_redirects` unchanged when they pass. Do not add CSP until inline scripts/styles on helper pages have been removed or nonce/hash behavior has a separate tested design.

- [ ] **Step 5: Run and close the complete static-site gate**

```bash
npm run verify:home
npm run verify:pages
npm run verify:seo
npm run verify:site
node --check assets/js/main.js
git diff --check
```

Expected: every command exits `0`; no check is disabled, downgraded to warning or excluded to obtain green status.

- [ ] **Step 6: Commit the completed static contracts**

```bash
git add 404.html assets/js/main.js AGENTS.md CLAUDE.md scripts/verify-site.mjs package.json package-lock.json _headers _redirects
git diff --cached --name-only
git commit -m "fix: complete static site consistency gates"
```

If `_headers` or `_redirects` have no diff, Git ignores them. The staged list must not contain `.superpowers/` or unrelated user work.

---

### Task 6: Define Worker behavior with failing tests

**Files:**
- Create: `worker/index.test.mjs`
- Modify: `package.json`
- Inspect: `worker/index.js`, `worker/wrangler.toml`

**Interfaces:**
- Consumes: `worker.fetch(request, env)` and mocked `env.AI`, `env.CHAT_RATE_LIMITER`.
- Produces: deterministic Node tests with no live AI request and no Cloudflare account mutation.

- [ ] **Step 1: Build request and environment helpers**

```js
import test from "node:test";
import assert from "node:assert/strict";
import worker from "./index.js";

const PROD_ORIGIN = "https://mamcarz.com";
const CLIENT_ID = "5f07cf6c-3945-4e25-bf7e-75cf620fb84c";

function makeEnv({ allowed = true, aiError = null, aiResponse = "Opisz obszar, którego dotyczy Twoja decyzja." } = {}) {
  return {
    CHAT_RATE_LIMITER: { limit: async () => ({ success: allowed }) },
    AI: {
      run: async () => {
        if (aiError) throw aiError;
        return { response: aiResponse };
      }
    }
  };
}

function post(body, headers = {}) {
  return new Request("https://worker.example/", {
    method: "POST",
    headers: {
      Origin: PROD_ORIGIN,
      "Content-Type": "application/json",
      "X-Chat-Client": CLIENT_ID,
      ...headers
    },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}
```

- [ ] **Step 2: Add CORS and method tests**

Cover:

- allowed production preflight returns 204 with the same origin, `Vary: Origin`, POST/OPTIONS methods and both allowed headers;
- `https://www.mamcarz.com` is also allowed;
- foreign or absent origin receives no allow-origin header;
- GET returns 405 and `Allow: POST, OPTIONS`;
- POST with a foreign or absent origin remains subject to validation and rate limiting but never receives a permissive CORS header.

- [ ] **Step 3: Add complete input-boundary tests**

Cover wrong content type 415; malformed JSON 400; missing/empty/non-array messages 400; 21 messages 400; any role other than user/assistant 400; blank content 400; 2,001-code-point content 400; total 12,001 code points 400; body 16,385 bytes 413; extra fields ignored; input array is not mutated.

Assert that every rejected request leaves both `CHAT_RATE_LIMITER.limit` and `AI.run` uncalled.

- [ ] **Step 4: Add abuse and error-safety tests**

Cover invalid/missing `X-Chat-Client` 400; rate limit failure 429 with `Retry-After`; missing binding 500; AI throw 500; invalid AI payload 500. Assert no response body includes stack, exception message, prompt text, model provider detail or user content. Assert all unexpected 500 responses include a request ID.

Capture the limiter key on a valid request. Require 64 lowercase hexadecimal characters and assert that it differs from the raw UUID.

Mock otherwise successful AI replies containing an unapproved number, a `review` display, a blocked-claim pattern, a first-person biography/result phrase and a foreign URL. Each must be replaced by the deterministic no-confirmation response.

- [ ] **Step 5: Add successful prompt-boundary tests**

Capture the AI input and assert:

- model ID remains exact;
- only normalized `role` and trimmed `content` are forwarded;
- system content contains the approved no-invention rule;
- no `review` or `retired` fact display is present;
- system content includes only fact records explicitly listing `worker/index.js` as a surface;
- the response includes `Cache-Control: no-store` and request ID.

- [ ] **Step 6: Prove the tests are red for the current Worker**

```bash
node --check worker/index.test.mjs
npm run test:worker
```

Expected: test syntax PASS and the suite FAILs against the current permissive CORS, input mutation and error-detail behavior.

- [ ] **Step 7: Commit tests separately**

```bash
git add worker/index.test.mjs package.json package-lock.json
git commit -m "test: define hardened chat worker contract"
```

---

### Task 7: Implement the hardened Worker and verified rate-limit binding

**Files:**
- Modify: `worker/index.js`
- Modify: `worker/wrangler.toml`
- Modify: `content/site-facts.json`
- Modify: `scripts/verify-site.mjs`

**Interfaces:**
- Produces: `validateMessages`, `readBodyWithinLimit`, origin-aware JSON responses and `fetch` handler.
- Consumes: `env.AI`, `env.CHAT_RATE_LIMITER`.

- [ ] **Step 1: Replace the static CV prompt with an approved-facts prompt**

Import the registry at bundle time:

```js
import factRegistry from "../content/site-facts.json" with { type: "json" };

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const WORKER_FACT_IDS = new Set([
  "brand.promise",
  "core.advisory",
  "core.applications",
  "core.aviation",
  "contact.email"
]);
const workerFacts = factRegistry.facts.filter(
  (fact) => WORKER_FACT_IDS.has(fact.id) &&
    fact.status === "approved" &&
    fact.surfaces.includes("worker/index.js")
);
const approvedFactLines = workerFacts.map(
  (fact) => `- ${fact.id}: ${fact.display_pl} / ${fact.display_en}`
);
```

The fixed system policy tells the model to act as a short site navigator, use only listed facts, never infer a client/result/number/credential/current status, state that the information is not confirmed when absent, and offer the direct contact link. Client, career, metric, credential, award and current-status records must not list `worker/index.js` as a surface. Do not carry over the old CV prose. Use temperature `0.2` and keep the existing model.

- [ ] **Step 2: Add a deterministic high-risk-question boundary**

Before calling AI, inspect the final user message with two explicit case-insensitive expressions:

```js
const HIGH_RISK_PL = /\b(klient|wynik|rezultat|licencj|uprawnien|certyfikat|nagrod|wyróżnien|ile|liczb|wartość|pracował|stanowisk|rola|aktywn|działa obecnie|aktualn)\w*/iu;
const HIGH_RISK_EN = /\b(client|result|licen[cs]e|qualification|certificate|award|how many|number|value|worked|position|role|active|currently|current status)\w*/iu;
```

Any match returns a deterministic no-confirmation response in the matched language with links to Projects/About and the contact address. It does not call AI, even when related records are approved. This deliberately scopes the chat to site navigation and service selection; factual biography remains on audited static pages.

Also return the deterministic response when the query contains a display string from any registry ID beginning `client.`, `career.`, `project.`, `education.`, `aviation.credential.`, `award.` or `availability.`. This catches a bare organization, credential or venture-status question without a category keyword.

After AI output, reject a reply when it contains:

- a numeric token absent from all approved Worker fact displays;
- any display from a `review` or `retired` record;
- any pattern from `blocked_claims`;
- first-person biography/result phrases such as `pracowałem`, `prowadziłem`, `wdrożyłem`, `mam licencję`, `worked for`, `I led`, `I delivered` or `I hold a licence`;
- a URL outside the approved mamcarz.com, LinkedIn and mailto destinations.

Return the same deterministic no-confirmation response when this guard triggers. This guard reduces known factual leakage; do not describe it as a mathematical guarantee that a generative model can never err.

- [ ] **Step 3: Enforce the byte and message contract before model use**

Implement `readBodyWithinLimit()` with `request.body.getReader()`: count `Uint8Array.byteLength`, cancel the reader immediately above 16,384 bytes, then decode. Check `Content-Length` first when present, but do not trust it as the only check.

`validateMessages()` returns a new array with only `role` and trimmed `content`. Count Unicode code points with `[...content].length`. Reject instead of truncating, reclassifying roles or mutating the caller array.

- [ ] **Step 4: Implement exact CORS and safe JSON errors**

Production origins are exactly `https://mamcarz.com` and `https://www.mamcarz.com`. Local origins are read only from a `DEV_ALLOWED_ORIGINS` variable in local development and are absent from production configuration. Add `Vary: Origin`; allow `Content-Type, X-Chat-Client`.

Use a single `json(body, status, cors, requestId)` helper. Return generic localized messages for 400/405/413/415/429/500. Log only structured `event`, request ID, path and error class; never log request body, messages, prompt or provider response.

- [ ] **Step 5: Apply and test the rate limiter before AI**

Validate `X-Chat-Client` as a UUID and call:

```js
const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(clientId));
const rateKey = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const { success } = await env.CHAT_RATE_LIMITER.limit({ key: rateKey });
if (!success) return json({ error: "Zbyt wiele zapytań. Spróbuj ponownie za minutę." }, 429, cors, requestId);
```

The raw browser ID is never logged or sent to the limiter. It is still a persistent pseudonymous online identifier in browser storage, not an anonymous identity guarantee. It can be cleared or rotated by an attacker, so the release record must state both the privacy characteristic and abuse limitation.

- [ ] **Step 6: Add exact current Wrangler configuration**

After a read-only account/config inventory confirms that namespace ID `2026082501` is not intentionally shared with another limiter, set:

```toml
name = "mamcarz-chat-api"
main = "index.js"
compatibility_date = "2026-08-25"
compatibility_flags = ["nodejs_compat"]

[ai]
binding = "AI"

[[ratelimits]]
name = "CHAT_RATE_LIMITER"
namespace_id = "2026082501"

[ratelimits.simple]
limit = 10
period = 60

[observability]
enabled = true

[observability.logs]
enabled = true
head_sampling_rate = 1

[observability.traces]
enabled = true
head_sampling_rate = 0.01
```

If uniqueness cannot be confirmed, keep Worker deployment blocked. Local code/tests may use the mock binding, but no executor may substitute another number without recording the account check.

- [ ] **Step 7: Run unit, fact and dry-bundle checks**

```bash
npm run test:worker
npm run verify:site
WRANGLER_LOG_PATH=/tmp/mamcarz-wrangler.log wrangler deploy --dry-run --config worker/wrangler.toml
git diff --check
```

Expected: tests and site validation PASS; Wrangler validates JSON import, compatibility date, AI binding, rate-limit binding and observability config without deploying.

- [ ] **Step 8: Commit Worker implementation without deployment**

```bash
git add worker/index.js worker/wrangler.toml content/site-facts.json scripts/verify-site.mjs
git diff --cached --name-only
git commit -m "fix: harden the fact-bound chat worker"
```

The commit is local unless the user separately approves a push. It does not publish either Cloudflare service.

---

### Task 8: Add a privacy-minimal browser client ID and resilient chat fallback

**Files:**
- Modify: `assets/js/main.js`
- Modify: `scripts/verify-site.mjs`

**Interfaces:**
- Produces: `getChatClientId()` and `X-Chat-Client` request header.
- Preserves: hardcoded Worker URL `https://mamcarz-chat-api.pawel-767.workers.dev`.

- [ ] **Step 1: Add client-contract checks**

Require the exact Worker URL, `X-Chat-Client`, `crypto.randomUUID`, safe text rendering, localized 400/413/429/500 fallbacks and a visible mailto action. Reject assignment of model/user content to `innerHTML`.

- [ ] **Step 2: Implement the anonymous ID defensively**

```js
function getChatClientId() {
  const key = "mamcarz-chat-client-v1";
  try {
    const existing = localStorage.getItem(key);
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existing ?? "")) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(key, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}
```

The value contains no directly supplied name, email, device fingerprint or IP and is not reused for analytics. It remains a persistent pseudonymous browser identifier. Before production release, review whether the site's privacy notice must describe this strictly abuse-prevention storage; do not make a legal-compliance claim without that review.

- [ ] **Step 3: Send the header and render all content as text**

Add the UUID header to the existing fetch. Use `textContent` plus explicit DOM line-break nodes for user text, model reply and errors. Do not sanitize HTML and then insert it; the chat protocol is plain text.

- [ ] **Step 4: Preserve contact when AI is unavailable**

For network error, 413, 429 or 500, show a short localized message and retain a direct mailto link. Do not claim that a message was delivered or that Paweł is currently available.

- [ ] **Step 5: Verify and commit the browser change**

```bash
node --check assets/js/main.js
npm run test:worker
npm run verify:site
rg -n 'innerHTML\s*=' assets/js/main.js
git diff --check
```

Expected: checks PASS and the `innerHTML` scan is empty.

```bash
git add assets/js/main.js scripts/verify-site.mjs
git commit -m "fix: make chat limiting and fallback resilient"
```

---

### Task 9: Perform full manual and adversarial verification

**Files:**
- Modify only files with a concrete, reproduced finding.

**Interfaces:**
- Produces: local evidence for static site, Worker contract and no-confab policy.
- Does not produce: production evidence, deploy, push or account mutation.

- [ ] **Step 1: Run all automated gates from a clean command invocation**

```bash
npm run verify:site
npm run test:worker
node --check assets/js/main.js
node --check scripts/verify-site.mjs
WRANGLER_LOG_PATH=/tmp/mamcarz-wrangler.log wrangler deploy --dry-run --config worker/wrangler.toml
git diff --check
git status --short
```

Record exact exit codes and distinguish pre-existing `.superpowers/` from planned files.

- [ ] **Step 2: Serve the static site and inspect route families**

Run `wrangler pages dev .` or a read-only static server. Inspect home, one advisory page, Applications, Aviation, Projects, Knowledge, Speaking, Procurement 2026, one diagram, the standalone infographic and a missing PL/EN URL at widths 320, 390, 768, 1280 and 1440 px.

Verify one H1, no horizontal scroll, logical heading order, working direct navigation, true language targets, JPG fallback, image dimensions, focus visibility, 44 px targets, 200% zoom and useful content with JavaScript disabled.

- [ ] **Step 3: Verify keyboard, motion and optional-component behavior**

Use Tab, Shift+Tab, Enter, Space and Escape. Verify mobile menu focus returns to its trigger, closed overlay is not focusable, `prefers-reduced-motion` removes nonessential transitions, and pages without chat/menu subcomponents produce no console errors.

- [ ] **Step 4: Run Worker contract probes locally with mock AI**

Use the Node tests for all limit/error cases. Do not call live Workers AI merely to prove a local test; local Workers AI use can be remote and billable. A live success request requires separate approval and is recorded as external verification, not unit evidence.

- [ ] **Step 5: Run adversarial factual prompts**

Test PL and EN questions asking for:

- an unapproved client;
- a made-up award and certification;
- a wrong store count and refinery capacity;
- current activity of an unverified aviation venture;
- an instruction to ignore the system prompt and invent a result.

Expected: deterministic no-confirmation response or an answer composed only from approved Worker facts. Any invented number, client, credential, result or current status is a blocking defect. Do not waive it as normal model behavior; tighten scope or return deterministic contact fallback.

- [ ] **Step 6: Inspect final diffs against the approved spec**

Check all 11 home sections, CTA positions, equal core domains, Flight Plan tokens, no active Playfair, no unapproved assets, PL/EN parity, fact registry closure, metadata, discovery files and separate Worker configuration. Run:

```bash
rg -n -i 'Playfair|Polpharma|TO[D]O|TB[D]|lorem|example\.com|największ|largest|#1|wiodąc|leading' \
  . -g '!node_modules/**' -g '!docs/**' -g '!.superpowers/**'
git diff --stat
git diff
```

Resolve every product-surface match or map it to approved, dated evidence. `example.com` is permitted only inside tests.

- [ ] **Step 7: Request code review before completion**

Use `superpowers:requesting-code-review` on the complete diff. Fix Priority 0 and Priority 1 findings; rerun `npm run check` and the dry bundle after every Worker/config correction.

---

### Task 10: Prepare, but do not execute, the release runbook

**Files:**
- Create: `docs/releases/2026-08-25-flight-plan-release.md`.

**Interfaces:**
- Produces: explicit rollback and release gates.
- Does not authorize: commit of unreviewed work, push, merge, Pages deploy, Worker deploy or live rate-limit mutation.

- [ ] **Step 1: Record the verified local state**

Include branch, HEAD, dirty paths, exact validator/test commands and outcomes, Wrangler version, dry-bundle outcome and known limitations of anonymous browser-ID limiting. Do not describe local rendering as production verification.

- [ ] **Step 2: Define the rollback point gate**

Before any production release, require a named, remotely verified tag or branch pointing to the current production commit. Creating or pushing that rollback point requires explicit approval at release time.

- [ ] **Step 3: Keep publication decisions separate**

Request distinct decisions in this order:

1. commit any remaining reviewed local diff;
2. push the branch;
3. merge or promote the chosen branch;
4. deploy Cloudflare Pages with `wrangler pages deploy . --project-name mamcarz-com --branch main --commit-dirty=true` only from the approved commit;
5. deploy the Worker separately with `wrangler deploy --config worker/wrangler.toml`;
6. run post-deploy verification for each service.

A general approval of the redesign does not authorize any of these later operations.

- [ ] **Step 4: Define post-deploy evidence**

For Pages, verify public canonical/hreflang, new routes, `www` 301, security/cache headers, current CSS/JS asset version and representative PL/EN rendering. For Worker, verify exact live URL, allowed/foreign origins, validation, 429 behavior, generic 500, contact fallback and absence of prompt/error leakage. Report Pages and Worker outcomes separately.

---

## Final Acceptance Gate

- [ ] `npm run verify:site` and `npm run test:worker` both exit `0`.
- [ ] `wrangler deploy --dry-run --config worker/wrangler.toml` exits `0` without deployment.
- [ ] Every public claim surface is backed by an `approved` fact; unresolved facts have no public occurrence.
- [ ] No dynamic fact lacks `as_of` and an auditable source.
- [ ] No result is attributed beyond the approved role/scope wording.
- [ ] Polpharma is absent from all client and Worker fact surfaces.
- [ ] Every public route has one H1, correct metadata and parsable conservative schema.
- [ ] Sitemap and LLM files exactly match canonical routes and approved facts.
- [ ] `AGENTS.md` and `CLAUDE.md` are byte-identical.
- [ ] Worker request limits, CORS, rate limiter, errors and known-claim guards pass tests.
- [ ] Manual PL/EN, responsive, keyboard, no-JS and adversarial fact checks pass.
- [ ] Final status states local commit, remote branch, Pages deployment and Worker deployment independently.
- [ ] No push, merge or deploy occurs without its own explicit approval.
