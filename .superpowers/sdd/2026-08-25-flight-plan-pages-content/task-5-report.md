# Task 5 report: bilingual advisory service dossiers

## Scope and truth boundary

- Migrated all three Polish service pages and their exact English mirrors to the Flight Plan v2 shell: procurement transformation, SAP Ariba implementation and public procurement advisory.
- Each document has one direct visible sequence: `problem`, `fit`, `scope`, `method`, `evidence`, `contact`; one bounded `Service` JSON-LD object; one contextual primary CTA; exact canonical, hreflang and paired-language navigation.
- The shared visual system is an advisory engagement dossier: ruled sections, a numbered engagement register and evidence rows. It is not a card grid and adds no gradient, shadow, glow, glass, blur, decorative image or motion system.
- No asset or image was added or changed. Each page retains only the existing footer signature image.
- Claims not explicitly approved were omitted, including 500M PLN/year, 100M+ tender, savings/results, rankings or superlatives, awards, Gold Partner, All for One, March 2026, Marketplanet, current-law/value assertions, unsupported clients and Polpharma.

## Exact rendered fact inventory

The public fact registry contains exactly 22 approved service-surfaced records. Every record has `source_type: owner_verified`, `source_url: null` and exactly the two corresponding PL/EN service surfaces.

### Procurement transformation: 9 facts

1. `career.pzu.organization`: `PZU S.A.`
2. `career.pzu.title`: PL `Dyrektor Projektu Strategicznego`; EN `Strategic Project Director`
3. `career.pzu.responsibility`: PL `Prowadziłem projekt transformacji zakupów, od analizy wydatków do docelowego modelu operacyjnego.`; EN `I led a procurement transformation project from spend analysis to the target operating model.`
4. `career.pwc.organization`: `PwC Polska Sp. z o.o.`
5. `career.pwc.title`: PL `Wicedyrektor w Advisory / Procurement Expert`; EN `Associate Director, Advisory / Procurement Expert`
6. `career.pwc.responsibility`: PL `Pracowałem z metodyką CAPP (Complete & Agile Procurement).`; EN `I worked with the CAPP (Complete & Agile Procurement) methodology.`
7. `project.orlen.role`: PL `Kierownik projektu CONNECT`; EN `CONNECT Project Manager`
8. `project.orlen.platform_scope`: PL `Centralna platforma sourcingowa dla Grupy ORLEN`; EN `Central sourcing platform for the ORLEN Group`
9. `project.orlen.connect_scope`: PL `15 spółek Grupy ORLEN w 4 krajach, 60-osobowy zespół`; EN `15 ORLEN Group entities across 4 countries, 60-person team`

The reference to four countries is the exact approved immutable ORLEN fact. No other country claim occurs in the Ariba or public-procurement pair.

### SAP Ariba implementation: 9 facts

1. `hero.implementations`: `20+`
2. `project.kghm.role`: PL `Realizacja wdrożenia i integracji`; EN `Implementation and integration delivery`
3. `project.kghm.scope`: PL `Sourcing i obsługa pracowników zewnętrznych`; EN `Sourcing and external workforce management`
4. `project.kghm.integration`: PL `SAP Ariba Sourcing i Fieldglass zintegrowane z SAP S/4HANA`; EN `SAP Ariba Sourcing and Fieldglass integrated with SAP S/4HANA`
5. `project.zabka.role`: PL `Realizacja wdrożenia SAP Ariba`; EN `Delivery of the SAP Ariba implementation`
6. `project.zabka.implementation`: PL `Zakupy, ryzyko dostawców i sourcing`; EN `Procurement, supplier risk and sourcing`
7. `project.zabka.proof`: PL `SAP Ariba Buying, Supplier Risk i sourcing`; EN `SAP Ariba Buying, Supplier Risk and sourcing`
8. `project.lot.implementation`: PL `Wdrożenie SAP Ariba dla PLL LOT`; EN `SAP Ariba implementation for PLL LOT`
9. `project.motor_oil.implementation`: PL `Wdrożenie SAP w obszarze zakupów dla Motor Oil Hellas`; EN `SAP procurement implementation for Motor Oil Hellas`

### Public procurement advisory: 4 facts

1. `career.pkp_plk.organization`: `PKP Polskie Linie Kolejowe S.A.`
2. `career.pkp_plk.dates`: `06.2013 – 09.2015`
3. `career.pkp_plk.title`: PL `Doradca Zarządu`; EN `Board Advisor`
4. `career.pkp_plk.responsibility`: PL `Negocjowałem umowę ramową z SAP AG dla grupy PKP.`; EN `I negotiated an SAP AG framework agreement for the PKP Group.`

## SAP product taxonomy and official-source note

The product vocabulary is limited to these seven approved names: `SAP Ariba Sourcing`, `SAP Ariba Contracts`, `SAP Ariba Buying and Invoicing`, `SAP Ariba Supplier Lifecycle and Performance`, `SAP Ariba Supplier Risk`, `SAP Fieldglass` and integration with `SAP S/4HANA`.

The controller verified the official SAP naming on 2026-08-26. The implementer did not browse externally and used only the source URLs supplied in the approved brief:

- <https://help.sap.com/docs/strategic-sourcing/sap-ariba-product-sourcing-guide/sap-ariba-strategic-sourcing-suite>
- <https://www.sap.com/products/spend-management/procure-to-pay.html>
- <https://www.sap.com/products/spend-management/supplier-risk.html>
- <https://www.sap.com/products/hcm/about-fieldglass.html>

## TDD evidence

### Legacy-family RED

Before changing product pages, the focused Task 5 run produced the required real legacy failure:

```text
Plan 2 Task 5 focused: 3 tests, 3 failures, exit 1
services family: Task 5 contract errors against the six legacy documents
```

The test contract was built from immutable, spec-backed manifests rather than current page bytes or the mutable fact registry. It pins per-page document/resources/shell/content/fact/control/schema surfaces, section and evidence order, exact CTA cardinality and raw closed shell state. Coordinated page-plus-registry drift, hidden/comment/entity/inline-split claims and extra schema fields all fail.

### Pair-by-pair GREEN

Each pair was migrated separately. The first post-product failure for each pair was only its expected independent full-document digest mismatch; after recording the approved document, the pair and carried service-family checks passed.

An additional inline `Pol<span>pharma</span>` mutation produced a real isolated RED because the initial canonical claim scanner did not join rendered text tightly enough. Compact canonical text scanning closed that bypass. A raw shell-state mutation then produced its own RED and was covered by a dedicated shell contract. A fixture mutation that searched pretty-printed `"provider": {` initially failed against the minified product `"provider":{`; the fixture target was corrected without weakening product or verifier rules.

### Integration failures and correction

The first full run after migration exposed the old foundation classifier still treating the Ariba page as legacy navigation. The classifier was narrowed so all six service pages are owned only by the v2 service contract while the real legacy 404 remains enforced. The next full run found three fixture `ENOENT` failures because complete-manifest fixtures did not materialize the six new public service surfaces; fixture generation was corrected to use the immutable products and current fact registry.

Fresh final result after the shared mobile H1 correction:

```text
Full verifier: 529/529, 0 failures, exit 0, 53.96 s
npm run verify:pages -- --family=services: OK, exit 0
npm run verify:pages -- --family=knowledge: OK, exit 0
npm run verify:pages -- --family=aviation: OK, exit 0
npm run verify:pages -- --family=applications: OK, exit 0
npm run verify:home: OK, exit 0
npm run verify:facts: OK, exit 0
npm run verify:foundation: OK, exit 0
npm run verify:site: OK, exit 0
node --check scripts/verify-site.mjs: exit 0
node --check scripts/verify-site.test.mjs: exit 0
node --check assets/js/main.js: exit 0
git diff --check: exit 0
```

## Browser matrix

The real in-app Browser inspected every route at both required viewports on a server bound only to `127.0.0.1:4173`. Each inspection included a full-page screenshot, document overflow, element overflow, section overlap, all six sections, evidence order, CTA count, active route, language href, shell state and warning/error console state.

| Route | 390 x 844 | 1280 x 900 |
| --- | --- | --- |
| `/uslugi/transformacja-zakupow/` | pass | pass |
| `/en/uslugi/transformacja-zakupow/` | pass | pass |
| `/uslugi/wdrozenie-sap-ariba/` | pass | pass |
| `/en/uslugi/wdrozenie-sap-ariba/` | pass | pass |
| `/uslugi/doradztwo-zamowienia-publiczne/` | pass | pass |
| `/en/uslugi/doradztwo-zamowienia-publiczne/` | pass | pass |

All twelve cells had `scrollWidth = clientWidth`, no overflowing descendants, no clipping or occlusion, no overlapping direct sections, exact evidence order, one visible CTA and zero console warnings/errors. The initial EN Ariba mobile screenshot showed the final `n` of `implementation` isolated on its own line. A service-scoped mobile title size corrected the wrap; all six mobile routes were then re-inspected after the shared CSS change and remained clean.

The shared-shell sample also passed: keyboard Tab exposed the skip link; Enter opened the mobile menu and overlay with `aria-expanded=true`; the advisory disclosure opened and exposed its submenu; Enter closed the menu; the paired PL language link navigated to the exact route. Logs stayed empty. The viewport override was reset, the tab was closed and the local server was stopped.

## Zero-hit scans and residuals

- All six service documents returned zero matches for Polpharma, PGE, PGNiG, 500M, 100M, Marketplanet, Gold Partner, All for One, March 2026, award/ranking/superlative/guarantee wording, savings, current-law/statutory-threshold/legal-compliance/legal-advice wording and generic AI-copy phrases.
- All six returned zero inline styles, document `<style>` blocks, display `<em>` elements and em-dash entities.
- Service-scoped CSS returned zero gradients, shadows, glow, glass, blur or backdrop filters.
- Ariba and public-procurement pages returned zero country references.
- The image inventory is exactly six occurrences of the pre-existing `/assets/img/signature.png`, one in each footer. This is the only image residual.
- The exact approved ORLEN `4 krajach` / `4 countries` fact is the only intentional country residual across the service family.

## Commits and release boundary

Implementation commits before this report:

1. `10736f963e4ec1a8281933ef66c4ef590103b3a6` — `feat: migrate procurement transformation pages`
2. `5dfdc96870612e1fc9e2805a1917566014e6b318` — `feat: migrate SAP Ariba service pages`
3. `0074b1e1056aed30b194abdeb41e5c9f2d92d1d2` — `feat: migrate public procurement pages`
4. `2b574141a7838ee9a079a4b2eba599aaa073edfe` — `test: harden advisory service contracts`

No push, merge, deployment, production access, asset generation or external-site access occurred.

## Fix round 1: exact service registry ownership

This review round changed only `scripts/verify-site.mjs`, `scripts/verify-site.test.mjs` and this report. The six service HTML files, `assets/css/style.css`, `content/site-facts.json` and `assets/js/main.js` remain byte-identical to `c71fe35007338af686dc7e6ec375e294d1a29afb`. Browser inspection was therefore not repeated.

### Dedicated RED

Three real registry reproductions were written before the verifier change. Each required the new dedicated `service-registry-inventory` ID in `pages/services`, `facts` and `scope=all`:

```text
unrelated brand.promise authorized for a transformation surface: fail
new approved client.fabricated authorized for both transformation surfaces: fail
missing, typo, duplicate or reordered service entry in public_claim_surfaces: fail
Fix round 1 focused: 0/3, exit 1
```

The first RED output also reported missing local fixture assets during the pages run. These did not satisfy or mask the dedicated assertion. The production-registry fixture was completed with the existing favicon, font and signature targets before final GREEN; no product asset changed.

### Implemented contract

- The exact six service paths and their approved fact-ID sets are derived from immutable `SERVICE_FACT_CONTRACT` data.
- Every registry record is reverse-scanned for each service path. Each actual fact-ID multiset must equal the immutable approved set, so unrelated, fabricated and duplicate authorizations fail.
- Every immutable Task 5 record must occur once and retain its exact complete `surfaces` array, including its legitimate non-service surfaces.
- `public_claim_surfaces` must equal the exact ordered service-aware inventory: the existing home, application, aviation, LLMS, worker and browser-script surfaces plus the six service paths. Missing, extra, typo, duplicate and reordered entries fail.
- Explicit `pages/services` and `pages/all` verification always requires the contract. Under `facts` and `scope=all`, Task 5 applicability is derived independently from the complete six-document service context; fixtures without that document context remain governed by their existing contracts.

### GREEN and carried verification

```text
Fix round 1: 3/3, exit 0
Task 5 including prior mutations: 6/6, exit 0
Task 4: 18/18, exit 0
Task 3: 10/10, exit 0
Task 2: 34/34, exit 0
Task 1: 36/36, exit 0
Full verifier: 532/532, 0 failures, exit 0, 57.14 s
```

Fresh family and repository gates all returned exit 0:

```text
npm run verify:pages -- --family=services
npm run verify:pages -- --family=knowledge
npm run verify:pages -- --family=aviation
npm run verify:pages -- --family=applications
npm run verify:home
npm run verify:facts
npm run verify:foundation
npm run verify:site
node --check scripts/verify-site.mjs
node --check scripts/verify-site.test.mjs
node --check assets/js/main.js
git diff --check
```

No push, merge, deployment, production access, external browsing, asset work or product Browser mutation occurred.

## Fix round 2: wholesale registry-removal closure

This round changed only the verifier, its mutation tests and this report. The six service HTML files, shared CSS, `content/site-facts.json` and browser JavaScript remain byte-identical to `d6ee67d607ed9b49848a080769b6d81803ef0ead`; Browser was not repeated.

### Wholesale-removal RED

A complete Task 5 fixture removed all 22 immutable service fact records and all six service entries from `public_claim_surfaces`. Existing page-level checks noticed missing fact records, but the dedicated registry inventory remained silent because its activation depended on the same mutable state being removed:

```text
pages/services: no service-registry-inventory
pages/all: no service-registry-inventory
facts: no errors
scope=all: no service-registry-inventory
Fix round 2: 0/1, exit 1
```

The assertion collected all four missing scopes before failing, so an earlier page-level or fixture error could not mask the absent dedicated inventory error.

### Independent activation

- `pages/services` and `pages/all` force `service-registry-inventory` from the immutable selected family contract, regardless of mutable registry contents.
- `facts` and `scope=all` establish Task 5 applicability by checking that all six exact paths from immutable `SERVICE_SURFACE_LIST` exist as files beneath the verification root.
- Registry content is evaluated only after this independent activation decision. Removing every service record and public surface can therefore no longer disable the guard.
- Partial or legacy fixtures without the complete six-document context retain their pre-Task-5 facts behavior; explicit service page scopes still fail according to their selected family contract.

### GREEN and carried verification

```text
Fix round 2: 1/1, exit 0
Task 5 including prior mutations: 7/7, exit 0
Task 4: 18/18, exit 0
Task 3: 10/10, exit 0
Task 2: 34/34, exit 0
Task 1: 36/36, exit 0
Full verifier: 533/533, 0 failures, exit 0, 53.03 s
```

All service, Knowledge, aviation, application, home, facts, foundation and full-site gates; verifier/test/browser-script syntax checks; prohibited-claim scans; `git diff --check`; and frozen-product identity checks returned exit 0. No product, registry, CSS, browser JavaScript or asset byte changed.

No push, merge, deployment, production access, external browsing or Browser rerun occurred.
