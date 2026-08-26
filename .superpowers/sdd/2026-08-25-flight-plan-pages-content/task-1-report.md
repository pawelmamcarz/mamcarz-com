# Task 1 report: Flight Plan route architecture verifier

Date: 2026-08-26
Base commit: `02ea996c9e81e89a296ec5913cb14af413c5a0d6`
Branch: `codex/flight-plan-redesign`
Fix-round base: `f3405ee412807a7964563c75976555160cd5dfb1`

## Scope delivered

- Added the exact nine-entry `ROUTE_PAIRS` manifest from Plan 2.
- Added `--scope=pages` and fail-closed `--family=all|home|services|applications|aviation|projects|knowledge|speaking|artifacts` handling.
- Added `verifyPages()` with aggregated required-file errors, paired PL/EN shell verification, approved-only `data-fact-ids`, and local root-relative link/resource verification.
- Added `npm run verify:pages` without adding pages to the default `verify:site` scope.
- Added focused fixture and mutation coverage to `scripts/verify-site.test.mjs`.

No product page, hub file, content migration, fact publication or fact-status change is part of this task. `package-lock.json` is unchanged.

## TDD evidence

The focused tests were written before verifier implementation. Three initially negative-only assertions were tightened so they could not pass in the absence of the new verifier. The resulting valid RED checkpoint was:

```text
node --test --test-name-pattern="Plan 2 Task 1" scripts/verify-site.test.mjs
tests 17
pass 0
fail 17
```

Failures demonstrated the missing pages scope, family/API contract, package command, required-file aggregation, paired shell verification, fact-ID enforcement and local-target resolver.

After implementation, the fresh focused GREEN checkpoint was:

```text
tests 17
pass 17
fail 0
```

The initial complete verifier suite retained all 429 pre-existing checks and added 17 focused checks:

```text
npm run test:verify-site
tests 446
pass 446
fail 0
```

### Independent review fix round 1

Eight focused tests were added before the review fixes. The batch RED checkpoint was:

```text
node --test --test-name-pattern="Plan 2 Task 1 fix round 1" scripts/verify-site.test.mjs
tests 8
pass 1
fail 7
```

The one passing case was an intentional positive control proving that internal URL whitespace remains literal while normalized fragment, mail, external and protocol-relative references remain ignored. The seven failures reproduced the family CLI fail-open, metadata body/head decoys, invisible language label, hidden H1, encoded/whitespace local URL, non-file family target and duplicate fact-ID defects.

During the mutation audit, a bare `--family` argument was added to the CLI table. Its targeted test failed because the option was ignored and the all-family verifier ran; after the parser fix it produces one `cli-family` error and no page output.

The final fix-round focused checkpoint is 8/8 GREEN. The complete suite is now:

```text
npm run test:verify-site
tests 454
pass 454
fail 0
```

Mutation and fixture coverage includes:

- exact manifest membership, every accepted family and invalid-family fail-closed behavior;
- aggregation of both missing selected-family files;
- selected-family deferral of an exact route owned by another unfinished family, while `family=all`, same-family routes, assets and non-manifest targets remain required;
- exactly one active `h1` and one active `main#main`;
- exact canonical, real `pl`/`en`/`x-default` hreflang entries and exact paired language switch;
- the versioned shared stylesheet and deferred browser script, including hidden, `template` and `noscript` decoys;
- ordered required main-navigation routes and rejection of a route moved outside `.site-nav`;
- HTML-whitespace fact-ID tokenization plus unknown, comma-joined, `review` and `retired` rejection;
- root, trailing-slash and file mapping after query/fragment stripping for `href`, `src` and every `srcset` candidate;
- aggregation of missing local targets and intentional ignores for fragments, mail, external/protocol-relative URLs, data URLs and the Worker URL.
- duplicate, empty, bare and complete malformed `--family` values, including real CLI subprocesses that must stop before page hooks;
- metadata confined to exactly one active `head`, with body, `template`, `noscript`, duplicate-head and malformed-head mutations;
- exact visible `EN`/`PL` language labels, including hidden and unrelated-text decoys plus a visible inline-markup control;
- inline `display:none`/`visibility:hidden`, mixed case, hidden ancestors and closed/open disclosure visibility;
- numeric, hexadecimal and named URL entities plus surrounding browser whitespace across `href`, `src` and `srcset`;
- `NOT_FILE` rejection for another-family manifest targets, while only `ENOENT` remains deferrable;
- duplicate whitespace-delimited `data-fact-ids` rejection with a unique-list control.

## Interfaces and behavior

`readRequired()` converts `ENOENT` into `ERROR route-file <path>: required file is missing` and returns an empty document, so every absent route is reported instead of throwing a raw exception.

For a selected family, a missing local target is deferred only when its mapped file is exactly the PL or EN file of a `ROUTE_PAIRS` entry owned by another family and `stat()` reports `ENOENT`. `NOT_FILE`, permission/other filesystem errors, `family=all`, the selected family's own route files, assets and paths outside the manifest remain failures.

Page checks use the existing parsed HTML tree and active/visibility helpers. Canonical and hreflang metadata must be descendants of exactly one active `head`. Inline hiding and closed disclosures are modeled for visible content; advisory submenu links remain structurally verifiable as content available when their disclosure opens. Controlled shell resources require exact attribute sets and cache version `v=20260825-flightplan-2`; inactive decoys cannot satisfy the contract.

Local URL attributes are HTML-entity decoded and stripped only of surrounding browser ASCII whitespace before root-relative classification. Internal whitespace is preserved. `data-fact-ids` remain HTML-whitespace tokenized, approved-only and now unique within each attribute.

Task 7 and Task 8 substantive contracts are deliberately not claimed here. The call graph contains bounded hooks that expose `procurement-parent-contract` and `artifacts-contract` as deferred. Their future tasks must replace those hooks with the planned failing checks.

## Verification gates

Fresh results on Node.js v26.7.0:

| Command | Result |
| --- | --- |
| `node --check scripts/verify-site.mjs` | PASS |
| `node --check scripts/verify-site.test.mjs` | PASS |
| original focused Plan 2 Task 1 tests | PASS, 17/17 |
| fix-round focused tests | PASS, 8/8 |
| all Plan 2 Task 1 focused tests | PASS, 25/25 |
| `npm run test:verify-site` | PASS, 454/454 |
| `npm run verify:home` | PASS |
| `npm run verify:facts` | PASS |
| `npm run verify:foundation` | PASS |
| `npm run verify:site` | PASS |
| `npm run verify:pages` | EXPECTED FAIL, 127 aggregated contract errors |

Representative CLI probes:

- `--family=applications`: expected exit 1 with 18 errors, including both missing selected route files.
- `--family=home`: expected exit 1 with 8 legacy-shell/local-target errors and no errors from unfinished non-selected route files.
- `--family=artifacts`: exit 0 with explicit `deferred: artifacts-contract`; it does not claim the Task 8 contract was checked.
- `--family=invalid-family`: exit 1 with exactly one `cli-family` error and no page verification.
- duplicate, extra-`=`, empty and bare family probes: exit 1 with exactly one `cli-family` error and no page verification or deferred hook.

## Intentional pages RED

The isolated final architecture gate exits nonzero by design at this task boundary. It reports 127 errors in one run, not a raw exception:

| Check | Count |
| --- | ---: |
| `route-file` | 6 |
| `page-head` | 6 |
| `page-h1` | 6 |
| `page-main` | 6 |
| `page-canonical` | 6 |
| `page-hreflang` | 6 |
| `page-stylesheet` | 18 |
| `page-script` | 18 |
| `page-navigation` | 16 |
| `local-target` | 39 |
| **Total** | **127** |

The six `route-file` errors are the planned PL/EN application, aviation and knowledge hubs. The remaining errors identify existing version-1/legacy shells, navigation and non-trailing local routes that later Plan 2 tasks must migrate. The run also prints `DEFERRED procurement-parent-contract, artifacts-contract` to make the Task 7/8 boundary explicit.

## Limitations and residual work

- The six new hub files remain absent intentionally.
- Existing pages remain on the legacy shell and cache version until their owning tasks migrate them.
- Procurement parent and artifact substantive checks remain owned by Tasks 7 and 8.
- This task does not push, merge, deploy or access production.
