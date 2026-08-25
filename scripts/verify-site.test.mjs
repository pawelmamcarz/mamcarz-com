import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { parseCssRules, readFacts, runVerification } from "./verify-site.mjs";

const execFileAsync = promisify(execFile);
const modulePath = resolve("scripts/verify-site.mjs");
const foundationCss = await readFile(resolve("assets/css/style.css"), "utf8");

function fact(overrides = {}) {
  return {
    id: "brand.promise",
    value: "decision-to-operational-system",
    display_pl: "Marka",
    display_en: "Brand",
    kind: "constant",
    as_of: null,
    source_type: "owner_verified",
    source_label: "Owner decision, 2026-08-25",
    source_url: null,
    surfaces: ["index.html", "en/index.html"],
    status: "approved",
    ...overrides
  };
}

function blockedClaim(overrides = {}) {
  return {
    id: "client.polpharma",
    pattern: "Polpharma",
    forbidden_contexts: ["trust", "clients", "client list", "worked for"],
    reason: "Owner confirmed Polpharma is not a client",
    ...overrides
  };
}

async function fixture({ facts = [fact()], blocked_claims = [blockedClaim()], pl = "Marka", en = "Brand", css = "body{}", js = "void 0;", extraFiles = {} } = {}) {
  const root = await mkdtemp(resolve(tmpdir(), "verify-site-test-"));
  await Promise.all([
    mkdir(resolve(root, "content"), { recursive: true }),
    mkdir(resolve(root, "assets/css"), { recursive: true }),
    mkdir(resolve(root, "assets/js"), { recursive: true }),
    mkdir(resolve(root, "en"), { recursive: true }),
    mkdir(resolve(root, "worker"), { recursive: true })
  ]);
  await Promise.all([
    writeFile(resolve(root, "content/site-facts.json"), JSON.stringify({ version: 1, facts, blocked_claims })),
    writeFile(resolve(root, "index.html"), `<h1>PL</h1>${pl}`),
    writeFile(resolve(root, "en/index.html"), `<h1>EN</h1>${en}`),
    writeFile(resolve(root, "assets/css/style.css"), css),
    writeFile(resolve(root, "assets/js/main.js"), js),
    writeFile(resolve(root, "llms.txt"), ""),
    writeFile(resolve(root, "llms-full.txt"), ""),
    writeFile(resolve(root, "worker/index.js"), ""),
    ...Object.entries(extraFiles).map(async ([relativePath, content]) => {
      const filePath = resolve(root, relativePath);
      await mkdir(resolve(filePath, ".."), { recursive: true });
      await writeFile(filePath, content);
    })
  ]);
  return root;
}

function errorIds(result) {
  return result.errors.map((error) => error.split(" ")[1]);
}

async function verifyFixtureCss(css) {
  const root = await fixture({ css });
  return runVerification({ root, scope: "foundation" });
}

test("readFacts reads fixtures without starting CLI verification", async () => {
  const root = await fixture();
  const data = await readFacts({ root });
  assert.equal(data.facts[0].id, "brand.promise");
  assert.equal(data.blocked_claims[0].id, "client.polpharma");
});

test("module import has no CLI output or nonzero exit side effect", async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, ["--input-type=module", "--eval", `import(${JSON.stringify(new URL("./verify-site.mjs", import.meta.url).href)})`]);
  assert.equal(stdout, "");
  assert.equal(stderr, "");
});

test("facts scope rejects invalid record types and enums", async () => {
  const root = await fixture({
    facts: [fact({ id: "", value: {}, kind: "claim", as_of: "not-a-date", source_type: "owner_provided_cv", source_label: "", source_url: "ftp://invalid", surfaces: [], status: "published" })]
  });
  const result = await runVerification({ root, scope: "facts" });
  assert.deepEqual(new Set(errorIds(result)), new Set(["fact-id", "fact-value", "fact-kind", "fact-as-of", "fact-source-type", "fact-source-label", "fact-source-url", "fact-surfaces", "fact-status"]));
});

test("facts scope accepts a finite numeric FactRecord value", async () => {
  const root = await fixture({ facts: [fact({ value: 42 })] });
  const result = await runVerification({ root, scope: "facts" });
  assert.ok(!errorIds(result).includes("fact-value"));
});

test("facts scope rejects duplicate facts, malformed blocked records, and fact collisions", async () => {
  const root = await fixture({
    facts: [fact(), fact()],
    blocked_claims: [blockedClaim({ id: "brand.promise", pattern: "" }), blockedClaim(), blockedClaim()]
  });
  const result = await runVerification({ root, scope: "facts" });
  const ids = errorIds(result);
  assert.ok(ids.includes("fact-duplicate-id"));
  assert.ok(ids.includes("blocked-pattern"));
  assert.ok(ids.includes("blocked-id-collision"));
  assert.ok(ids.includes("blocked-duplicate-id"));
  assert.ok(ids.includes("blocked-duplicate-pattern"));
});

test("facts scope requires the canonical Polpharma block", async () => {
  const root = await fixture({ blocked_claims: [] });
  const result = await runVerification({ root, scope: "facts" });
  assert.ok(errorIds(result).includes("blocked-canonical-polpharma"));
});

test("facts scope treats an unnegated Polpharma mention as a blocked client claim", async () => {
  const root = await fixture({ extraFiles: { "llms.txt": "Clients: Polpharma", "llms-full.txt": "", "worker/index.js": "" } });
  const result = await runVerification({ root, scope: "facts" });
  assert.ok(result.errors.some((error) => error.startsWith("ERROR blocked-client.polpharma llms.txt:")));
});

test("facts scope rejects a standalone negated Polpharma mention", async () => {
  const root = await fixture({ extraFiles: { "llms.txt": "Polpharma is not a client.", "llms-full.txt": "", "worker/index.js": "" } });
  const result = await runVerification({ root, scope: "facts" });
  assert.ok(result.errors.some((error) => error.startsWith("ERROR blocked-client.polpharma llms.txt:")));
});

test("facts scope rejects a later Polpharma client claim after a negation", async () => {
  const root = await fixture({ extraFiles: { "llms.txt": "Polpharma is not a client. Worked for: Polpharma.", "llms-full.txt": "", "worker/index.js": "" } });
  const result = await runVerification({ root, scope: "facts" });
  assert.ok(result.errors.some((error) => error.startsWith("ERROR blocked-client.polpharma llms.txt:")));
});

test("facts scope enforces every blocked pattern, not only Polpharma", async () => {
  const root = await fixture({
    blocked_claims: [blockedClaim(), blockedClaim({ id: "client.acme", pattern: "Acme", forbidden_contexts: ["clients"], reason: "Acme is blocked for this fixture" })],
    extraFiles: { "llms.txt": "Worked for: Acme", "llms-full.txt": "", "worker/index.js": "" }
  });
  const result = await runVerification({ root, scope: "facts" });
  assert.ok(result.errors.some((error) => error.startsWith("ERROR blocked-client.acme llms.txt:")));
});

test("missing fixture files report standardized file-read errors", async () => {
  const root = await fixture();
  const missingRoot = resolve(root, "missing");
  const foundation = await runVerification({ root: missingRoot, scope: "foundation" });
  const home = await runVerification({ root: missingRoot, scope: "home" });
  const facts = await runVerification({ root: missingRoot, scope: "facts" });
  assert.ok(foundation.errors.some((error) => error.startsWith("ERROR file-read assets/css/style.css:")));
  assert.ok(home.errors.some((error) => error.startsWith("ERROR file-read index.html:")));
  assert.ok(facts.errors.some((error) => error.startsWith("ERROR facts-json content/site-facts.json:")));
  assert.ok(facts.errors.some((error) => error.startsWith("ERROR file-read worker/index.js:")));
});

test("foundation rejects a required selector that survives only in a comment", async () => {
  const css = `${foundationCss.replaceAll(".status-tag", ".removed-status-tag")}\n/* .status-tag { display: block; } */`;
  const result = await verifyFixtureCss(css);
  assert.ok(errorIds(result).includes("css-interface"));
});

test("foundation distinguishes an exact selector from plural and prefixed selectors", async () => {
  const css = foundationCss
    .replaceAll(".service-card {", ".service-card-detail {")
    .replaceAll(".service-card:hover", ".service-card-detail:hover");
  const result = await verifyFixtureCss(css);
  assert.ok(errorIds(result).includes("css-interface"));
});

test("foundation rejects an empty required declaration block", async () => {
  const css = foundationCss.replace(/\.breadcrumb \{[\s\S]*?\n\}/, ".breadcrumb {}");
  const result = await verifyFixtureCss(css);
  assert.ok(errorIds(result).includes("css-interface"));
});

test("foundation requires responsive contracts inside the intended media scope", async () => {
  const css = `${foundationCss.replace("@media (max-width: 759px) {", "@media (max-width: 758px) {")}\n/* @media (max-width: 759px) { .js .nav-list { display: none; } .js .nav-toggle { display: inline-flex; } .js .nav-list.is-open { display: block; } } */`;
  const result = await verifyFixtureCss(css);
  assert.ok(errorIds(result).includes("css-responsive"));
});

test("foundation does not accept responsive declarations hidden in a nested media scope", async () => {
  const css = `${foundationCss.replace("@media (max-width: 759px) {", "@media (max-width: 758px) {")}
@media (max-width: 1179px) { @media (max-width: 759px) { .js .nav-list { display: none; } .js .nav-toggle { display: inline-flex; } .js .nav-list.is-open { display: block; } } }`;
  const result = await verifyFixtureCss(css);
  assert.ok(errorIds(result).includes("css-responsive"));
});

test("foundation parser ignores structural characters inside quoted strings", async () => {
  const css = `${foundationCss}\n.string-probe::before { content: "{;:}"; }`;
  const result = await verifyFixtureCss(css);
  assert.deepEqual(result.errors, []);
});

test("foundation validates every display font face as a complete tuple", async () => {
  const css = foundationCss.replace(
    "src: url('/assets/fonts/barlow-semi-condensed-latin-700-normal.woff2') format('woff2');",
    "src: url('/assets/fonts/barlow-semi-condensed-latin-600-normal.woff2') format('woff2');"
  );
  const result = await verifyFixtureCss(css);
  assert.ok(errorIds(result).includes("display-font"));
});

test("foundation rejects a later body font shorthand that resets the document contract", async () => {
  const css = foundationCss.replace(
    /(?:body,\s*)?button, input, textarea, select \{\s*font: inherit;\s*\}/,
    "body, button, input, textarea, select { font: inherit; }"
  );
  const result = await verifyFixtureCss(css);
  assert.ok(errorIds(result).includes("css-body-contract"));
});

test("foundation rejects body typography resets inside responsive media", async () => {
  const css = `${foundationCss}\n@media (max-width: 1179px) { body { font-family: serif; line-height: normal; } }`;
  const result = await verifyFixtureCss(css);
  assert.ok(errorIds(result).includes("css-body-contract"));
});

test("foundation treats an uppercase HTML body selector as the same typography target", async () => {
  const css = `${foundationCss}\n@media (max-width: 759px) { BODY { font: 16px serif; } }`;
  const result = await verifyFixtureCss(css);
  assert.ok(errorIds(result).includes("css-body-contract"));
});

test("foundation parses mixed-case media at-rules before auditing body typography", async () => {
  const css = `${foundationCss}\n@MeDiA (max-width: 759px) { BODY { font: inherit; } }`;
  const result = await verifyFixtureCss(css);
  assert.ok(errorIds(result).includes("css-body-contract"));
});

test("foundation finds the body type when it is the selector subject", async () => {
  for (const selector of ["body", "html body", "html > body", "html + body", "html ~ body", "html || body", "body.some-class", "BODY:hover", "b\\6f dy"]) {
    const css = `${foundationCss}\n${selector} { font: inherit; }`;
    const result = await verifyFixtureCss(css);
    assert.ok(errorIds(result).includes("css-body-contract"), selector);
  }
});

test("foundation preserves escaped CSS selector atoms before subject decoding", async () => {
  const cases = [
    ["escaped child combinator", ".foo\\>body"],
    ["escaped adjacent-sibling combinator", ".foo\\+body"],
    ["escaped general-sibling combinator", ".foo\\~body"],
    ["escaped column combinator", ".foo\\|\\|body"],
    ["escaped whitespace", ".foo\\ body"],
    ["hex escape with whitespace terminator", ".foo\\3E body"],
    ["escaped newline", ".foo\\\nbody"]
  ];
  const outcomes = [];
  for (const [label, selector] of cases) {
    const css = foundationCss.concat("\n", selector, " { font-size: 10px; }");
    const result = await verifyFixtureCss(css);
    outcomes.push([label, errorIds(result).includes("css-body-contract")]);
  }
  assert.deepEqual(outcomes, [
    ["escaped child combinator", false],
    ["escaped adjacent-sibling combinator", false],
    ["escaped general-sibling combinator", false],
    ["escaped column combinator", false],
    ["escaped whitespace", false],
    ["hex escape with whitespace terminator", false],
    ["escaped newline", false]
  ]);
});

test("foundation allows body ancestors, siblings, pseudo-elements, attributes and classes", async () => {
  for (const selector of [
    "body .probe",
    "body > .probe",
    "body + .probe",
    ".shell body .probe",
    "body::before",
    "body::after",
    '[data-target="body"]',
    ".body"
  ]) {
    const css = `${foundationCss}\n${selector} { font-size: 10px; }`;
    const result = await verifyFixtureCss(css);
    assert.ok(!errorIds(result).includes("css-body-contract"), selector);
  }
});

test("foundation rejects functional body selector subjects", async () => {
  for (const selector of [":is(body)", ":where(body.some-class)"]) {
    const css = `${foundationCss}\n${selector} { font-weight: 900; }`;
    const result = await verifyFixtureCss(css);
    assert.ok(errorIds(result).includes("css-body-contract"), selector);
  }
});

test("foundation rejects a protected override when any selector-list branch targets body", async () => {
  const css = `${foundationCss}\n[data-list="safe,body"], body .safe, html body { line-height: 1; }`;
  const result = await verifyFixtureCss(css);
  assert.ok(errorIds(result).includes("css-body-contract"));
});

test("foundation parser splits selector lists only at top-level commas", () => {
  const rules = parseCssRules('[data-list="one,two"], :is(.one, .two), body::before { color: red; }');
  assert.deepEqual(rules[0].selectors, ['[data-list="one,two"]', ":is(.one, .two)", "body::before"]);
});

test("foundation rejects responsive body font-size overrides", async () => {
  const css = `${foundationCss}\n@media (max-width: 759px) { body { font-size: 10px; } }`;
  const result = await verifyFixtureCss(css);
  assert.ok(errorIds(result).includes("css-body-contract"));
});

test("foundation cannot hide an active gradient between quoted comment markers", async () => {
  const css = `${foundationCss}\n.comment-probe { --open: "/*"; background: linear-gradient(#fff, #000); --close: "*/"; }`;
  const result = await verifyFixtureCss(css);
  assert.ok(errorIds(result).includes("css-banned"));
});

test("foundation rejects important italic values regardless of case and spacing", async () => {
  const css = `${foundationCss}\n.italic-probe { FONT-STYLE : ItAlIc ! IMPORTANT; }`;
  const result = await verifyFixtureCss(css);
  assert.ok(errorIds(result).includes("css-banned"));
});

test("foundation preserves quoted comment markers as valid declaration content", async () => {
  const css = `${foundationCss}\n.comment-content::before { --open-marker: "/*"; content: "prefix \\\" /* literal */ suffix"; color: red; }`;
  const result = await verifyFixtureCss(css);
  assert.deepEqual(result.errors, []);
});

test("foundation reports an unterminated real CSS comment", async () => {
  const css = `${foundationCss}\n/* unterminated verifier probe`;
  const result = await verifyFixtureCss(css);
  assert.ok(result.errors.some((entry) => entry.startsWith("ERROR css-syntax assets/css/style.css:")), result.errors.join("\n"));
});

test("foundation does not confuse body text in an attribute selector with the body type", async () => {
  const css = `${foundationCss}\n@media (max-width: 759px) { [data-target="body"] { font: inherit; } }`;
  const result = await verifyFixtureCss(css);
  assert.ok(!errorIds(result).includes("css-body-contract"));
});

test("foundation allows safe responsive body overflow wrapping", async () => {
  const css = `${foundationCss}\n@media (max-width: 759px) { body { overflow-wrap: anywhere; } }`;
  const result = await verifyFixtureCss(css);
  assert.ok(!errorIds(result).includes("css-body-contract"));
});

test("foundation rejects case-obfuscated banned gradient functions", async () => {
  const css = `${foundationCss}\n.case-probe { background: Linear-Gradient(#fff, #000); }`;
  const result = await verifyFixtureCss(css);
  assert.ok(errorIds(result).includes("css-banned"));
});

test("foundation rejects CSS-escaped banned gradient functions", async () => {
  const css = `${foundationCss}\n.escape-probe { background: l\\69near-gradient(#fff, #000); }`;
  const result = await verifyFixtureCss(css);
  assert.ok(errorIds(result).includes("css-banned"));
});

test("foundation does not treat a gradient name inside a quoted value as an active function", async () => {
  const css = `${foundationCss}\n.string-probe::before { content: "Linear-Gradient(; l\\69near-gradient("; }`;
  const result = await verifyFixtureCss(css);
  assert.ok(!errorIds(result).includes("css-banned"));
});

test("foundation requires the back-to-top dual-contrast focus treatment", async () => {
  const css = foundationCss
    .replace(/(\.back-to-top \{[\s\S]*?)border: 3px solid var\(--signal-dark\);/, "$1border: 1px solid var(--signal-dark);")
    .replaceAll(".back-to-top:focus-visible", ".back-to-top.removed-focus");
  const result = await verifyFixtureCss(css);
  assert.ok(errorIds(result).includes("css-focus"));
});

test("foundation parser preserves quoted and functional semicolons before later properties", () => {
  const rules = parseCssRules('.probe { content: "alpha;{beta}:gamma"; --payload: fn(alpha; { beta }); color: red; min-height: 44px; }');
  assert.equal(rules.length, 1);
  assert.equal(rules[0].declarations.get("content"), '"alpha;{beta}:gamma"');
  assert.equal(rules[0].declarations.get("--payload"), "fn(alpha; { beta })");
  assert.equal(rules[0].declarations.get("color"), "red");
  assert.equal(rules[0].declarations.get("min-height"), "44px");
});

test("foundation rejects low-contrast derivative tokens and component surfaces", async () => {
  const css = foundationCss
    .replace(/--signal-dark:\s*#[0-9A-Fa-f]{6}/, "--signal-dark: #D94B2B")
    .replace(/--ink-secondary:\s*#[0-9A-Fa-f]{6}/, "--ink-secondary: #52707A");
  const result = await verifyFixtureCss(css);
  assert.ok(errorIds(result).includes("css-contrast"));
});

test("foundation rejects the core signal behind normal white control text", async () => {
  const css = foundationCss.replace(
    /(\.chat-send \{[\s\S]*?background: )var\(--signal-dark\)/,
    "$1var(--signal)"
  );
  const result = await verifyFixtureCss(css);
  assert.ok(errorIds(result).includes("css-contrast"));
});

test("foundation requires explicit focus contrast on dark and signal surfaces", async () => {
  const css = foundationCss
    .replaceAll("#about :focus-visible", "#about .removed-focus")
    .replaceAll(".home-cta :focus-visible", ".home-cta .removed-focus");
  const result = await verifyFixtureCss(css);
  assert.ok(errorIds(result).includes("css-focus"));
});

test("foundation requires a tokenized bridge for the inline diagram border", async () => {
  const css = foundationCss.replaceAll(".diag-frame", ".removed-diag-frame");
  const result = await verifyFixtureCss(css);
  assert.ok(errorIds(result).includes("css-interface"));
});

test("foundation requires 44 by 44 targets outside mobile media queries", async () => {
  const css = foundationCss.replace(/(\.breadcrumb a \{[\s\S]*?)\s*min-width: 44px;/, "$1");
  const result = await verifyFixtureCss(css);
  assert.ok(errorIds(result).includes("css-target"));
});

test("home scope honors the requested language", async () => {
  const review = fact({ id: "review.only-pl", value: "review", display_pl: "PL review", display_en: "EN review", source_type: "internal_evidence", source_label: "Expected internal evidence; not inspected", status: "review", surfaces: ["index.html", "en/index.html"] });
  const root = await fixture({ facts: [fact(), review], pl: "Marka PL review", en: "Brand" });
  const pl = await runVerification({ root, scope: "home", lang: "pl" });
  const en = await runVerification({ root, scope: "home", lang: "en" });
  assert.ok(errorIds(pl).includes("fact-review.only-pl"));
  assert.ok(!errorIds(en).includes("fact-review.only-pl"));
});

const heroes = [
  ["hero.experience_years", "25+", "25+", "25+", "25+"],
  ["hero.implementations", "20+", "20+", "20+", "20+"],
  ["hero.project_value_eur", "500M EUR", "EUR 500M", "500M <span>EUR</span>", "500M <span>EUR</span>"],
  ["hero.managed_spend_pln", "50 mld PLN", "PLN 50bn", "50 mld <span>PLN</span>", "50B <span>PLN</span>"]
];

for (const [id, display_pl, display_en, pl, en] of heroes) {
  for (const [lang, page] of [["pl", pl], ["en", en]]) {
    test(`home scope independently catches ${id} on ${lang} with split markup`, async () => {
      const review = fact({
        id,
        value: display_pl,
        display_pl,
        display_en,
        kind: "constant",
        as_of: null,
        source_type: "internal_evidence",
        source_label: "Flight Plan candidate display; semantic owner gate pending",
        status: "review",
        aliases: lang === "pl" ? { pl: [], en: ["500M EUR", "50B PLN"] } : { pl: ["500M EUR", "50 mld PLN"], en: ["500M EUR", "50B PLN"] }
      });
      const root = await fixture({ facts: [fact(), review], pl: `Marka ${page}`, en: `Brand ${page}` });
      const result = await runVerification({ root, scope: "home", lang });
      assert.deepEqual(errorIds(result), [`fact-${id}`]);
    });
  }
}
