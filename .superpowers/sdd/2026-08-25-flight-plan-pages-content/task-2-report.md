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

## Verification gates

- `npm run verify:pages -- --family=applications`: PASS.
- `npm run verify:home`: PASS.
- `npm run verify:facts`: PASS.
- `npm run verify:foundation`: PASS.
- `npm run verify:site`: PASS.
- `npm run test:verify-site`: PASS, 475 tests, 475 pass, 0 fail.
- `node --check scripts/verify-site.mjs`: PASS.
- `node --check assets/js/main.js`: PASS.
- Exact forbidden-copy scan from the task brief: empty.
- Broader generic positioning, AI-tell, blocked client, retired name and forbidden schema-field scan: empty.
- Page inline-style, gradient, shadow and blur scan: empty.
- CSS diff inspection: existing tokens only, no escaped selectors or banned constructs; desktop ledger grids collapse to one column at `max-width: 759px`.
- Local-link inspection: the pair uses the exact shared route manifest and the paired language links; family-owned future routes remain bounded by verifier family isolation.
- Fact-surface inspection: all six rendered IDs list both application paths and both pages use the same ordered ID pairs.

## Limitations

- No external product links were added because the selected fact records do not register approved URLs.
- Verification was local and static. No push, merge, deployment or production access was performed.
