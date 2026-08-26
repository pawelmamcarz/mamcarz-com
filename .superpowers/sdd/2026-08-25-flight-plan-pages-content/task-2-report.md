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

### Fix round 2

Focused RED:

- Command: `node --test --test-name-pattern='Plan 2 Task 2 fix round 2' scripts/verify-site.test.mjs`.
- Result before verifier hardening: 3 tests, 0 pass, 3 fail.
- The three failing groups reproduced unlisted anchors anywhere in the parsed document, fabricated semantic and accessibility attributes, and case drift in exact page literals.
- Two focused follow-up mutations also reproduced reference-token drift through a default-ignorable character and a required footer-signature anchor moved into a template before their minimal fixes.

Focused GREEN:

- The same command passes 3 tests, 3 pass, 0 fail.
- The complete Task 2 focus passes 21 tests, 21 pass, 0 fail.
- Immutable PL/EN manifests pin all 21 current anchors by document order, structural role, exact href, required attributes and case-preserving label. The footer signature also pins its localized target, accessibility label and image structure. Every parsed anchor is checked, including hidden, template and noscript descendants; evidence links retain only the existing approved `source_url` exception.
- Immutable PL/EN semantic manifests pin all 12 current elements carrying `aria-*`, `alt`, `title`, `placeholder` or equivalent user-facing attributes. Unexpected attributes are rejected across every parsed descendant. Human-readable values allow Unicode-equivalent and whitespace-only formatting, while reference and state tokens remain exact.
- Application-owned H1, lead, main, navigation, footer, evidence, schema and metadata literals now use a case-preserving NFKC, whitespace and default-ignorable comparator. Lowercasing remains limited to intentionally case-insensitive forbidden and security scans.

### Fix round 3

Focused RED:

- Command: `node --test --test-name-pattern='Plan 2 Task 2 fix round 3' scripts/verify-site.test.mjs`.
- Result before verifier hardening: 4 tests, 0 pass, 4 fail.
- The four independent false greens reproduced an unlisted external anchor laundered through a fake evidence row in a footer template, an unmanifested `role="button"`, an entity-obfuscated `aria-hidden` state token and a default-ignorable entity appended to `og:url`.

Focused GREEN:

- The same command passes 4 tests, 4 pass, 0 fail.
- The complete Task 2 focus passes 25 tests, 25 pass, 0 fail. Task 1 remains isolated and passes 36 tests, 36 pass, 0 fail.
- Evidence anchor exemptions are now derived only from the exact three direct article rows owned by the direct `main > section[data-section="evidence"]` structure. Fake evidence classes elsewhere remain subject to the 21-anchor whole-document manifest. The exact approved associated `source_url` control still passes.
- The semantic manifest pins 15 exact semantic-role nodes, including menu, toggle, overlay, back control and main IDs and state values. A fail-closed controlled-attribute set rejects unmanifested accessibility, behavior, visibility, focus, form-state, event-handler and inline-style attributes across active and inactive descendants.
- Exact owned-copy collection excludes hidden and inert subtrees, so unavailable content cannot satisfy the main or shell literal contract. The intentionally closed Advisory disclosure remains valid because its source labels are still included by the navigation contract.
- Human-readable attributes retain case-preserving Unicode, entity and whitespace equivalence. State and reference tokens, including `aria-hidden`, `aria-current`, `aria-expanded`, `aria-controls`, IDs, roles and `tabindex`, now compare their parsed source values without entity decoding, Unicode folding or whitespace normalization.
- Metadata fields are explicitly typed. Human titles, descriptions, author and accessible image labels use the case-preserving human comparator; viewport, robots, Open Graph type, URLs, images, locale and canonical/hreflang resources compare raw exact values.

### Fix round 4

Focused RED:

- Command: `node --test --test-name-pattern='Plan 2 Task 2 fix round 4' scripts/verify-site.test.mjs`.
- Result before the document-manifest implementation: 4 tests, 0 pass, 4 fail.
- The first failing examples confirmed zero verifier errors for `lang="fr"`, an external form with `action` and `method`, an inline `style` element and a metadata claim inside a footer `template`.
- Follow-up attribute-occurrence regressions were also watched RED: the focused attribute test had 1 test, 0 pass, 1 fail first when duplicate `lang` attributes were collapsed by the parser and again when duplicate `href` attributes were hidden by the approved evidence-link exception.

Focused GREEN:

- The complete round 4 focus passes 4 tests, 4 pass, 0 fail.
- The complete Task 2 focus passes 29 tests, 29 pass, 0 fail. Task 1 remains isolated and passes 36 tests, 36 pass, 0 fail.
- A pinned SHA-256 manifest covers the pre-order path, tag, source attribute occurrence count and complete sorted attribute map of all 186 elements on each localized page. Any extra element, unknown attribute, duplicate attribute or changed position fails across active, hidden, inert, template and noscript descendants.
- Human normalization is limited to the already approved human-readable semantic attributes and typed human metadata values. State, reference, resource, URL, locale and other document tokens remain raw exact.
- The only structural variant is an evidence anchor at an exact approved evidence leaf. It is transparent to the 186-element base manifest only when it is the leaf's sole element child, has only the exact `href`, has no element descendants and targets an approved associated `source_url`; the existing immutable evidence contract still validates its text and placement.
- Metadata validation now inventories every `html`, `head`, `body`, `title`, `base`, `meta` and `link` in the parsed document, requires the single exact root nesting and complete 23-element head order, rejects every `base`, and validates all four canonical/hreflang links plus all four approved head assets without slicing.
- The same document manifest pins both scripts, all stylesheet/font/icon resources and the signature image. Extra style, script, iframe, image, object, embed, source, picture, video, audio and form variants are rejected even inside inactive descendants.

### Fix round 5

Focused RED:

- Command: `node --test --test-name-pattern='Plan 2 Task 2 fix round 5' scripts/verify-site.test.mjs`.
- Initial result: 4 tests, 0 pass, 4 fail, exit 1. The first examples were exact false greens: a missing doctype returned zero errors, `Available now` before the doctype returned zero errors and the navigation `<span/>` reproduction returned zero errors. An external image produced only the supplemental document-manifest and semantic diagnostics, with no independent resource-census error.
- The coordinated-drift regression then failed independently: it inserted the same unapproved iframe into PL and EN, obtained each mutated document's real element count and SHA-256 digest from an instrumented temporary verifier, patched both constants in a clean temporary verifier source and received exit 0. This proved that the digest was the only remaining barrier.
- Two bounded follow-up RED cases closed source-syntax details without widening product scope: `<span / claim>` was rejected only by the digest before raw start-tag syntax validation, and a duplicate stylesheet `href` occurrence was rejected only by the digest before the independent census counted source attributes.

Focused GREEN:

- The complete round 5 focus passes 5 tests, 5 pass, 0 fail, exit 0. The complete Task 2 focus passes 34 tests, 34 pass, 0 fail. Task 1 remains isolated and passes 36 tests, 36 pass, 0 fail.
- The parser now retains doctype and comment nodes and validates raw start and closing tag syntax. Exactly one case-insensitive HTML5 `<!DOCTYPE html>` is required before the sole `html` element; only formatting whitespace and harmless comments may surround it. Missing, duplicate, moved and legacy or malformed declarations fail.
- Every non-whitespace text node is inventoried, including text before or after the document, between `head` and `body`, in raw-text elements and in hidden, inert, `template` and `noscript` descendants. Text is allowed only in the already pinned title, Service schema, shell, navigation, main and footer ownership surfaces. The exact external browser script has an empty body.
- A non-void `/>` token produces the dedicated `page-html-self-closing` error and is parsed with browser-consistent HTML semantics as an open element, not a self-closed element. Regressions cover `span`, `div`, `a`, `p`, `details`, `summary`, `script` and `style`; actual void syntax remains accepted. Stray, mismatched and malformed opening or closing tags fail through `page-html-syntax`.
- The independent resource census is defined from fixed Task 2 requirements rather than current page bytes or digest values. It requires exactly 8 localized direct-head links, 2 scripts in their exact locations with exact source-attribute counts and bodies, and 1 exact footer signature image. It requires zero `style` elements or `style` attributes and zero instances of 14 unapproved resource or form tag families across active and inactive descendants. HTTP evidence anchors remain allowed only through the exact associated approved registry URL and leaf contract.
- After both PL and EN document digest constants are recomputed and patched for an injected iframe, the distinct `application-resource-census` error still fails the temporary verifier while `application-document-manifest` is absent. The unchanged approved evidence-link fixture continues to pass.

## Verification gates

- `npm run verify:pages -- --family=applications`: PASS.
- `npm run verify:home`: PASS.
- `npm run verify:facts`: PASS.
- `npm run verify:foundation`: PASS.
- `npm run verify:site`: PASS.
- `npm run test:verify-site`: PASS, 499 tests, 499 pass, 0 fail.
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
- Fix-round 2 diff inspection: the same product surfaces remain unchanged from `31d36bc4f4d24808d0f977375263e35f6b1401ee`; only the verifier, verifier tests and this report changed.
- The browser review was not repeated in fix round 2 because the product and stylesheet remain byte-unchanged.
- Fix-round 3 diff inspection: the PL/EN product pages, shared CSS, facts registry and browser script remain byte-unchanged from `fde212f476a542042f4c07598b8ab441abe814d2`; only the verifier, verifier tests and this report changed.
- The browser review was not repeated in fix round 3 because no product or stylesheet file changed.
- Fix-round 4 diff inspection: the PL/EN product pages, shared CSS, facts registry and browser script remain byte-unchanged from both the original Task 2 product commit `ee98910d3369d7b91c085f844d49cf8c0f9c4273` and the round 4 base `3b9f5b503320b6a13e53513f7478d2d362d63591`; only the verifier, verifier tests and this report changed.
- The browser review was not repeated in fix round 4 because no product or stylesheet file changed.
- Fix-round 5 diff inspection: the PL/EN product pages, shared CSS, facts registry and browser script remain byte-unchanged from both the original Task 2 product commit `ee98910d3369d7b91c085f844d49cf8c0f9c4273` and the round 5 base `c98c4962c226756e4df576aa5b96d397696866a3`; only the verifier, verifier tests and this report changed.
- The browser review was not repeated in fix round 5 because no product, stylesheet, registry or browser-script byte changed.

## Limitations

- No external product links were added because the selected fact records do not register approved URLs.
- Verification was local and static. No push, merge, deployment or production access was performed.
