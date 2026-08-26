# Task 2 report: Operational Applications PL/EN

Date: 2026-08-26

## Content decisions

- Created the route pair `/aplikacje-operacyjne/` and `/en/aplikacje-operacyjne/` with `data-page="applications"` and the direct section order `problem`, `delivery`, `evidence`, `fit`, `contact`.
- Kept the exact approved H1 and opening lead in each language.
- Used ruled domain and fit ledgers instead of a card grid. Procurement, field service and aviation appear only as method domains.
- Used one route line for the real sequence Discovery, data model, workflow and launch. No other route motif appears on either page.
- Limited evidence to three products and six approved fact IDs: `portfolio.czympojade_pl`, `portfolio.przypominamy_com`, `portfolio.procuracost` and their `.type` records. Each row renders the exact localized displays and the PL/EN row order is identical.
- Kept product evidence as plain text because no approved external URL is registered for these records. The copy makes no status, ownership, user, result or named delivery assertion.
- Added both application page paths to every rendered record and to `public_claim_surfaces`.
- Limited each Service JSON-LD object to localized name, exact page URL, claim-safe localized description and provider Paweł Mamcarz.
- Reused the shared v2 navigation, language switch, footer, stylesheet and browser-script contracts. All substantive content remains visible without JavaScript.

## TDD record

Focused RED:

- Command: `node --test --test-name-pattern='Plan 2 Task 2' scripts/verify-site.test.mjs`
- Result before the contract implementation: 10 tests, 1 pass, 9 fail.
- Live missing-page command: `npm run verify:pages -- --family=applications`.
- Live RED result: 20 errors, comprising 2 missing route files and 18 shell errors.

Focused GREEN:

- Command: `node --test --test-name-pattern='Plan 2 Task 2' scripts/verify-site.test.mjs`
- Result: 10 tests, 10 pass, 0 fail.
- The parsed contract covers exact localized identity and lead, five direct active sections and order, delivery sequence, direct active Service JSON-LD, forbidden schema fields and decoys, evidence IDs and localized values, paired surfaces, ordered PL/EN parity, localized mailto intent, forbidden positioning and copy, and visible review or retired meanings.

### Fix round 1

Focused RED:

- Command: `node --test --test-name-pattern='Plan 2 Task 2 fix round 1' scripts/verify-site.test.mjs`.
- Result before verifier hardening: 8 tests, 1 pass, 7 fail.
- The seven failing groups reproduced mutable-registry evidence drift, unregistered evidence links, unsupported claims inside and outside evidence, body/footer/metadata copy injection, global CTA and route-sequence duplication, active inline styles, and incomplete or decoy-rescued navigation.

Focused GREEN:

- The same command passes 8 tests, 8 pass, 0 fail.
- The complete Task 2 focus passes 18 tests, 18 pass, 0 fail.
- An immutable verifier-owned evidence contract now pins three ordered rows, six ordered IDs, exact pairings, exact PL/EN literals and leaf structure. The registry is independently cross-checked against that contract, including approval state and both application surfaces.
- Exact main, metadata, body, footer and navigation contracts prevent registry-coordinated copy drift and additional page-owned claims. Evidence links require the exact non-null `source_url` of an approved associated record; the committed rows therefore remain plain text.
- Global active counts cover the single primary CTA and single delivery route. Every active application-page element is checked for inline style. Navigation verification is scoped to the real `site-nav` and pins its toggle, menu, overlay, native Advisory disclosure, localized routes and labels, current-page state and language switch.
- Five generic Task 1 parser positives were moved to an unfinished-family fixture so they continue testing generic URL and fact-token behavior without weakening the intentional exact application contract. Task 1 passes 36 tests, 36 pass, 0 fail.

## Verification gates

- `npm run verify:pages -- --family=applications`: PASS.
- `npm run verify:home`: PASS.
- `npm run verify:facts`: PASS.
- `npm run verify:foundation`: PASS.
- `npm run verify:site`: PASS.
- `npm run test:verify-site`: PASS, 483 tests, 483 pass, 0 fail.
- `node --check scripts/verify-site.mjs`: PASS.
- `node --check scripts/verify-site.test.mjs`: PASS.
- `node --check assets/js/main.js`: PASS.
- Exact forbidden-copy scan from the task brief: empty.
- Broader generic positioning, AI-tell, blocked client, retired name and forbidden schema-field scan: empty.
- Page inline-style, gradient, shadow and blur scan: empty.
- CSS diff inspection: existing tokens only, no escaped selectors or banned constructs; desktop ledger grids collapse to one column at `max-width: 759px`.
- Local-link inspection: the pair uses the exact shared route manifest and the paired language links; family-owned future routes remain bounded by verifier family isolation.
- Fact-surface inspection: all six rendered IDs list both application paths and both pages use the same ordered ID pairs.
- Fix-round diff inspection: the PL/EN product pages, shared CSS, registry and browser script are unchanged from `ee98910d3369d7b91c085f844d49cf8c0f9c4273`; only the verifier, verifier tests and this report changed.
- The prior local Chrome review was not repeated because no product or stylesheet file changed in fix round 1.

## Limitations

- No external product links were added because the selected fact records do not register approved URLs.
- Verification was local and static. No push, merge, deployment or production access was performed.
