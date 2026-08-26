# Plan 1 broad-review fix report

Date: 2026-08-26

## Outcome

Both Important Plan 1 review findings are closed locally. Public claim enforcement is registry-driven and fail-closed for every declared surface, and the back-to-top click path now follows the runtime reduced-motion preference.

## RED evidence

- Baseline: `npm run test:verify-site` passed 393/393 before the changes.
- Initial focused run: 20 tests, 1 passed and 19 failed as expected. Failures covered the missing browser-chat surface, 12 `review`/`retired` publications across six surfaces, five high-risk semantic drifts, and reduced-motion runtime behavior.
- Global status hardening: 12 tests, 2 passed and 10 failed before removing the fact-to-surface dependency. This proved that non-approved status had not yet been enforced outside a fact's publication mapping.
- Registry extension: one focused test failed before the verifier accepted and scanned an additional registry-declared public surface.

## Decisions and implementation

- `content/site-facts.json` now owns `public_claim_surfaces`, including `assets/js/main.js`. The six current surfaces are mandatory, while additional declared surfaces are scanned automatically.
- Every `review` or `retired` fact is rejected on every public surface. Approved high-risk claims use exact per-surface phrases plus forbidden semantic variants.
- Removed unapproved `100+ organisations`, Żabka store-count/ranking, KGHM ranking, and `500M PLN/year` variants from LLM and Worker surfaces.
- Restored the approved meanings: `20+ SAP Ariba implementations` and exact EUR 500M total value of delivered projects. Combined Ariba/Fieldglass/S/4HANA counts and `500M+`/`ponad` expansions are forbidden.
- Removed the retired WarsawFlightSafety wording. `llms-full.txt` and `worker/index.js` now use only the approved current `akrobacja.com` status and voucher-platform description.
- Removed the browser chat response-time SLA and current helicopter-flying claim, replacing them with factual service/contact copy.
- `initBackToTop()` uses `auto` under `prefers-reduced-motion: reduce` and keeps `smooth` otherwise. The regression test executes the real click handler for both preference states.

## GREEN evidence

- Focused Plan 1 broad-review tests: 21/21 passed.
- `npm run verify:home`: passed.
- `npm run verify:facts`: passed.
- `npm run verify:foundation`: passed.
- `npm run test:verify-site`: 414/414 passed.
- `node --check assets/js/main.js`: passed.
- `node --check scripts/verify-site.mjs`: passed.
- `node --check scripts/verify-site.test.mjs`: passed.
- Forbidden-string audit across all six public surfaces: no matches.
- Exact approved-meaning audit found the required Ariba, EUR 500M, and `akrobacja.com` phrases on their declared surfaces.

## Limitations

- No production, deployment, Worker endpoint, or live-browser interaction was performed. Reduced-motion behavior is covered by executing the checked-in browser script in a deterministic runtime harness.
- Semantic enforcement is intentionally registry-based. A materially new paraphrase must be added as an alias or forbidden variant when it is introduced; existing listed high-risk variants are covered.
- No previously unapproved fact was promoted to `approved`.
