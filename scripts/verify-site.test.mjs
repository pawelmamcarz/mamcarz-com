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

const navigationFixture = {
  pl: `
    <nav class="site-nav" aria-label="Nawigacja główna">
      <a href="/" class="nav-logo">PM</a>
      <button class="nav-toggle" id="nav-toggle" aria-label="Otwórz menu" aria-controls="nav-menu" aria-expanded="false"><span></span><span></span><span></span></button>
      <ul class="nav-list" id="nav-menu">
        <li><details class="nav-group"><summary>Doradztwo</summary><ul class="nav-submenu">
          <li><a href="/uslugi/transformacja-zakupow/">Transformacja zakupów</a></li>
          <li><a href="/uslugi/wdrozenie-sap-ariba/">Wdrożenie SAP Ariba</a></li>
          <li><a href="/uslugi/doradztwo-zamowienia-publiczne/">Zamówienia publiczne</a></li>
        </ul></details></li>
        <li><a href="/aplikacje-operacyjne/">Aplikacje operacyjne</a></li>
        <li><a href="/lotnictwo/">Lotnictwo</a></li>
        <li><a href="/case-studies/">Case studies</a></li>
        <li><a href="/wiedza/">Wiedza</a></li>
        <li><a href="/#about">O mnie</a></li>
        <li><a href="/#contact">Kontakt</a></li>
      </ul>
      <a href="/en/" class="nav-lang">EN</a>
    </nav>
    <div class="nav-overlay" id="nav-overlay"></div>`,
  en: `
    <nav class="site-nav" aria-label="Main navigation">
      <a href="/en/" class="nav-logo">PM</a>
      <button class="nav-toggle" id="nav-toggle" aria-label="Open menu" aria-controls="nav-menu" aria-expanded="false"><span></span><span></span><span></span></button>
      <ul class="nav-list" id="nav-menu">
        <li><details class="nav-group"><summary>Advisory</summary><ul class="nav-submenu">
          <li><a href="/en/uslugi/transformacja-zakupow/">Procurement transformation</a></li>
          <li><a href="/en/uslugi/wdrozenie-sap-ariba/">SAP Ariba implementation</a></li>
          <li><a href="/en/uslugi/doradztwo-zamowienia-publiczne/">Public procurement</a></li>
        </ul></details></li>
        <li><a href="/en/aplikacje-operacyjne/">Operational applications</a></li>
        <li><a href="/en/lotnictwo/">Aviation</a></li>
        <li><a href="/en/case-studies/">Case studies</a></li>
        <li><a href="/en/wiedza/">Insights</a></li>
        <li><a href="/en/#about">About</a></li>
        <li><a href="/en/#contact">Contact</a></li>
      </ul>
      <a href="/" class="nav-lang">PL</a>
    </nav>
    <div class="nav-overlay" id="nav-overlay"></div>`
};

const legacyNavigationFixture = `
  <nav aria-label="Main navigation">
    <a href="/" class="nav-logo">PM</a>
    <ul class="nav-links" id="navLinks"><li><a href="/#about">About</a></li></ul>
    <button class="nav-hamburger" id="navHamburger" aria-controls="navLinks" aria-expanded="false"><span></span><span></span><span></span></button>
  </nav>`;

const validBrowserScript = `
function initNavigation() {
  const toggle = document.getElementById("nav-toggle");
  const menu = document.getElementById("nav-menu");
  const overlay = document.getElementById("nav-overlay");
  if (!toggle || !menu) return;
  document.documentElement.classList.add("js");
  toggle.addEventListener("click", () => menu.classList.toggle("is-open"));
  overlay?.addEventListener("click", () => menu.classList.remove("is-open"));
}
function initBackToTop() {
  const backToTop = document.getElementById("backToTop");
  if (!backToTop) return;
  backToTop.addEventListener("click", () => window.scrollTo({ top: 0 }));
}
function initChat() {
  const chatMessages = document.getElementById("chat-messages");
  const chatInput = document.getElementById("chat-input");
  const chatSendButton = document.getElementById("chat-send");
  if (!chatMessages || !chatInput || !chatSendButton) return;
  const CHAT_API = "https://mamcarz-chat-api.pawel-767.workers.dev";
  function addChatMessage(text, role) {
    const message = document.createElement("div");
    message.className = \`chat-msg chat-msg--\${role}\`;
    message.textContent = text;
    chatMessages.append(message);
    return message;
  }
  const message = document.createElement("div");
  const fallbackLink = document.createElement("a");
  fallbackLink.href = "mailto:pawel@mamcarz.com";
  fallbackLink.textContent = "pawel@mamcarz.com";
  message.append(fallbackLink);
  addChatMessage(CHAT_API, "bot");
}
initNavigation();
initBackToTop();
initChat();`;

function homepageFixture(lang, content) {
  return `${navigationFixture[lang]}<main><h1>${lang.toUpperCase()}</h1>${content}<a class="js-email" href="mailto:pawel@mamcarz.com">pawel@mamcarz.com</a></main><input id="chat-input" maxlength="2000">`;
}

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

async function fixture({ facts = [fact()], blocked_claims = [blockedClaim()], pl = "Marka", en = "Brand", plHtml, enHtml, serviceHtml = legacyNavigationFixture, notFoundHtml = legacyNavigationFixture, css = "body{}", js = validBrowserScript, extraFiles = {} } = {}) {
  const root = await mkdtemp(resolve(tmpdir(), "verify-site-test-"));
  await Promise.all([
    mkdir(resolve(root, "content"), { recursive: true }),
    mkdir(resolve(root, "assets/css"), { recursive: true }),
    mkdir(resolve(root, "assets/js"), { recursive: true }),
    mkdir(resolve(root, "en"), { recursive: true }),
    mkdir(resolve(root, "uslugi/wdrozenie-sap-ariba"), { recursive: true }),
    mkdir(resolve(root, "worker"), { recursive: true })
  ]);
  await Promise.all([
    writeFile(resolve(root, "content/site-facts.json"), JSON.stringify({ version: 1, facts, blocked_claims })),
    writeFile(resolve(root, "index.html"), plHtml ?? homepageFixture("pl", pl)),
    writeFile(resolve(root, "en/index.html"), enHtml ?? homepageFixture("en", en)),
    writeFile(resolve(root, "uslugi/wdrozenie-sap-ariba/index.html"), serviceHtml),
    writeFile(resolve(root, "404.html"), notFoundHtml),
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

const navigationMutations = {
  pl: {
    missingRoute: (html) => html.replace('href="/lotnictwo/"', 'href="/usunieta-trasa/"').concat('<!-- <a href="/lotnictwo/">Lotnictwo</a> --><a href="/lotnictwo/">poza nawigacją</a>'),
    outOfOrder: (html) => html
      .replace('<li><a href="/aplikacje-operacyjne/">Aplikacje operacyjne</a></li>', "__OPERATIONS__")
      .replace('<li><a href="/lotnictwo/">Lotnictwo</a></li>', '<li><a href="/aplikacje-operacyjne/">Aplikacje operacyjne</a></li>')
      .replace("__OPERATIONS__", '<li><a href="/lotnictwo/">Lotnictwo</a></li>'),
    wrongLanguage: (html) => html.replace('<a href="/en/" class="nav-lang">', '<a href="/" class="nav-lang">')
  },
  en: {
    missingRoute: (html) => html.replace('href="/en/lotnictwo/"', 'href="/en/removed-route/"').concat('<!-- <a href="/en/lotnictwo/">Aviation</a> --><a href="/en/lotnictwo/">outside navigation</a>'),
    outOfOrder: (html) => html
      .replace('<li><a href="/en/aplikacje-operacyjne/">Operational applications</a></li>', "__OPERATIONS__")
      .replace('<li><a href="/en/lotnictwo/">Aviation</a></li>', '<li><a href="/en/aplikacje-operacyjne/">Operational applications</a></li>')
      .replace("__OPERATIONS__", '<li><a href="/en/lotnictwo/">Aviation</a></li>'),
    wrongLanguage: (html) => html.replace('<a href="/" class="nav-lang">', '<a href="/en/" class="nav-lang">')
  }
};

for (const lang of ["pl", "en"]) {
  test(`foundation catches a missing ${lang} route only inside the actual navigation`, async () => {
    const html = navigationMutations[lang].missingRoute(homepageFixture(lang, lang === "pl" ? "Marka" : "Brand"));
    const root = await fixture({ [`${lang}Html`]: html, css: foundationCss });
    const result = await runVerification({ root, scope: "foundation" });
    assert.ok(errorIds(result).includes("nav-route"));
  });

  test(`foundation catches an out-of-order ${lang} navigation route`, async () => {
    const html = navigationMutations[lang].outOfOrder(homepageFixture(lang, lang === "pl" ? "Marka" : "Brand"));
    const root = await fixture({ [`${lang}Html`]: html, css: foundationCss });
    const result = await runVerification({ root, scope: "foundation" });
    assert.ok(errorIds(result).includes("nav-route"));
  });

  test(`foundation catches a duplicate ${lang} navigation id outside comments`, async () => {
    const html = homepageFixture(lang, lang === "pl" ? "Marka" : "Brand").concat('<div id="nav-menu"></div><!-- <div id="nav-toggle"></div> -->');
    const root = await fixture({ [`${lang}Html`]: html, css: foundationCss });
    const result = await runVerification({ root, scope: "foundation" });
    assert.ok(errorIds(result).includes("nav-id"));
    assert.equal(result.errors.filter((entry) => entry.includes("nav-toggle")).length, 0);
  });

  test(`foundation catches the wrong paired-language homepage on ${lang}`, async () => {
    const html = navigationMutations[lang].wrongLanguage(homepageFixture(lang, lang === "pl" ? "Marka" : "Brand"));
    const root = await fixture({ [`${lang}Html`]: html, css: foundationCss });
    const result = await runVerification({ root, scope: "foundation" });
    assert.ok(errorIds(result).includes("nav-language"));
  });

  test(`foundation requires maxlength 2000 on the ${lang} homepage chat input`, async () => {
    const html = homepageFixture(lang, lang === "pl" ? "Marka" : "Brand").replace(' maxlength="2000"', "");
    const root = await fixture({ [`${lang}Html`]: html, css: foundationCss });
    const result = await runVerification({ root, scope: "foundation" });
    assert.ok(errorIds(result).includes("chat-maxlength"));
  });

  test(`foundation keeps a usable no-JS email link on the ${lang} homepage`, async () => {
    const html = homepageFixture(lang, lang === "pl" ? "Marka" : "Brand").replace('href="mailto:pawel@mamcarz.com"', 'href="#"');
    const root = await fixture({ [`${lang}Html`]: html, css: foundationCss });
    const result = await runVerification({ root, scope: "foundation" });
    assert.ok(errorIds(result).includes("contact-link"));
  });
}

test("foundation requires the advisory group to use native details markup", async () => {
  const html = homepageFixture("pl", "Marka")
    .replace('<details class="nav-group">', '<div class="nav-group">')
    .replace("</details>", "</div>");
  const root = await fixture({ plHtml: html, css: foundationCss });
  const result = await runVerification({ root, scope: "foundation" });
  assert.ok(errorIds(result).includes("nav-advisory"));
});

test("foundation requires the exact localized advisory submenu", async () => {
  const html = homepageFixture("en", "Brand")
    .replace('href="/en/uslugi/doradztwo-zamowienia-publiczne/"', 'href="/en/uslugi/other/"')
    .replace("Public procurement", "Other advisory");
  const root = await fixture({ enHtml: html, css: foundationCss });
  const result = await runVerification({ root, scope: "foundation" });
  assert.ok(errorIds(result).includes("nav-advisory"));
});

test("foundation requires each defensive initializer and invocation", async () => {
  for (const initializer of ["initNavigation", "initBackToTop", "initChat"]) {
    const js = validBrowserScript.replaceAll(initializer, `removed${initializer}`);
    const root = await fixture({ css: foundationCss, js });
    const result = await runVerification({ root, scope: "foundation" });
    assert.ok(errorIds(result).includes("js-initializer"), initializer);
  }
});

test("foundation requires the navigation guard before the only JS marker", async () => {
  const marker = 'document.documentElement.classList.add("js");';
  const js = `${marker}\n${validBrowserScript.replace(marker, "")}\n// ${marker}`;
  const root = await fixture({ css: foundationCss, js });
  const result = await runVerification({ root, scope: "foundation" });
  assert.ok(errorIds(result).includes("js-navigation-marker"));
});

for (const [option, path] of [["serviceHtml", "uslugi/wdrozenie-sap-ariba/index.html"], ["notFoundHtml", "404.html"]]) {
  test(`foundation requires legacy in-flow navigation markup on ${path}`, async () => {
    const html = legacyNavigationFixture.replace('class="nav-links"', 'class="removed-nav-links"');
    const root = await fixture({ [option]: html, css: foundationCss });
    const result = await runVerification({ root, scope: "foundation" });
    assert.ok(result.errors.some((entry) => entry.startsWith(`ERROR legacy-nav ${path}:`)));
  });
}

test("foundation protects every existing mobile legacy navigation fallback branch", async () => {
  const visibleLinks = foundationCss.replace(
    /(@media \(max-width: 759px\) \{[\s\S]*?\.nav-list,\s*\.nav-links \{[\s\S]*?)display: block;/,
    "$1display: none;"
  );
  const mutations = [
    ["containing nav relative", foundationCss.replace(
      "html:not(.js):not(.js-reveal) body > nav:not(.breadcrumb) {\n    position: relative;",
      "html:not(.js):not(.js-reveal) body > nav:not(.breadcrumb) {\n    position: absolute;"
    )],
    ["legacy list static", foundationCss.replace(
      "html:not(.js):not(.js-reveal) body > nav:not(.breadcrumb) .nav-links {\n    position: static;",
      "html:not(.js):not(.js-reveal) body > nav:not(.breadcrumb) .nav-links {\n    position: absolute;"
    )],
    ["legacy list visible", visibleLinks],
    ["legacy toggle hidden", foundationCss.replace(".nav-hamburger { display: none; }", ".nav-hamburger { display: inline-flex; }")]
  ];
  for (const [label, css] of mutations) {
    assert.notEqual(css, foundationCss, label);
    const root = await fixture({ css });
    const result = await runVerification({ root, scope: "foundation" });
    assert.ok(errorIds(result).includes("css-legacy-nav-fallback"), label);
  }
});

test("foundation rejects unsafe innerHTML assignment in the browser script", async () => {
  const root = await fixture({ css: foundationCss, js: `${validBrowserScript}\nmessage.innerHTML = data.reply;` });
  const result = await runVerification({ root, scope: "foundation" });
  assert.ok(errorIds(result).includes("js-inner-html"));
});

test("foundation requires text-only chat messages and a DOM-built fallback email link", async () => {
  const js = validBrowserScript
    .replace("message.textContent = text;", "message.innerText = text;")
    .replace('fallbackLink.href = "mailto:pawel@mamcarz.com";', 'fallbackLink.href = "#";');
  const root = await fixture({ css: foundationCss, js });
  const result = await runVerification({ root, scope: "foundation" });
  assert.ok(errorIds(result).includes("js-chat-dom"));
});

test("foundation keeps the exact chat Worker URL", async () => {
  const js = validBrowserScript.replace("https://mamcarz-chat-api.pawel-767.workers.dev", "https://example.invalid");
  const root = await fixture({ css: foundationCss, js });
  const result = await runVerification({ root, scope: "foundation" });
  assert.ok(errorIds(result).includes("js-chat-api"));
});

test("foundation rejects restored reveal or timeline animation behavior", async () => {
  const js = `${validBrowserScript}\ndocument.querySelectorAll(".reveal");\ndocument.querySelectorAll(".timeline-item");`;
  const root = await fixture({ css: foundationCss, js });
  const result = await runVerification({ root, scope: "foundation" });
  assert.ok(errorIds(result).includes("js-animation"));
});

test("foundation requires null guards even when the missing guard survives in a comment", async () => {
  const mutations = [
    ['if (!toggle || !menu) return;', "// if (!toggle || !menu) return;"],
    ['if (!backToTop) return;', "// if (!backToTop) return;"],
    ['if (!chatMessages || !chatInput || !chatSendButton) return;', "// if (!chatMessages || !chatInput || !chatSendButton) return;"]
  ];
  for (const [guard, comment] of mutations) {
    const js = validBrowserScript.replace(guard, "").concat("\n", comment);
    const root = await fixture({ css: foundationCss, js });
    const result = await runVerification({ root, scope: "foundation" });
    assert.ok(errorIds(result).includes("js-guard"), guard);
  }
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
