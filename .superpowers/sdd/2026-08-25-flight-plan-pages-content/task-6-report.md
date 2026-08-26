# Task 6 report: bilingual Projects evidence register

## Scope and truth boundary

- Rebuilt `/case-studies/` and `/en/case-studies/` as the visible `Projekty` / `Projects` pair in the Flight Plan system.
- The pages expose exactly three direct groups in this order: `advisory`, `applications`, `aviation`; exactly 12 project rows; and exactly 31 approved fact records.
- The composition is a ruled evidence register with identifier rails and labelled fact lines. It has no card grid, logo wall, screenshot, image, external project link, gradient, shadow, glow or glass effect.
- Each page has one bounded `CollectionPage` whose `mainEntity` is one `ItemList` with exactly 12 visible names, positions and local fragment URLs. No role, result, status, date, description, image, rating or offer is present in an item.
- The only current/status claim is `portfolio.akrobacja_com.current_status`, displayed with the exact date `2026-08-26`. FilmoLot and the other ten projects have no status.
- WarsawFlightSafety and Polpharma do not occur. No result, completion state, ownership, ranking, current organization metric or other unsupported conclusion was inferred.
- No asset was added or changed. No push, merge, deployment, production access or external browsing occurred.

## Exact project and fact inventory

The visible project order is identical in PL and EN:

1. `orlen`: `client.orlen`, `project.orlen.role`, `project.orlen.platform_scope`, `project.orlen.connect_scope`
2. `zabka`: `client.zabka_polska`, `project.zabka.role`, `project.zabka.implementation`, `project.zabka.proof`
3. `kghm`: `client.kghm`, `project.kghm.role`, `project.kghm.scope`, `project.kghm.integration`
4. `pll-lot`: `client.pll_lot`, `project.lot.implementation`
5. `motor-oil-hellas`: `client.motor_oil_hellas`, `project.motor_oil.implementation`
6. `czympojade`: `portfolio.czympojade_pl`, `portfolio.czympojade_pl.type`
7. `przypominamy`: `portfolio.przypominamy_com`, `portfolio.przypominamy_com.type`
8. `procuracost`: `portfolio.procuracost`, `portfolio.procuracost.type`
9. `procurement-process-2026`: `portfolio.procurement_process_2026`, `portfolio.procurement_process_2026.type`
10. `silence-tax`: `portfolio.silence_tax`, `portfolio.silence_tax.type`
11. `akrobacja`: `portfolio.akrobacja_com`, `portfolio.akrobacja_com.current_status`, `portfolio.akrobacja_com.type`
12. `filmolot`: `portfolio.filmolot_pl`, `portfolio.filmolot_pl.type`

The registry now authorizes both Projects pages for these 31 facts and adds the two pages to the ordered `public_claim_surfaces` list. The verifier independently activates and compares the exact reverse surface-to-fact inventory, including when all 31 fact records and both public surfaces are removed together.

## TDD evidence

### Legacy-pages RED

Focused Task 6 tests were added before product changes and run against the legacy pair:

```text
node --test --test-name-pattern='Plan 2 Task 6' scripts/verify-site.test.mjs
tests 2
pass 0
fail 2
exit 1
```

The first test failed because the dedicated Task 6 contract errors were absent. The second failed because the legacy documents did not satisfy the exact v2 Projects shell and evidence-register contract.

### GREEN and mutation coverage

After implementation, the focused Task 6 run was:

```text
tests 5
pass 5
fail 0
exit 0
```

The focused tests cover exact identity, direct groups, project/fact order and literals, status/date, schema, resources, forbidden claims and exact positive acceptance. They also exercise coordinated page-plus-registry drift, promotion of reviewed facts, public-surface reordering, and wholesale removal of all 31 selected facts plus both Projects surfaces.

Carried Plan 2 Tasks 1 through 6 passed together:

```text
tests 110
pass 110
fail 0
exit 0
```

The fresh full suite result was:

```text
tests 538
pass 538
fail 0
exit 0
duration_ms 49670.307667
```

## Repository gates and scans

All required family and repository gates returned exit 0:

```text
npm run verify:pages -- --family=projects
npm run verify:pages -- --family=services
npm run verify:pages -- --family=knowledge
npm run verify:pages -- --family=aviation
npm run verify:pages -- --family=applications
npm run verify:home
npm run verify:facts
npm run verify:foundation
npm run verify:site
```

Additional checks returned exit 0:

```text
node --check scripts/verify-site.mjs
node --check scripts/verify-site.test.mjs
JSON.parse(content/site-facts.json)
git diff --check
```

Both Projects documents report exactly 12 `data-project-id` rows, 31 `data-fact-id` values, one `time` element with `datetime="2026-08-26"`, zero images and zero inline styles. Page scans returned zero hits for WarsawFlightSafety, Polpharma, blocked dynamic numbers/rankings/LOT-national-status language, em dashes, images, iframes and inline styles. Projects-scoped CSS returned zero hits for gradients, shadows, glow, glass, backdrop filters and related visual effects.

## Browser matrix

Connected Chrome inspected the local server at `127.0.0.1:4173` using the approved localhost fallback.

| Route | 390 x 844 | 1280 x 900 |
| --- | --- | --- |
| `/case-studies/` | pass | pass |
| `/en/case-studies/` | pass | pass |

All four cells showed the localized H1, exact three-group order, exact 12-project order, 31 rendered facts, one dated Akrobacja status, one CTA, no images, no external main-content anchors, no document overflow, no clipped rows and no console errors. The paired-language links were `/en/case-studies/` and `/case-studies/` respectively.

At both mobile routes, Tab focused the visible skip link; the disclosure button changed `aria-expanded` from `false` to `true`, and Escape restored `false`. The PL `#aviation` group anchor resolved with the section top at approximately 96 px below the sticky navigation. The static contract confirms the same exact anchor inventory in EN and preserves full no-JavaScript readability.

The first PL desktop inspection exposed a CTA title collision: rendered text reached x=555 while the second column began at x=541. The grid was corrected from a 0.8/1.2 split to equal bounded columns. The final measurement put the title at x=624 and the second column at x=656; final PL and EN CTA screenshots were clean.

The viewport override was reset, the Browser tab was closed and the local server was stopped after verification.

## Release boundary

This task creates one local implementation commit only. It does not push, merge, deploy, access production, alter assets or contact external services.
