# Task 7 report: Speaking programme and Procurement 2026 parent

## Scope and truth boundary

- Rebuilt `/wystapienia/` and `/en/wystapienia/` as a bilingual Speaking programme pair in the Flight Plan system.
- The pages expose exactly four direct groups in this order: `topics`, `formats`, `audience`, `contact`; exactly five approved topics, four approved formats and three approved audience categories; and one localized mail CTA.
- Speaking publishes service scope only. Its exact reverse fact inventory is empty on both surfaces: no fact record authorizes either page.
- Removed the legacy `100+` organization claim, every duration, delivery-language claim, university-collaboration claim, named-client claim, past-event claim, result claim and status claim. The approved university audience category remains scope, not a collaboration claim.
- Rebuilt `/procurement-2026/` as a Polish-only parent for the four existing embedded artifacts. There is no `/en/procurement-2026/` product route, link or hreflang. The visible English-reader switch goes to `/en/wiedza/` and is not marked as hreflang.
- Preserved the exact four iframe sources, titles and order. The desktop frame heights are `820 / 900 / 2200 / 950px`; mobile heights are `1100 / 1300 / 3800 / 1400px`.
- The composition uses a ruled programme sheet and artifact dossier. There are no client or event logos, images, external links, generated media, generic cards, gradients, shadows, glow or glass effects in the new surfaces.
- No asset or embedded artifact file was added or changed. WarsawFlightSafety/WFS and Polpharma do not occur on the three product pages.

## Exact Speaking inventory

The localized programme manifests are pinned by the verifier and document digests:

- five topics: procurement transformation, SAP Ariba, digital procurement, public procurement and technology, leading change;
- four formats: talk, panel, workshop, lecture;
- three audiences: industry conferences and forums, procurement and project teams, universities and executive programmes;
- one context-first contact section and one localized `mailto:` CTA per page;
- one bounded localized `WebPage` schema per page;
- zero images, embeds, forms, external URLs, inline styles or extra executable resources.

The ordered `public_claim_surfaces` registry now includes both Speaking paths, while every fact-to-Speaking surface lookup remains empty. The verifier independently rejects both direct and coordinated page-plus-registry fact attachment.

## Procurement parent inventory

The parent preserves these exact embedded artifacts:

1. `/diagrams/infographic.html` — `Procurement 2026 · infographic`
2. `/diagrams/diagram1_universal.html` — `Procurement Process 2026 · interaktywny diagram`
3. `/diagrams/diagram2_ariba.html` — `SAP Ariba Module Mapping`
4. `/diagrams/diagram3_maturity.html` — `Procurement Maturity Assessment`

The page has one bounded Polish `WebPage` schema, one CTA, only `pl` and `x-default` hreflang entries, and the first artifact carries the approved visible English-material notice.

## TDD evidence

### Legacy-pages RED

Focused Task 7 tests were added before product edits and run against the legacy pages:

```text
node --test --test-name-pattern='Plan 2 Task 7' scripts/verify-site.test.mjs
tests 4
pass 3
fail 1
exit 1
```

The exact positive Speaking/Procurement contract failed against the legacy documents. The real focused family verifier independently reported exactly 46 legacy errors across the missing Speaking registry/shell/truth boundary and Procurement parent contract.

### GREEN and mutation coverage

After implementation and the final adversarial additions, the focused Task 7 run was:

```text
tests 4
pass 4
fail 0
exit 0
duration_ms 2227.419541
```

The focused tests cover exact identity, programme groups and order, topic/format/audience manifests, CTA cardinality and routes, schema, resources, document digests, empty reverse facts, exact public surfaces, Procurement language routing and exact iframe inventory. Mutations include a default-ignorable split legacy count, duplicate group, extra form, coordinated page-plus-registry fact attachment, missing iframe and a fake English Procurement route split across inactive source nodes.

Carried Plan 2 Tasks 1 through 7 passed together:

```text
tests 114
pass 114
fail 0
exit 0
duration_ms 42908.44625
```

The fresh full suite result after the final test mutations was:

```text
tests 542
pass 542
fail 0
exit 0
duration_ms 67267.976584
```

## Repository gates and scans

All required family and repository gates returned exit 0:

```text
npm run verify:pages -- --family=speaking
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
jq empty content/site-facts.json
git diff --check
```

The product-page scans returned zero hits for WarsawFlightSafety/WFS, Polpharma, the fake English Procurement route, inline style and Playfair declarations. The dedicated verifier returned zero claim-boundary errors for counts, durations, delivery languages, university collaboration, named clients, past results and status. The new Speaking/Procurement CSS block contains no gradients, shadows, filters, backdrop filters, glow or glass effects. The four iframe sources are local and their target files exist; the embedded files themselves are unchanged.

## Fix round 1: dark contact foreground

Controller Chrome review exposed one shared foreground defect: the Speaking contact body inherited `#46636D` on `#193D49` at approximately `1.81:1`; the Procurement heading inherited `#102831` on `#0C252E` at approximately `1.04:1`, and its body inherited `#46636D` at approximately `2.47:1`.

The root cause was a dark shared background without a scoped foreground contract. The Speaking section also carries `id="contact"`, so the existing higher-specificity `#contact` rule makes its actual background `--panel`; Procurement retains the shared `--panel-deep` background.

A focused regression was written before the CSS edit and failed on the missing Speaking heading foreground:

```text
tests 5
pass 4
fail 1
exit 1
actual undefined; expected var(--white)
```

The narrow fix gives each Speaking and Procurement heading, normal body paragraph and section label its own explicit foreground rule. Headings and body use `--white`; labels use `--signal-light`. Intended WCAG contrast ratios are:

- Speaking heading/body: `11.0028:1`; Speaking label: `5.6712:1`;
- Procurement heading/body: `15.0492:1`; Procurement label: `7.7568:1`.

Focused GREEN after the CSS edit was 5/5. The fresh carried Plan 2 Tasks 1 through 7 run was 115/115 (`duration_ms 31857.869625`), and the fresh full suite was 543/543 with zero failures (`duration_ms 68894.392625`). All family and repository gates listed above passed again. Product HTML, registry, JavaScript, layout geometry, assets and embedded artifacts were unchanged by the fix.

## Browser matrix

The implementer-side Browser remained unavailable: the local preview process reported `PermissionError: [Errno 1] Operation not permitted` while binding its port, and the in-app Browser rejected navigation to `http://127.0.0.1:4173` under automatic security review.

Controller Chrome subsequently inspected all six pre-fix cells. At both `390 x 844` and `1280 x 900`, it confirmed clean grid geometry, the retained 32px desktop column gap, no horizontal overflow, exact content and CTA inventory, exact iframe shells, and iframe targets loading after lazy activation. It also produced the contrast finding recorded above.

Controller repeat Browser review after the contrast commit is still required before claiming the six fixed cells visually pass. Embedded internal interaction remains deferred to Task 8 as planned.

The viewport override was reset and the Browser tab was closed after the denied navigation.

## Release boundary

This task creates one local implementation commit only. It does not push, merge, deploy, access production, alter assets or embedded diagrams, create the English Procurement route, or contact external services.
