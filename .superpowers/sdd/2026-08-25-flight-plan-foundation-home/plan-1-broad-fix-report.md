# Plan 1 broad-review fix report

Date: 2026-08-26

## Outcome

Both Important Plan 1 review findings are closed locally after three fix rounds. Public claim enforcement is registry-driven and fail-closed for every declared surface, high-risk approved claims are bounded to controlled exact units instead of substring matches, direct static JavaScript literals are decoded before matching, default-ignorable Unicode characters cannot split protected claims, and the back-to-top click path follows the runtime reduced-motion preference.

## RED evidence

- Baseline: `npm run test:verify-site` passed 393/393 before the changes.
- Initial focused run: 20 tests, 1 passed and 19 failed as expected. Failures covered the missing browser-chat surface, 12 `review`/`retired` publications across six surfaces, five high-risk semantic drifts, and reduced-motion runtime behavior.
- Global status hardening: 12 tests, 2 passed and 10 failed before removing the fact-to-surface dependency. This proved that non-approved status had not yet been enforced outside a fact's publication mapping.
- Registry extension: one focused test failed before the verifier accepted and scanned an additional registry-declared public surface.
- Round 2 production-registry run: 9 tests, 2 passed and 7 failed as expected. The failures proved four substring-boundary bypasses, escaped retired/SLA JavaScript literals, and malformed JavaScript were false greens on the round-1 implementation.
- Round 3 production-registry run: 6 tests, 1 passed and 5 failed as expected. The failures reproduced quantitative and retired-name false greens split by U+200B, U+200C, U+2060, and U+FEFF; unrelated public copy remained a valid positive control.

## Decisions and implementation

- `content/site-facts.json` now owns `public_claim_surfaces`, including `assets/js/main.js`. The six current surfaces are mandatory, while additional declared surfaces are scanned automatically.
- Every `review` or `retired` fact is rejected on every public surface. Approved high-risk claims use exact per-surface phrases plus forbidden semantic variants.
- High-risk text rules use registry-declared `match_mode: line` and `controlled_any` anchors. Every controlled sentence/line must equal an approved unit, so an approved prefix cannot legitimize an unsupported suffix or adjacent high-risk assertion. Harmless surrounding prose remains allowed on separate units.
- JavaScript fact surfaces reuse the existing lexer to decode direct quoted strings and static template literals without `eval`. Raw source remains searchable, decoded literals are matched as content, and lexical errors fail the verification closed.
- Central comparison normalization removes Unicode characters with the runtime-supported `Default_Ignorable_Code_Point` property after NFKC normalization. Registry candidates, raw public-surface text, controlled units, and decoded static JavaScript literals therefore use the same canonical form without rewriting source content.
- Removed unapproved `100+ organisations`, Żabka store-count/ranking, KGHM ranking, and `500M PLN/year` variants from LLM and Worker surfaces.
- Restored the approved meanings: `20+ SAP Ariba implementations` and exact EUR 500M total value of delivered projects. Combined Ariba/Fieldglass/S/4HANA counts and `500M+`/`ponad` expansions are forbidden.
- Removed the retired WarsawFlightSafety wording. `llms-full.txt` and `worker/index.js` now use only the approved current `akrobacja.com` status and voucher-platform description.
- Removed the browser chat response-time SLA and current helicopter-flying claim, replacing them with factual service/contact copy.
- `initBackToTop()` uses `auto` under `prefers-reduced-motion: reduce` and keeps `smooth` otherwise. The regression test executes the real click handler for both preference states.

## GREEN evidence

- Round 3 focused production-registry tests: 6/6 passed.
- Round 2 focused production-registry tests: 9/9 passed.
- All Plan 1 broad-review tests: 36/36 passed.
- `npm run verify:home`: passed.
- `npm run verify:facts`: passed.
- `npm run verify:foundation`: passed.
- `npm run test:verify-site`: 429/429 passed.
- `node --check assets/js/main.js`: passed.
- `node --check worker/index.js`: passed.
- `node --check scripts/verify-site.mjs`: passed.
- `node --check scripts/verify-site.test.mjs`: passed.
- Forbidden-string audit across all six public surfaces: no matches.
- Default-ignorable character audit across all six checked-in public surfaces: no matches.
- Exact approved-meaning audit found the required Ariba, EUR 500M, and `akrobacja.com` phrases on their declared surfaces.

## Limitations

- No production, deployment, Worker endpoint, or live-browser interaction was performed. Reduced-motion behavior is covered by executing the checked-in browser script in a deterministic runtime harness.
- Semantic enforcement is intentionally registry-based. A materially new approved wording must be explicitly added to its surface rule; controlled high-risk anchors reject same-unit extensions, while unrelated surrounding prose remains valid.
- JavaScript decoding is deliberately limited to direct quoted strings and static template literals. Dynamic interpolation, concatenation, or runtime-generated claims are not evaluated; those patterns remain covered only when their raw source contains a registered candidate or forbidden variant.
- Default-ignorable removal affects verifier comparisons only. The checked-in public content is neither rewritten nor stripped.
- No previously unapproved fact was promoted to `approved`.
