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

1. `career.pkp.organization`: `PKP Polskie Linie Kolejowe S.A.`
2. `career.pkp.dates`: `06.2013 – 09.2015`
3. `career.pkp.title`: PL `Doradca Zarządu`; EN `Board Advisor`
4. `career.pkp.responsibility`: PL `Negocjowałem umowę ramową z SAP AG dla grupy PKP.`; EN `I negotiated an SAP AG framework agreement for the PKP Group.`

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
