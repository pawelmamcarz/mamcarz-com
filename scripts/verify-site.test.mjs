import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { runInNewContext } from "node:vm";

import { parseCssRules, readFacts, runVerification } from "./verify-site.mjs";

const execFileAsync = promisify(execFile);
const modulePath = resolve("scripts/verify-site.mjs");
const foundationCss = await readFile(resolve("assets/css/style.css"), "utf8");
const publicClaimSurfaceFixture = [
  "index.html",
  "en/index.html",
  "llms.txt",
  "llms-full.txt",
  "worker/index.js",
  "assets/js/main.js"
];

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
        <li><a href="/case-studies/">Projekty</a></li>
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
        <li><a href="/en/case-studies/">Projects</a></li>
        <li><a href="/en/wiedza/">Knowledge</a></li>
        <li><a href="/en/#about">About</a></li>
        <li><a href="/en/#contact">Contact</a></li>
      </ul>
      <a href="/" class="nav-lang">PL</a>
    </nav>
    <div class="nav-overlay" id="nav-overlay"></div>`
};

const plan2RoutePairs = [
  ["index.html", "en/index.html", "/", "/en/", "home"],
  ["uslugi/transformacja-zakupow/index.html", "en/uslugi/transformacja-zakupow/index.html", "/uslugi/transformacja-zakupow/", "/en/uslugi/transformacja-zakupow/", "services"],
  ["uslugi/wdrozenie-sap-ariba/index.html", "en/uslugi/wdrozenie-sap-ariba/index.html", "/uslugi/wdrozenie-sap-ariba/", "/en/uslugi/wdrozenie-sap-ariba/", "services"],
  ["uslugi/doradztwo-zamowienia-publiczne/index.html", "en/uslugi/doradztwo-zamowienia-publiczne/index.html", "/uslugi/doradztwo-zamowienia-publiczne/", "/en/uslugi/doradztwo-zamowienia-publiczne/", "services"],
  ["aplikacje-operacyjne/index.html", "en/aplikacje-operacyjne/index.html", "/aplikacje-operacyjne/", "/en/aplikacje-operacyjne/", "applications"],
  ["lotnictwo/index.html", "en/lotnictwo/index.html", "/lotnictwo/", "/en/lotnictwo/", "aviation"],
  ["case-studies/index.html", "en/case-studies/index.html", "/case-studies/", "/en/case-studies/", "projects"],
  ["wiedza/index.html", "en/wiedza/index.html", "/wiedza/", "/en/wiedza/", "knowledge"],
  ["wystapienia/index.html", "en/wystapienia/index.html", "/wystapienia/", "/en/wystapienia/", "speaking"]
];

const plan2Families = ["all", "home", "services", "applications", "aviation", "projects", "knowledge", "speaking", "artifacts"];

function pageNavigationFixture(lang, pairedRoute) {
  const currentLanguageLink = lang === "pl"
    ? '<a href="/en/" class="nav-lang">EN</a>'
    : '<a href="/" class="nav-lang">PL</a>';
  const pairedLanguageLink = lang === "pl"
    ? `<a href="${pairedRoute}" class="nav-lang">EN</a>`
    : `<a href="${pairedRoute}" class="nav-lang">PL</a>`;
  return navigationFixture[lang].replace(currentLanguageLink, pairedLanguageLink);
}

function pageShellFixture({ lang, plRoute, enRoute, body = "", head = "", title = "Page" }) {
  const route = lang === "pl" ? plRoute : enRoute;
  const pairedRoute = lang === "pl" ? enRoute : plRoute;
  return `<!doctype html><html lang="${lang}"><head>
    <title>${title}</title>
    <link rel="canonical" href="https://mamcarz.com${route}">
    <link rel="alternate" hreflang="pl" href="https://mamcarz.com${plRoute}">
    <link rel="alternate" hreflang="en" href="https://mamcarz.com${enRoute}">
    <link rel="alternate" hreflang="x-default" href="https://mamcarz.com${plRoute}">
    <link rel="stylesheet" href="/assets/css/style.css?v=20260825-flightplan-2">
    ${head}
  </head><body data-page="fixture">
    <a class="skip-link" href="#main">Skip</a>
    ${pageNavigationFixture(lang, pairedRoute)}
    <main id="main" tabindex="-1"><header class="page-hero"><h1>${title}</h1></header>${body}</main>
    <footer class="site-footer"><a href="mailto:pawel@mamcarz.com">Contact</a></footer>
    <script src="/assets/js/main.js?v=20260825-flightplan-2" defer></script>
  </body></html>`;
}

function pagePairFiles(pair, overrides = {}) {
  const [plFile, enFile, plRoute, enRoute] = pair;
  return {
    [plFile]: overrides.pl ?? pageShellFixture({ lang: "pl", plRoute, enRoute, title: "Strona" }),
    [enFile]: overrides.en ?? pageShellFixture({ lang: "en", plRoute, enRoute, title: "Page" })
  };
}

async function pageArchitectureFixture({ files, facts, extraFiles = {} } = {}) {
  const routeFiles = files ?? Object.assign({}, ...plan2RoutePairs.map((pair) => pagePairFiles(pair)));
  const remaining = { ...routeFiles, ...extraFiles };
  const plHtml = remaining["index.html"];
  const enHtml = remaining["en/index.html"];
  const serviceHtml = remaining["uslugi/wdrozenie-sap-ariba/index.html"];
  delete remaining["index.html"];
  delete remaining["en/index.html"];
  delete remaining["uslugi/wdrozenie-sap-ariba/index.html"];
  return fixture({
    facts,
    plHtml,
    enHtml,
    serviceHtml,
    extraFiles: remaining
  });
}

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

const controlledAboutCopy = {
  pl: {
    label: "O mnie",
    narratives: [
      ["decision-before-tool", "Zaczynam od ustalenia, kto podejmuje decyzję, na jakich danych i w jakich ograniczeniach. Dopiero potem wybieram proces, technologię i sposób wdrożenia."],
      ["responsibility-across-domains", "W zakupach pracuję z odpowiedzialnością za pieniądze, ryzyko i interesariuszy. W aplikacjach przekładam te decyzje na przepływ pracy, dane i kontrolę. Lotnictwo wnosi dyscyplinę procedur oraz jasny podział odpowiedzialności."]
    ]
  },
  en: {
    label: "About me",
    narratives: [
      ["decision-before-tool", "I begin by establishing who makes the decision, what data they use and what constraints apply. Only then do I choose the process, technology and implementation approach."],
      ["responsibility-across-domains", "In procurement, I take responsibility for money, risk and stakeholders. In applications, I translate those decisions into workflows, data and controls. Aviation brings procedural discipline and a clear division of responsibility."]
    ]
  }
};

const controlledAboutFacts = [
  ["aviation.ppl_h", "PPL(H)", "PPL(H)"],
  ["aviation.ppl_a", "PPL(A)", "PPL(A)"],
  ["aviation.aerobatics_rating", "uprawnienia do akrobacji", "aerobatics rating"],
  ["aviation.diverse_extreme_team", "pilot pokazowy Diverse Extreme Team (2013)", "display pilot for the Diverse Extreme Team (2013)"],
  ["aviation.forum_photographer", "fotograf prasowy agencji Forum", "Press photographer with Forum Agency"],
  ["aviation.air_to_air_media", "sesje air-to-air, realizacje wideo i dronem", "air-to-air shoots, video and drone production"]
];

function controlledAboutFixture(lang) {
  const copy = controlledAboutCopy[lang];
  const factItems = controlledAboutFacts.map(([id, displayPl, displayEn]) => `
        <li class="about-fact" data-fact-id="${id}">${lang === "pl" ? displayPl : displayEn}</li>`).join("");
  return `<div class="about-text">
      <p class="section-label">${copy.label}</p>
      <h2>Controlled About</h2>
      ${copy.narratives.map(([id, text]) => `<p data-about-copy="${id}">${text}</p>`).join("\n      ")}
      <ul class="about-facts">${factItems}
      </ul>
      <div class="expertise-list"><div class="expertise-item">Decision</div><div class="expertise-item">Process</div><div class="expertise-item">Delivery</div></div>
    </div>`;
}

function publicProcurementSkillsFixture(lang, { href, labels, outcome } = {}) {
  const localized = lang === "pl"
    ? { href: "/uslugi/doradztwo-zamowienia-publiczne/", labels: ["Problem", "Działanie", "Możliwy wynik"], title: "Zamówienia publiczne" }
    : { href: "/en/uslugi/doradztwo-zamowienia-publiczne/", labels: ["Problem", "Action", "Possible outcome"], title: "Public procurement" };
  const ledgerLabels = labels ?? [localized.labels[0], localized.labels[1], outcome ?? localized.labels[2]];
  const ledger = ledgerLabels.map((label) => `<div><dt>${label}</dt><dd>One</dd></div>`).join("");
  return `<article class="evidence-row" data-domain="advisory" data-service="public-procurement"><h3><a href="${href ?? localized.href}">${localized.title}</a></h3><dl>${ledger}</dl></article>`;
}

function replaceHomepageSection(html, sectionId, replacement) {
  return html.replace(new RegExp(`<section id="${sectionId}">[\\s\\S]*?<\\/section>`), replacement);
}

function homepageFixture(lang, content) {
  const projectsHref = lang === "pl" ? "/case-studies" : "/en/case-studies";
  const projectsLabel = lang === "pl" ? "Projekty" : "Projects";
  const processLabels = lang === "pl"
    ? ["Diagnoza", "Strategia", "Wdrożenie", "Wartość"]
    : ["Diagnosis", "Strategy", "Implementation", "Value"];
  const contactIntents = lang === "pl"
    ? [["Doradztwo", "Doradztwo"], ["Aplikacja operacyjna", "Aplikacja%20operacyjna"], ["Lotnictwo", "Lotnictwo"]]
    : [["Advisory", "Advisory"], ["Operational application", "Operational%20application"], ["Aviation", "Aviation"]];
  const skipLabel = lang === "pl" ? "Przejdź do treści" : "Skip to main content";
  return `<!doctype html><html lang="${lang}"><head>
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Person"}</script>
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite"}</script>
    <link rel="preload" as="font" type="font/woff2" href="/assets/fonts/barlow-semi-condensed-latin-600-normal.woff2" crossorigin>
    <link rel="preload" as="font" type="font/woff2" href="/assets/fonts/barlow-semi-condensed-latin-ext-600-normal.woff2" crossorigin>
    <link rel="stylesheet" href="/assets/css/style.css?v=20260825-flightplan-1">
  </head><body>
    <a href="#main" class="skip-link">${skipLabel}</a>
    ${navigationFixture[lang]}<main id="main">
    <section id="hero"><h1 data-fact-id="brand.promise">${content}</h1><img src="/assets/img/IMG_3284-480.webp" alt="" width="960" height="1280" fetchpriority="high"></section>
    <section data-section="trust"></section>
    <section id="process">${processLabels.map((label, index) => `<article class="route-sequence__step"><p class="section-index">0${index + 1} / ${label}</p><h3>${label}</h3></article>`).join("")}</section>
    <aside data-cta-after="process"></aside>
    <section id="cases"></section>
    <aside data-cta-after="cases"></aside>
    <section id="about">${controlledAboutFixture(lang)}</section>
    <section id="education"></section>
    <section id="resume"></section>
    <section id="skills"><article class="evidence-row" data-domain="applications"><h3>${lang === "pl" ? "Aplikacje operacyjne" : "Operational applications"}</h3><dl><div><dt>Problem</dt><dd>One</dd></div><div><dt>${lang === "pl" ? "Działanie" : "Action"}</dt><dd>Two</dd></div><div><dt>${lang === "pl" ? "Możliwy wynik" : "Possible outcome"}</dt><dd>Three</dd></div></dl></article>${publicProcurementSkillsFixture(lang)}</section>
    <section id="portfolio"></section>
    <section id="clients"></section>
    <section id="contact">${contactIntents.map(([label, subject]) => `<a class="contact-detail" href="mailto:pawel@mamcarz.com?subject=${subject}">${label}</a>`).join("")}<a class="js-email" href="mailto:pawel@mamcarz.com">pawel@mamcarz.com</a></section>
  </main><footer><a href="${projectsHref}">${projectsLabel}</a></footer><input id="chat-input" maxlength="2000">
    <script src="/assets/js/main.js?v=20260825-flightplan-1" defer></script>
  </body></html>`;
}

function parityInventoryFixture(lang) {
  const title = (id, value) => `<div class="pcard__title" data-fact-id="${id}">${value}</div>`;
  const client = (id, value) => `<div class="client-item" data-fact-id="${id}">${value}</div>`;
  return homepageFixture(lang, lang === "pl" ? "Marka" : "Brand")
    .replace('<section id="portfolio"></section>', `<section id="portfolio"><div class="portfolio-cards"><a class="pcard" href="https://alpha.example">${title("portfolio.alpha", "Alpha")}</a><a class="pcard" href="https://beta.example">${title("portfolio.beta", "Beta")}</a></div></section>`)
    .replace('<section id="clients"></section>', `<section id="clients">${client("client.alpha", "Alpha Client")}${client("client.beta", "Beta Client")}</section>`);
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

async function fixture({ facts = [fact()], blocked_claims = [blockedClaim()], public_claim_surfaces = publicClaimSurfaceFixture, pl = "Marka", en = "Brand", plHtml, enHtml, serviceHtml = legacyNavigationFixture, notFoundHtml = legacyNavigationFixture, css = "body{}", js = validBrowserScript, llms = "", llmsFull = "", worker = "", heroImage = Buffer.from("fixture"), extraFiles = {} } = {}) {
  const root = await mkdtemp(resolve(tmpdir(), "verify-site-test-"));
  const fixtureFacts = [...facts];
  for (const [id, displayPl, displayEn] of controlledAboutFacts) {
    if (!fixtureFacts.some((record) => record.id === id)) {
      fixtureFacts.push(fact({ id, value: displayEn, display_pl: displayPl, display_en: displayEn }));
    }
  }
  await Promise.all([
    mkdir(resolve(root, "content"), { recursive: true }),
    mkdir(resolve(root, "assets/css"), { recursive: true }),
    mkdir(resolve(root, "assets/js"), { recursive: true }),
    mkdir(resolve(root, "assets/img"), { recursive: true }),
    mkdir(resolve(root, "en"), { recursive: true }),
    mkdir(resolve(root, "uslugi/wdrozenie-sap-ariba"), { recursive: true }),
    mkdir(resolve(root, "worker"), { recursive: true })
  ]);
  await Promise.all([
    writeFile(resolve(root, "content/site-facts.json"), JSON.stringify({ version: 1, public_claim_surfaces, facts: fixtureFacts, blocked_claims })),
    writeFile(resolve(root, "index.html"), plHtml ?? homepageFixture("pl", pl)),
    writeFile(resolve(root, "en/index.html"), enHtml ?? homepageFixture("en", en)),
    writeFile(resolve(root, "uslugi/wdrozenie-sap-ariba/index.html"), serviceHtml),
    writeFile(resolve(root, "404.html"), notFoundHtml),
    writeFile(resolve(root, "assets/css/style.css"), css),
    writeFile(resolve(root, "assets/js/main.js"), js),
    ...(heroImage === null ? [] : [writeFile(resolve(root, "assets/img/IMG_3284-480.webp"), heroImage)]),
    writeFile(resolve(root, "llms.txt"), llms),
    writeFile(resolve(root, "llms-full.txt"), llmsFull),
    writeFile(resolve(root, "worker/index.js"), worker),
    ...Object.entries(extraFiles).map(async ([relativePath, content]) => {
      const filePath = resolve(root, relativePath);
      await mkdir(resolve(filePath, ".."), { recursive: true });
      await writeFile(filePath, content);
    })
  ]);
  return root;
}

async function currentHomepageMutationFixture(lang, mutate) {
  const [factData, plHtml, enHtml] = await Promise.all([
    readFacts(),
    readFile(resolve("index.html"), "utf8"),
    readFile(resolve("en/index.html"), "utf8")
  ]);
  const current = lang === "pl" ? plHtml : enHtml;
  const mutated = mutate(current);
  assert.notEqual(mutated, current, `current ${lang} homepage mutation must change the fixture`);
  return fixture({
    facts: factData.facts,
    blocked_claims: factData.blocked_claims,
    plHtml: lang === "pl" ? mutated : plHtml,
    enHtml: lang === "en" ? mutated : enHtml
  });
}

function errorIds(result) {
  return result.errors.map((error) => error.split(" ")[1]);
}

function publicSurfaceOptions(surface, text) {
  if (surface === "index.html") return { plHtml: `<p>${text}</p>` };
  if (surface === "en/index.html") return { enHtml: `<p>${text}</p>` };
  if (surface === "llms.txt") return { llms: text };
  if (surface === "llms-full.txt") return { llmsFull: text };
  if (surface === "worker/index.js") return { worker: `const publicCopy = ${JSON.stringify(text)};` };
  if (surface === "assets/js/main.js") return { js: `const publicCopy = ${JSON.stringify(text)};` };
  throw new Error(`Unsupported public claim surface fixture: ${surface}`);
}

const productionFactSurfaceControls = {
  llms: [
    "Neutral context before the controlled claims.",
    "25+ years of procurement experience.",
    "Neutral context between the controlled claims.",
    "20+ SAP Ariba implementations.",
    "Neutral context after the controlled claims."
  ].join("\n"),
  llmsFull: [
    "Neutral context before the controlled claims.",
    "25+ years of procurement experience.",
    "20+ SAP Ariba implementations.",
    "Total value of delivered projects: EUR 500M.",
    "Current aviation venture: akrobacja.com.",
    "Voucher sales platform for aerobatic flights.",
    "Neutral context after the controlled claims."
  ].join("\n"),
  worker: `const verifiedFacts = ${JSON.stringify([
    "Neutral context before the controlled claims.",
    "25+ lat doświadczenia w zakupach",
    "20+ wdrożeń SAP Ariba",
    "Łączna wartość zrealizowanych projektów: 500 mln EUR.",
    "Aktualna marka działalności lotniczej: akrobacja.com.",
    "Platforma sprzedaży voucherów na loty akrobacyjne.",
    "Neutral context after the controlled claims."
  ].join("\n"))};`
};

async function productionRegistryFixture(overrides = {}) {
  const factData = await readFacts();
  return fixture({
    facts: factData.facts,
    blocked_claims: factData.blocked_claims,
    public_claim_surfaces: factData.public_claim_surfaces,
    llms: productionFactSurfaceControls.llms,
    llmsFull: productionFactSurfaceControls.llmsFull,
    worker: productionFactSurfaceControls.worker,
    ...overrides
  });
}

async function verifyFixtureCss(css) {
  const root = await fixture({ css });
  return runVerification({ root, scope: "foundation" });
}

const applicationsPair = plan2RoutePairs.find((pair) => pair[4] === "applications");

async function applicationPageMutation({ lang = "pl", mutate = (html) => html, facts, body = "", extraFiles = {} } = {}) {
  const [, , plRoute, enRoute] = applicationsPair;
  const base = pageShellFixture({ lang, plRoute, enRoute, title: lang === "pl" ? "Aplikacje" : "Applications", body });
  const mutated = mutate(base);
  assert.notEqual(mutated, "", "application page mutation must leave a fixture document");
  const overrides = lang === "pl" ? { pl: mutated } : { en: mutated };
  const root = await pageArchitectureFixture({ files: pagePairFiles(applicationsPair, overrides), facts, extraFiles });
  return runVerification({ root, scope: "pages", family: "applications" });
}

function movePageMetadata(html, destination) {
  const metadata = [
    '<link rel="canonical" href="https://mamcarz.com/aplikacje-operacyjne/">',
    '<link rel="alternate" hreflang="pl" href="https://mamcarz.com/aplikacje-operacyjne/">',
    '<link rel="alternate" hreflang="en" href="https://mamcarz.com/en/aplikacje-operacyjne/">',
    '<link rel="alternate" hreflang="x-default" href="https://mamcarz.com/aplikacje-operacyjne/">'
  ];
  let moved = html;
  for (const tag of metadata) {
    assert.ok(moved.includes(tag), `fixture must contain ${tag}`);
    moved = moved.replace(tag, "");
  }
  return moved.replace('<body data-page="fixture">', `<body data-page="fixture">${destination(metadata.join(""))}`);
}

test("Plan 2 Task 1 uses the exact route manifest and accepts every declared family", async () => {
  const root = await pageArchitectureFixture();
  await Promise.all(plan2RoutePairs.flatMap((pair) => pair.slice(0, 2)).map((path) => rm(resolve(root, path), { force: true })));

  for (const family of plan2Families) {
    const result = await runVerification({ root, scope: "pages", family });
    const expectedFiles = plan2RoutePairs
      .filter((pair) => family === "all" || pair[4] === family)
      .flatMap((pair) => pair.slice(0, 2));
    const actualFiles = result.errors
      .filter((entry) => entry.startsWith("ERROR route-file "))
      .map((entry) => /^ERROR route-file ([^:]+):/.exec(entry)?.[1]);
    assert.deepEqual(actualFiles, expectedFiles, `${family} must select only its exact manifest files`);
    assert.ok(!errorIds(result).includes("cli-family"), `${family} must be accepted`);
    assert.ok(!errorIds(result).includes("cli-scope"), "pages must be an accepted scope");
  }
});

test("Plan 2 Task 1 rejects an unsupported family before page verification", async () => {
  const root = await pageArchitectureFixture();
  const result = await runVerification({ root, scope: "pages", family: "unsupported" });
  assert.ok(errorIds(result).includes("cli-family"));
  assert.equal(result.errors.some((entry) => entry.startsWith("ERROR route-file ")), false);
});

test("Plan 2 Task 1 CLI accepts artifacts explicitly and rejects an invalid family", async () => {
  const accepted = await execFileAsync(process.execPath, [modulePath, "--scope=pages", "--family=artifacts"]);
  assert.match(accepted.stdout, /deferred: artifacts-contract/);
  await assert.rejects(
    execFileAsync(process.execPath, [modulePath, "--scope=pages", "--family=invalid-family"]),
    (cause) => cause.stderr.includes("ERROR cli-family scripts/verify-site.mjs: unsupported family invalid-family")
  );
});

test("Plan 2 Task 1 package exposes the isolated pages command", async () => {
  const packageData = JSON.parse(await readFile(resolve("package.json"), "utf8"));
  assert.equal(packageData.scripts["verify:pages"], "node scripts/verify-site.mjs --scope=pages");
});

test("Plan 2 Task 1 aggregates both missing files in the selected family", async () => {
  const root = await fixture();
  const result = await runVerification({ root, scope: "pages", family: "applications" });
  const missing = result.errors.filter((entry) => entry.startsWith("ERROR route-file "));
  assert.deepEqual(missing, [
    "ERROR route-file aplikacje-operacyjne/index.html: required file is missing",
    "ERROR route-file en/aplikacje-operacyjne/index.html: required file is missing"
  ]);
});

test("Plan 2 Task 1 isolates another unfinished family but all still requires every target", async () => {
  const files = pagePairFiles(applicationsPair);
  const root = await pageArchitectureFixture({ files });
  const selected = await runVerification({ root, scope: "pages", family: "applications" });
  assert.deepEqual(selected.errors, [], selected.errors.join("\n"));

  const all = await runVerification({ root, scope: "pages", family: "all" });
  assert.ok(all.errors.some((entry) => entry === "ERROR route-file lotnictwo/index.html: required file is missing"));
  assert.ok(all.errors.some((entry) => entry === "ERROR route-file en/wiedza/index.html: required file is missing"));
});

test("Plan 2 Task 1 accepts a complete paired shell and exposes bounded future hooks", async () => {
  const root = await pageArchitectureFixture();
  const result = await runVerification({ root, scope: "pages", family: "all" });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.deferred, ["procurement-parent-contract", "artifacts-contract"]);
});

test("Plan 2 Task 1 counts only active h1 and main elements", async () => {
  const mutations = [
    ["hidden h1 decoy", "page-h1", (html) => html.replace("<h1>Aplikacje</h1>", "<h1 hidden>Aplikacje</h1><template><h1>Aplikacje</h1></template>")],
    ["duplicate visible h1", "page-h1", (html) => html.replace("</header>", "<h1>Drugi nagłówek</h1></header>")],
    ["hidden main decoy", "page-main", (html) => html.replace('<main id="main"', '<main hidden id="main"')],
    ["duplicate visible main", "page-main", (html) => html.replace('<footer class="site-footer">', '<main id="duplicate"><p>Duplicate</p></main><footer class="site-footer">')]
  ];
  for (const [label, expectedId, mutate] of mutations) {
    const result = await applicationPageMutation({ mutate });
    assert.ok(errorIds(result).includes(expectedId), label);
  }
});

test("Plan 2 Task 1 requires exact canonical, real hreflang and paired language switch", async () => {
  const [, , plRoute, enRoute] = applicationsPair;
  const correctCanonical = `https://mamcarz.com${plRoute}`;
  const correctEnglish = `https://mamcarz.com${enRoute}`;
  const mutations = [
    ["canonical hidden decoy", "page-canonical", (html) => html
      .replace(`href="${correctCanonical}"`, 'href="https://mamcarz.com/wrong/"')
      .replace("</head>", `<link rel="canonical" href="${correctCanonical}" hidden></head>`)],
    ["hreflang template decoy", "page-hreflang", (html) => html
      .replace(`hreflang="en" href="${correctEnglish}"`, 'hreflang="en" href="https://mamcarz.com/en/wrong/"')
      .replace("</head>", `<template><link rel="alternate" hreflang="en" href="${correctEnglish}"></template></head>`)],
    ["wrong paired language switch", "page-language", (html) => html
      .replace(`<a href="${enRoute}" class="nav-lang">EN</a>`, '<a href="/en/" class="nav-lang">EN</a>')
      .replace("</nav>", `<a href="${enRoute}" class="nav-lang" hidden>EN</a></nav>`)]
  ];
  for (const [label, expectedId, mutate] of mutations) {
    const result = await applicationPageMutation({ mutate });
    assert.ok(errorIds(result).includes(expectedId), label);
  }
});

test("Plan 2 Task 1 rejects inactive asset decoys and navigation routes outside site-nav", async () => {
  const mutations = [
    ["stylesheet template decoy", "page-stylesheet", (html) => html.replace(
      '<link rel="stylesheet" href="/assets/css/style.css?v=20260825-flightplan-2">',
      '<link rel="stylesheet" href="/assets/css/wrong.css"><template><link rel="stylesheet" href="/assets/css/style.css?v=20260825-flightplan-2"></template>'
    )],
    ["stylesheet hidden decoy", "page-stylesheet", (html) => html.replace(
      '<link rel="stylesheet" href="/assets/css/style.css?v=20260825-flightplan-2">',
      '<link rel="stylesheet" href="/assets/css/wrong.css"><link rel="stylesheet" href="/assets/css/style.css?v=20260825-flightplan-2" hidden>'
    )],
    ["script noscript decoy", "page-script", (html) => html.replace(
      '<script src="/assets/js/main.js?v=20260825-flightplan-2" defer></script>',
      '<script src="/assets/js/main.js?v=20260825-flightplan-2"></script><noscript><script src="/assets/js/main.js?v=20260825-flightplan-2" defer></script></noscript>'
    )],
    ["script template decoy", "page-script", (html) => html.replace(
      '<script src="/assets/js/main.js?v=20260825-flightplan-2" defer></script>',
      '<script src="/assets/js/main.js?v=20260825-flightplan-2"></script><template><script src="/assets/js/main.js?v=20260825-flightplan-2" defer></script></template>'
    )],
    ["script hidden decoy", "page-script", (html) => html.replace(
      '<script src="/assets/js/main.js?v=20260825-flightplan-2" defer></script>',
      '<script src="/assets/js/main.js?v=20260825-flightplan-2"></script><script src="/assets/js/main.js?v=20260825-flightplan-2" defer hidden></script>'
    )],
    ["route outside navigation", "page-navigation", (html) => html
      .replace('<a href="/lotnictwo/">Lotnictwo</a>', '<a href="/usunieta-trasa/">Lotnictwo</a>')
      .replace("</main>", '<a href="/lotnictwo/">Lotnictwo decoy</a></main>')]
  ];
  for (const [label, expectedId, mutate] of mutations) {
    const result = await applicationPageMutation({ mutate });
    assert.ok(errorIds(result).includes(expectedId), label);
  }
});

test("Plan 2 Task 1 tokenizes approved data-fact-ids on HTML whitespace", async () => {
  const result = await applicationPageMutation({
    body: '<article data-fact-ids="brand.promise\n\taviation.ppl_h">Evidence</article>'
  });
  assert.deepEqual(result.errors, []);
});

test("Plan 2 Task 1 rejects unknown and comma-joined data-fact-ids", async () => {
  for (const value of ["claim.unknown", "brand.promise,aviation.ppl_h"]) {
    const result = await applicationPageMutation({ body: `<article data-fact-ids="${value}">Evidence</article>` });
    assert.ok(errorIds(result).includes("page-fact-unknown"), value);
  }
});

test("Plan 2 Task 1 rejects review and retired data-fact-ids", async () => {
  const nonApproved = [
    fact({ id: "claim.review", value: "review", display_pl: "review", display_en: "review", status: "review" }),
    fact({ id: "claim.retired", value: "retired", display_pl: "retired", display_en: "retired", status: "retired" })
  ];
  for (const record of nonApproved) {
    const result = await applicationPageMutation({
      facts: [fact(), ...nonApproved],
      body: `<article data-fact-ids="${record.id}">Evidence</article>`
    });
    assert.ok(result.errors.some((entry) => entry.startsWith(`ERROR page-fact-status aplikacje-operacyjne/index.html: ${record.id} has status ${record.status}`)));
  }
});

test("Plan 2 Task 1 resolves href, src and srcset after query and fragment stripping", async () => {
  const body = `
    <a href="/?from=applications#top">Home</a>
    <a href="/downloads/?mode=full#section">Download hub</a>
    <a href="/assets/docs/probe.pdf?download=1#page-2">PDF</a>
    <img src="/assets/img/probe.webp?v=1#hero" srcset="/assets/img/probe-480.webp?v=1 480w, /assets/img/probe-960.webp#wide 960w" alt="">`;
  const result = await applicationPageMutation({
    body,
    extraFiles: {
      "downloads/index.html": "download fixture",
      "assets/docs/probe.pdf": "pdf fixture",
      "assets/img/probe.webp": "image fixture",
      "assets/img/probe-480.webp": "image fixture",
      "assets/img/probe-960.webp": "image fixture"
    }
  });
  assert.deepEqual(result.errors, []);
});

test("Plan 2 Task 1 aggregates missing href, src and every srcset target", async () => {
  const body = `
    <a href="/missing-page/?mode=full#section">Missing page</a>
    <img src="/assets/img/missing.png?v=1#hero" srcset="/assets/img/missing-480.webp 480w, /assets/img/missing-960.webp#wide 960w" alt="">`;
  const result = await applicationPageMutation({ body });
  const missing = result.errors.filter((entry) => entry.startsWith("ERROR local-target "));
  assert.equal(missing.length, 4, missing.join("\n"));
  for (const target of ["missing-page/index.html", "assets/img/missing.png", "assets/img/missing-480.webp", "assets/img/missing-960.webp"]) {
    assert.ok(missing.some((entry) => entry.includes(target)), target);
  }
});

test("Plan 2 Task 1 ignores fragments, mail, external URLs, protocol-relative URLs and the Worker", async () => {
  const body = `
    <a href="#main">Fragment</a>
    <a href="mailto:pawel@mamcarz.com">Mail</a>
    <a href="https://example.com/missing">External</a>
    <a href="//cdn.example.com/missing.png">CDN</a>
    <a href="https://mamcarz-chat-api.pawel-767.workers.dev">Worker</a>
    <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" alt="">`;
  const result = await applicationPageMutation({ body });
  assert.deepEqual(result.errors, []);
});

test("Plan 2 Task 1 never defers assets or non-manifest local routes", async () => {
  const body = '<a href="/lotnictwo/">Deferred route</a><a href="/unplanned/">Missing local page</a><img src="/assets/img/missing.webp" alt="">';
  const result = await applicationPageMutation({ body });
  const missing = result.errors.filter((entry) => entry.startsWith("ERROR local-target "));
  assert.equal(missing.length, 2, missing.join("\n"));
  assert.ok(missing.some((entry) => entry.includes("unplanned/index.html")));
  assert.ok(missing.some((entry) => entry.includes("assets/img/missing.webp")));
  assert.equal(missing.some((entry) => entry.includes("lotnictwo/index.html")), false);
});

test("Plan 2 Task 1 fix round 1 rejects repeated, empty and complete malformed family CLI values", async () => {
  const cases = [
    ["repeated valid and invalid", ["--scope=pages", "--family=artifacts", "--family=invalid-family"]],
    ["repeated valid", ["--scope=pages", "--family=artifacts", "--family=artifacts"]],
    ["complete value after first equals", ["--scope=pages", "--family=artifacts=invalid-family"]],
    ["missing equals", ["--scope=pages", "--family"]],
    ["empty value", ["--scope=pages", "--family="]]
  ];
  const outcomes = await Promise.all(cases.map(async ([label, args]) => {
    try {
      const result = await execFileAsync(process.execPath, [modulePath, ...args]);
      return { label, rejected: false, stdout: result.stdout, stderr: result.stderr };
    } catch (cause) {
      return { label, rejected: true, stdout: cause.stdout, stderr: cause.stderr };
    }
  }));
  for (const outcome of outcomes) {
    assert.equal(outcome.rejected, true, `${outcome.label} must exit nonzero`);
    assert.equal(outcome.stdout, "", `${outcome.label} must not print a success`);
    const errorLines = outcome.stderr.trim().split("\n").filter((line) => line.startsWith("ERROR "));
    assert.equal(errorLines.length, 1, `${outcome.label} must stop before page verification`);
    assert.match(errorLines[0], /^ERROR cli-family scripts\/verify-site\.mjs:/, outcome.label);
  }

  const root = await pageArchitectureFixture();
  for (const family of ["", "artifacts=invalid-family"]) {
    const result = await runVerification({ root, scope: "pages", family });
    assert.ok(errorIds(result).includes("cli-family"), `direct API must reject ${JSON.stringify(family)}`);
    assert.equal(result.errors.length, 1, "invalid direct API family must skip pages");
    assert.deepEqual(result.deferred, [], "invalid direct API family must not run future hooks");
  }
});

test("Plan 2 Task 1 fix round 1 requires metadata in exactly one active head", async () => {
  const mutations = [
    ["body metadata", ["page-canonical", "page-hreflang"], (html) => movePageMetadata(html, (metadata) => metadata)],
    ["template metadata", ["page-canonical", "page-hreflang"], (html) => movePageMetadata(html, (metadata) => `<template>${metadata}</template>`)],
    ["noscript metadata", ["page-canonical", "page-hreflang"], (html) => movePageMetadata(html, (metadata) => `<noscript>${metadata}</noscript>`)],
    ["duplicate head", ["page-head"], (html) => html.replace("</head>", "</head><head></head>")],
    ["malformed head", ["page-html-syntax"], (html) => html.replace("</head>", "</hed>")]
  ];
  const outcomes = await Promise.all(mutations.map(async ([label, expectedIds, mutate]) => ({
    label,
    expectedIds,
    result: await applicationPageMutation({ mutate })
  })));
  for (const { label, expectedIds, result } of outcomes) {
    for (const expectedId of expectedIds) assert.ok(errorIds(result).includes(expectedId), `${label}: ${expectedId}`);
  }
});

test("Plan 2 Task 1 fix round 1 requires the exact visible paired-language label", async () => {
  const [, , plRoute, enRoute] = applicationsPair;
  const cases = [
    ["wrong PL-page label", "pl", (html) => html.replace(`<a href="${enRoute}" class="nav-lang">EN</a>`, `<a href="${enRoute}" class="nav-lang">FR</a>`), true],
    ["wrong EN-page label", "en", (html) => html.replace(`<a href="${plRoute}" class="nav-lang">PL</a>`, `<a href="${plRoute}" class="nav-lang">EN</a>`), true],
    ["hidden label plus unrelated body decoy", "pl", (html) => html
      .replace(`<a href="${enRoute}" class="nav-lang">EN</a>`, `<a href="${enRoute}" class="nav-lang"><span hidden>EN</span></a>`)
      .replace("</main>", "<span>EN</span></main>"), true],
    ["visible inline label", "pl", (html) => html.replace(`<a href="${enRoute}" class="nav-lang">EN</a>`, `<a href="${enRoute}" class="nav-lang"><span>E</span><span>N</span></a>`), false]
  ];
  const outcomes = await Promise.all(cases.map(async ([label, lang, mutate, shouldFail]) => ({
    label,
    shouldFail,
    result: await applicationPageMutation({ lang, mutate })
  })));
  for (const { label, shouldFail, result } of outcomes) {
    assert.equal(errorIds(result).includes("page-language"), shouldFail, label);
  }
});

test("Plan 2 Task 1 fix round 1 treats inline CSS and closed details as statically hidden", async () => {
  const cases = [
    ["display none", (html) => html.replace("<h1>Aplikacje</h1>", '<h1 style="display:none">Aplikacje</h1>'), true],
    ["mixed-case important display none", (html) => html.replace("<h1>Aplikacje</h1>", '<h1 style="  DiSpLaY :  NoNe !IMPORTANT  ">Aplikacje</h1>'), true],
    ["mixed-case visibility hidden", (html) => html.replace("<h1>Aplikacje</h1>", '<h1 style=" VISIBILITY : Hidden ">Aplikacje</h1>'), true],
    ["hidden ancestor", (html) => html.replace("<h1>Aplikacje</h1>", "<div hidden><h1>Aplikacje</h1></div>"), true],
    ["aria-hidden ancestor", (html) => html.replace("<h1>Aplikacje</h1>", '<div aria-hidden="true"><h1>Aplikacje</h1></div>'), true],
    ["closed details", (html) => html.replace("<h1>Aplikacje</h1>", "<details><h1>Aplikacje</h1></details>"), true],
    ["open details", (html) => html.replace("<h1>Aplikacje</h1>", "<details open><h1>Aplikacje</h1></details>"), false],
    ["benign inline style", (html) => html.replace("<h1>Aplikacje</h1>", '<h1 style="color: red">Aplikacje</h1>'), false]
  ];
  const outcomes = await Promise.all(cases.map(async ([label, mutate, shouldFail]) => ({
    label,
    shouldFail,
    result: await applicationPageMutation({ mutate })
  })));
  for (const { label, shouldFail, result } of outcomes) {
    assert.equal(errorIds(result).includes("page-h1"), shouldFail, label);
  }
});

test("Plan 2 Task 1 fix round 1 normalizes browser whitespace and HTML entities in local URLs", async () => {
  const body = `
    <a href=" \t/missing-leading/ \n">Leading whitespace</a>
    <a href="&#47;missing-decimal/">Decimal slash</a>
    <a href="&#x2f;missing-hex/">Hex slash</a>
    <a href="&sol;missing-named/">Named slash</a>
    <img src=" \n&#x2f;assets/img/missing-src.webp\t " alt="">
    <img srcset="&sol;assets/img/missing-srcset.webp&Tab;1x, &#47;assets/img/missing-srcset-2.webp 2x" alt="">`;
  const result = await applicationPageMutation({ body });
  const missing = result.errors.filter((entry) => entry.startsWith("ERROR local-target "));
  for (const target of [
    "missing-leading/index.html",
    "missing-decimal/index.html",
    "missing-hex/index.html",
    "missing-named/index.html",
    "assets/img/missing-src.webp",
    "assets/img/missing-srcset.webp",
    "assets/img/missing-srcset-2.webp"
  ]) {
    assert.ok(missing.some((entry) => entry.includes(target)), target);
  }
  assert.equal(missing.length, 7, missing.join("\n"));
});

test("Plan 2 Task 1 fix round 1 preserves internal URL whitespace and ignores normalized non-local schemes", async () => {
  const body = `
    <a href=" /space target/ ">Internal whitespace</a>
    <a href=" \t#main \n">Fragment</a>
    <a href=" mailto:pawel@mamcarz.com ">Mail</a>
    <a href=" https://example.com/missing ">External</a>
    <a href=" &sol;&sol;cdn.example.com/missing.png ">Protocol-relative</a>`;
  const result = await applicationPageMutation({
    body,
    extraFiles: { "space target/index.html": "internal-space fixture" }
  });
  assert.deepEqual(result.errors, []);
});

test("Plan 2 Task 1 fix round 1 reports another-family manifest targets that are not files", async () => {
  const files = pagePairFiles(applicationsPair);
  const root = await pageArchitectureFixture({ files });
  await mkdir(resolve(root, "lotnictwo/index.html"), { recursive: true });
  const result = await runVerification({ root, scope: "pages", family: "applications" });
  assert.ok(result.errors.some((entry) => entry.startsWith("ERROR local-target aplikacje-operacyjne/index.html:")
    && entry.includes("lotnictwo/index.html (NOT_FILE)")), result.errors.join("\n"));
});

test("Plan 2 Task 1 fix round 1 rejects duplicate fact tokens while accepting a unique list", async () => {
  const [duplicate, unique] = await Promise.all([
    applicationPageMutation({ body: '<article data-fact-ids="brand.promise\n\tbrand.promise">Duplicate</article>' }),
    applicationPageMutation({ body: '<article data-fact-ids="brand.promise\n\taviation.ppl_h">Unique</article>' })
  ]);
  assert.ok(errorIds(duplicate).includes("page-fact-ids"));
  assert.equal(errorIds(unique).includes("page-fact-ids"), false);
  assert.deepEqual(unique.errors, []);
});

test("Plan 2 Task 1 fix round 2 rejects nested, misordered and duplicate document roots", async () => {
  const extractBlock = (html, opening, closing) => {
    const start = html.indexOf(opening);
    const end = html.indexOf(closing, start) + closing.length;
    assert.ok(start >= 0 && end >= closing.length, `${opening} fixture block must exist`);
    return { block: html.slice(start, end), start, end };
  };
  const moveHeadIntoBody = (html) => {
    const head = extractBlock(html, "<head>", "</head>");
    const withoutHead = html.slice(0, head.start) + html.slice(head.end);
    return withoutHead.replace('<body data-page="fixture">', `<body data-page="fixture">${head.block}`);
  };
  const putBodyBeforeHead = (html) => {
    const head = extractBlock(html, "<head>", "</head>");
    const body = extractBlock(html, '<body data-page="fixture">', "</body>");
    assert.ok(head.end <= body.start, "fixture head must precede body");
    return html.slice(0, head.start) + body.block + head.block + html.slice(body.end);
  };
  const cases = [
    ["head nested in body", moveHeadIntoBody],
    ["body before head", putBodyBeforeHead],
    ["duplicate head", (html) => html.replace("</head>", "</head><head></head>")],
    ["duplicate body", (html) => html.replace('<body data-page="fixture">', '<body></body><body data-page="fixture">')],
    ["duplicate html root", (html) => html.replace("</html>", "</html><html></html>")],
    ["body nested below div", (html) => html
      .replace('<body data-page="fixture">', '<div><body data-page="fixture">')
      .replace("</body></html>", "</body></div></html>")],
    ["missing body element", (html) => html.replace('<body data-page="fixture">', "").replace("</body>", "")]
  ];
  const outcomes = await Promise.all(cases.map(async ([label, mutate]) => ({
    label,
    result: await applicationPageMutation({ mutate })
  })));
  for (const { label, result } of outcomes) {
    assert.ok(errorIds(result).includes("page-document"), label);
  }
  const valid = await applicationPageMutation();
  assert.deepEqual(valid.errors, []);
});

test("Plan 2 Task 1 fix round 2 decodes and comment-normalizes hidden inline styles", async () => {
  const cases = [
    ["comment before colon", 'style="display/**/:none"', true],
    ["comment after colon", 'style="display:/**/none"', true],
    ["mixed-case comment and whitespace", 'style=" DiSpLaY /**/ : NoNe !IMPORTANT "', true],
    ["visibility comment", 'style="VISIBILITY/**/: hidden"', true],
    ["decimal colon", 'style="display&#58;none"', true],
    ["hex colon", 'style="visibility&#x3A;hidden"', true],
    ["named colon", 'style="display&colon;none"', true],
    ["entity-encoded comment", 'style="display&sol;**&sol;&colon;none"', true],
    ["unterminated comment", 'style="display/*:none"', true],
    ["benign comment", 'style="color: red /**/"', false],
    ["quoted comment markers", 'style="font-family: \'/*\'; color: red"', false]
  ];
  const outcomes = await Promise.all(cases.map(async ([label, style, shouldFail]) => ({
    label,
    shouldFail,
    result: await applicationPageMutation({ mutate: (html) => html.replace("<h1>Aplikacje</h1>", `<h1 ${style}>Aplikacje</h1>`) })
  })));
  for (const { label, shouldFail, result } of outcomes) {
    assert.equal(errorIds(result).includes("page-h1"), shouldFail, label);
  }
});

test("Plan 2 Task 1 fix round 2 decodes the complete srcset before candidate splitting", async () => {
  const body = `
    <img srcset="/assets/css/style.css 1x&#44; /missing-decimal-comma.webp 2x" alt="">
    <img srcset="/assets/css/style.css 1x&#x2c; &#x2f;missing-hex-comma.webp 2x" alt="">
    <img srcset="/assets/css/style.css 1x&comma; &sol;missing-named-comma.webp&Tab;2x" alt="">
    <img src="/assets/css/style.css?first=1&amp;second=2" alt="">
    <img srcset="&amp;sol;not-root-after-one-decode.webp 1x, &sol;&sol;cdn.example.com/external.webp 2x" alt="">`;
  const result = await applicationPageMutation({ body });
  const missing = result.errors.filter((entry) => entry.startsWith("ERROR local-target "));
  for (const target of [
    "missing-decimal-comma.webp",
    "missing-hex-comma.webp",
    "missing-named-comma.webp"
  ]) {
    assert.ok(missing.some((entry) => entry.includes(target)), target);
  }
  assert.equal(missing.length, 3, missing.join("\n"));
});

test("Plan 2 Task 1 fix round 3 parses complete srcset URLs without comma false positives", async () => {
  const body = `
    <img srcset="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ 1x" alt="">
    <img srcset="https://cdn.example.com/a,/missing-external.webp 1x" alt="">
    <img srcset="//cdn.example.com/a,/missing-protocol-relative.webp 1x" alt="">
    <img srcset="/assets/img/image,wide.webp 2x" alt="">
    <img srcset="/assets/img/ordinary-a.jpg 1x, /missing-ordinary-b.jpg 2x" alt="">
    <img srcset="/assets/img/no-descriptor-a.jpg, /missing-no-descriptor-b.jpg" alt="">
    <img srcset="/assets/img/multiple-descriptors.jpg 480w 320h, /missing-after-multiple.webp 2x" alt="">
    <img srcset=",,, /missing-leading.webp 1x,, /missing-after-empty.webp 2x,," alt="">`;
  const result = await applicationPageMutation({
    body,
    extraFiles: {
      "assets/img/image,wide.webp": "comma-bearing local image fixture",
      "assets/img/ordinary-a.jpg": "ordinary candidate fixture",
      "assets/img/no-descriptor-a.jpg": "no-descriptor candidate fixture",
      "assets/img/multiple-descriptors.jpg": "multiple-descriptor candidate fixture"
    }
  });
  const missing = result.errors.filter((entry) => entry.startsWith("ERROR local-target "));
  const expectedTargets = [
    "missing-ordinary-b.jpg",
    "missing-no-descriptor-b.jpg",
    "missing-after-multiple.webp",
    "missing-leading.webp",
    "missing-after-empty.webp"
  ];
  assert.equal(missing.length, expectedTargets.length, missing.join("\n"));
  for (const target of expectedTargets) assert.ok(missing.some((entry) => entry.includes(target)), target);
});

test("Plan 2 Task 1 fix round 3 decodes browser numeric references and CSS escapes in hidden styles", async () => {
  const cases = [
    ["decimal colon without semicolon", 'style="display&#58none"', true],
    ["hex colon without semicolon", 'style="visibility&#x3Ahidden"', true],
    ["decimal colon with semicolon", 'style="display&#58;none"', true],
    ["hex colon with semicolon", 'style="visibility&#x3A;hidden"', true],
    ["escaped property", 'style="d\\69splay:none"', true],
    ["escaped property with terminator", 'style="d\\69 splay:none"', true],
    ["escaped value with terminator", 'style="display:n\\6f ne"', true],
    ["mixed-case escaped property", 'style="D\\69SPLAY:NoNe !IMPORTANT"', true],
    ["simple escaped property character", 'style="displa\\y:none"', true],
    ["trailing escape", 'style="color:red\\"', true],
    ["escape before newline", 'style="color:red\\\n"', true],
    ["one-pass entity control", 'style="d&amp;#92;69splay:none"', false],
    ["benign quoted backslash", 'style="font-family: \'C:\\Fonts\'; color:red"', false]
  ];
  const outcomes = await Promise.all(cases.map(async ([label, style, shouldFail]) => ({
    label,
    shouldFail,
    result: await applicationPageMutation({ mutate: (html) => html.replace("<h1>Aplikacje</h1>", `<h1 ${style}>Aplikacje</h1>`) })
  })));
  const mismatches = outcomes
    .filter(({ shouldFail, result }) => errorIds(result).includes("page-h1") !== shouldFail)
    .map(({ label }) => label);
  assert.deepEqual(mismatches, [], `visibility mismatches: ${mismatches.join(", ")}`);
});

test("Plan 2 Task 1 fix round 4 honors exact-case named references in rendered text and inline styles", async () => {
  const [, , , enRoute] = applicationsPair;
  const cases = [
    ["exact whitespace names in rendered text", (html) => html.replace(`<a href="${enRoute}" class="nav-lang">EN</a>`, `<a href="${enRoute}" class="nav-lang">&Tab;EN&NewLine;</a>`), "page-language", false],
    ["invalid whitespace name case in rendered text", (html) => html.replace(`<a href="${enRoute}" class="nav-lang">EN</a>`, `<a href="${enRoute}" class="nav-lang">&TAB;EN&NEWLINE;</a>`), "page-language", true],
    ["exact lowercase colon hides the heading", (html) => html.replace("<h1>Aplikacje</h1>", '<h1 style="display&colon;none">Aplikacje</h1>'), "page-h1", true],
    ["invalid uppercase colon leaves the heading visible", (html) => html.replace("<h1>Aplikacje</h1>", '<h1 style="display&COLON;none">Aplikacje</h1>'), "page-h1", false],
    ["exact lowercase bsol exposes a CSS escape", (html) => html.replace("<h1>Aplikacje</h1>", '<h1 style="d&bsol;69splay:none">Aplikacje</h1>'), "page-h1", true],
    ["invalid uppercase bsol remains literal", (html) => html.replace("<h1>Aplikacje</h1>", '<h1 style="d&BSOL;69splay:none">Aplikacje</h1>'), "page-h1", false],
    ["numeric to named reference stays one pass", (html) => html.replace("<h1>Aplikacje</h1>", '<h1 style="display&#38;colon;none">Aplikacje</h1>'), "page-h1", false],
    ["named to numeric reference stays one pass", (html) => html.replace("<h1>Aplikacje</h1>", '<h1 style="display&AMP;#58;none">Aplikacje</h1>'), "page-h1", false]
  ];
  const outcomes = await Promise.all(cases.map(async ([label, mutate, expectedId, shouldFail]) => ({
    label,
    expectedId,
    shouldFail,
    result: await applicationPageMutation({ mutate })
  })));
  const mismatches = outcomes
    .filter(({ expectedId, shouldFail, result }) => errorIds(result).includes(expectedId) !== shouldFail)
    .map(({ label }) => label);
  assert.deepEqual(mismatches, [], `named-reference mismatches: ${mismatches.join(", ")}`);
});

test("Plan 2 Task 1 fix round 4 honors exact-case and one-pass references in href and src", async () => {
  const body = `
    <a href="&Tab;&sol;missing-valid-tab/">Exact Tab and sol</a>
    <a href="&NewLine;&sol;missing-valid-newline/">Exact NewLine and sol</a>
    <a href="&TAB;&sol;not-local-invalid-tab/">Invalid uppercase Tab</a>
    <a href="&newline;&sol;not-local-invalid-newline/">Invalid lowercase newline</a>
    <a href="&#38;sol;not-local-numeric-one-pass/">Numeric to named one pass</a>
    <a href="&AMP;sol;not-local-named-one-pass/">Uppercase AMP alias one pass</a>
    <img src="&sol;assets/img/missing-valid-src.webp" alt="">
    <img src="&SOL;assets/img/not-local-invalid-src.webp" alt="">`;
  const result = await applicationPageMutation({ body });
  const missing = result.errors.filter((entry) => entry.startsWith("ERROR local-target "));
  const expectedTargets = [
    "missing-valid-tab/index.html",
    "missing-valid-newline/index.html",
    "assets/img/missing-valid-src.webp"
  ];
  assert.equal(missing.length, expectedTargets.length, missing.join("\n"));
  for (const target of expectedTargets) assert.ok(missing.some((entry) => entry.includes(target)), target);
});

test("Plan 2 Task 1 fix round 4 decodes only exact-case comma references in srcset", async () => {
  const body = `
    <img srcset="/assets/css/style.css 1x&comma; /missing-valid-comma.webp 2x" alt="">
    <img srcset="/assets/css/style.css 1x&COMMA; /not-a-browser-candidate.webp 2x" alt="">
    <img srcset="/assets/css/style.css 1x&#38;comma; /not-a-one-pass-candidate.webp 2x" alt="">`;
  const result = await applicationPageMutation({ body });
  const missing = result.errors.filter((entry) => entry.startsWith("ERROR local-target "));
  assert.deepEqual(missing.map((entry) => /missing ([^ ]+)/.exec(entry)?.[1]), ["missing-valid-comma.webp"], missing.join("\n"));
});

test("Plan 2 Task 1 fix round 4 fails closed on unterminated CSS strings and preserves valid escapes", async () => {
  const cases = [
    ["unterminated quoted value with trailing escape", String.raw`style="font-family:'abc\"`, true],
    ["unterminated quoted value", `style="font-family:'abc"`, true],
    ["closed quoted value", `style="font-family:'abc'; color:red"`, false],
    ["escaped quote", String.raw`style="font-family:'abc\'def'; color:red"`, false],
    ["escaped backslash", String.raw`style="font-family:'abc\\'; color:red"`, false],
    ["line continuation", `style="font-family:'abc\\\ndef'; color:red"`, false],
    ["CRLF continuation", `style="font-family:'abc\\\r\ndef'; color:red"`, false],
    ["quoted comments and declaration separators", `style="font-family:'abc;/*:*/def'; color:red"`, false]
  ];
  const outcomes = await Promise.all(cases.map(async ([label, style, shouldFail]) => ({
    label,
    shouldFail,
    result: await applicationPageMutation({ mutate: (html) => html.replace("<h1>Aplikacje</h1>", `<h1 ${style}>Aplikacje</h1>`) })
  })));
  const mismatches = outcomes
    .filter(({ shouldFail, result }) => errorIds(result).includes("page-h1") !== shouldFail)
    .map(({ label }) => label);
  assert.deepEqual(mismatches, [], `CSS string mismatches: ${mismatches.join(", ")}`);
});

test("Plan 2 Task 1 fix round 5 exposes only the first direct summary of closed details", async () => {
  const [, , , enRoute] = applicationsPair;
  const languageLink = `<a href="${enRoute}" class="nav-lang">EN</a>`;
  const cases = [
    ["direct text after an empty first summary", `<details><summary></summary>EN</details>`, true],
    ["comment then direct text after an empty first summary", `<details><summary></summary><!-- hidden branch -->EN</details>`, true],
    ["direct text without a summary", `<details>EN</details>`, true],
    ["text in a second direct summary", `<details><summary></summary><summary>EN</summary></details>`, true],
    ["direct text in a nested closed disclosure", `<details><summary><details><summary></summary>EN</details></summary></details>`, true],
    ["first-summary text and descendants", `<details><summary><span>E</span>N</summary><span>FR</span></details>`, false],
    ["direct text in an open disclosure", `<details open><summary></summary>EN</details>`, false],
    ["nested first-summary descendants", `<details><summary><details><summary><span>EN</span></summary>FR</details></summary>PL</details>`, false],
    ["first summary before a hidden second summary", `<details><summary>EN</summary><summary>FR</summary></details>`, false],
    ["hidden first summary", `<details><summary hidden>EN</summary></details>`, true],
    ["aria-hidden first summary", `<details><summary aria-hidden="true">EN</summary></details>`, true],
    ["template content in the first summary", `<details><summary><template>EN</template></summary></details>`, true]
  ];
  const outcomes = await Promise.all(cases.map(async ([label, content, shouldFail]) => ({
    label,
    shouldFail,
    result: await applicationPageMutation({ mutate: (html) => html.replace(languageLink, `<a href="${enRoute}" class="nav-lang">${content}</a>`) })
  })));
  const mismatches = outcomes
    .filter(({ shouldFail, result }) => errorIds(result).includes("page-language") !== shouldFail)
    .map(({ label }) => label);
  assert.deepEqual(mismatches, [], `closed-details text mismatches: ${mismatches.join(", ")}`);
});

test("Plan 2 Task 1 fix round 5 preserves inactive wrappers and disclosure-open route checks", async () => {
  const [, , , enRoute] = applicationsPair;
  const languageLink = `<a href="${enRoute}" class="nav-lang">EN</a>`;
  const inactiveCases = [
    ["hidden language link", `<a href="${enRoute}" class="nav-lang" hidden>EN</a>`],
    ["aria-hidden language link", `<a href="${enRoute}" class="nav-lang" aria-hidden="true">EN</a>`],
    ["language link inside template", `<template>${languageLink}</template>`],
    ["language link inside noscript", `<noscript>${languageLink}</noscript>`]
  ];
  const outcomes = await Promise.all(inactiveCases.map(async ([label, replacement]) => ({
    label,
    result: await applicationPageMutation({ mutate: (html) => html.replace(languageLink, replacement) })
  })));
  for (const { label, result } of outcomes) {
    assert.ok(errorIds(result).includes("page-language"), label);
  }

  const valid = await applicationPageMutation({
    mutate: (html) => html.replace(languageLink, `<a href="${enRoute}" class="nav-lang"><details><summary>EN</summary></details></a>`)
  });
  assert.equal(errorIds(valid).includes("page-language"), false, valid.errors.join("\n"));
  assert.equal(errorIds(valid).includes("page-navigation"), false, valid.errors.join("\n"));
});

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

test("registry keeps responsibility facts atomic and Polish-English meanings aligned", async () => {
  const { facts } = await readFacts();
  const byId = new Map(facts.map((record) => [record.id, record]));
  const expectedResponsibilities = {
    "career.apsolut.responsibility": ["Rozwijam działalność w regionie CEE.", "I develop the business in the CEE region."],
    "career.sap.responsibility": ["Rozwijałem rynek SAP Ariba w Polsce i regionie CEE.", "I developed the SAP Ariba market in Poland and the CEE region."],
    "career.pzu.responsibility": ["Prowadziłem projekt transformacji zakupów, od analizy wydatków do docelowego modelu operacyjnego.", "I led a procurement transformation project from spend analysis to the target operating model."],
    "career.pwc.responsibility": ["Pracowałem z metodyką CAPP (Complete & Agile Procurement).", "I worked with the CAPP (Complete & Agile Procurement) methodology."],
    "career.pkp_plk.responsibility": ["Negocjowałem umowę ramową z SAP AG dla grupy PKP.", "I negotiated an SAP AG framework agreement for the PKP Group."],
    "career.pkp_intercity.responsibility": ["Prowadziłem wdrożenie Revenue Management System (JDA/RPO).", "I led the Revenue Management System (JDA/RPO) implementation."],
    "career.orlen_connect.responsibility": ["Kierowałem wdrożeniem centralnej platformy sourcingowej CONNECT.", "I led the implementation of the central CONNECT sourcing platform."],
    "career.orlen_general.responsibility": ["Odpowiadałem za wdrożenie SAP SRM.", "I was responsible for the SAP SRM implementation."],
    "career.tp.responsibility": ["Koordynowałem krytyczne zmiany w programie wdrożenia Oracle EBS dla centrum SSC w Lublinie.", "I coordinated critical changes in the Oracle EBS implementation programme for the shared-services centre in Lublin."],
    "career.millennium.responsibility": ["Prowadziłem centralizację zakupów IT.", "I led the centralisation of IT procurement."],
    "career.elektrim.responsibility": ["Analizowałem rynki CEE w Wiedniu.", "I analysed CEE markets in Vienna."]
  };

  const responsibilityFacts = facts.filter((record) => record.id.startsWith("career.") && record.id.endsWith(".responsibility"));
  assert.equal(responsibilityFacts.length, Object.keys(expectedResponsibilities).length);
  for (const [id, [displayPl, displayEn]] of Object.entries(expectedResponsibilities)) {
    const record = byId.get(id);
    assert.ok(record, `${id} must exist`);
    assert.equal(record.display_pl, displayPl, `${id} must keep one conservative Polish responsibility`);
    assert.equal(record.display_en, displayEn, `${id} must be an exact English semantic mirror`);
    assert.equal((record.display_pl.match(/[.!?]/g) ?? []).length, 1, `${id} PL must be one sentence`);
    assert.equal((record.display_en.match(/[.!?]/g) ?? []).length, 1, `${id} EN must be one sentence`);
  }

  assert.deepEqual(
    [byId.get("project.kghm.role")?.display_pl, byId.get("project.kghm.role")?.display_en],
    ["Realizacja wdrożenia i integracji", "Implementation and integration delivery"]
  );
  assert.deepEqual(
    [byId.get("project.kghm.scope")?.display_pl, byId.get("project.kghm.scope")?.display_en],
    ["Sourcing i obsługa pracowników zewnętrznych", "Sourcing and external workforce management"]
  );

  const zabkaRecords = ["project.zabka.role", "project.zabka.implementation", "project.zabka.proof"].map((id) => byId.get(id));
  assert.ok(zabkaRecords.every(Boolean));
  assert.equal(new Set(zabkaRecords.map((record) => record.value)).size, 3, "Żabka role, functional scope and module proof must be independent facts");
  assert.deepEqual(
    zabkaRecords.map((record) => [record.display_pl, record.display_en]),
    [
      ["Realizacja wdrożenia SAP Ariba", "Delivery of the SAP Ariba implementation"],
      ["Zakupy, ryzyko dostawców i sourcing", "Procurement, supplier risk and sourcing"],
      ["SAP Ariba Buying, Supplier Risk i sourcing", "SAP Ariba Buying, Supplier Risk and sourcing"]
    ]
  );
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

test("Plan 1 broad review requires the complete public claim-surface inventory", async () => {
  const root = await fixture({
    public_claim_surfaces: publicClaimSurfaceFixture.filter((surface) => surface !== "assets/js/main.js")
  });
  const result = await runVerification({ root, scope: "facts" });
  assert.ok(errorIds(result).includes("public-surface-inventory"));
});

test("Plan 1 broad review enforces an additional registry-declared public surface", async () => {
  const display = "review claim on a registry extension";
  const root = await fixture({
    public_claim_surfaces: [...publicClaimSurfaceFixture, "press-kit.txt"],
    facts: [fact(), fact({
      id: "claim.review.registry_extension",
      value: display,
      display_pl: display,
      display_en: display,
      source_type: "internal_evidence",
      source_label: "Unapproved registry-extension fixture",
      surfaces: ["index.html"],
      status: "review"
    })],
    extraFiles: { "press-kit.txt": display }
  });
  const result = await runVerification({ root, scope: "facts" });
  assert.ok(
    result.errors.some((entry) => entry.startsWith("ERROR fact-surface-status press-kit.txt:")),
    result.errors.join("\n")
  );
});

for (const status of ["review", "retired"]) {
  for (const surface of publicClaimSurfaceFixture) {
    test(`Plan 1 broad review rejects ${status} publication on ${surface}`, async () => {
      const display = `${status} claim on ${surface}`;
      const statusFact = fact({
        id: `claim.${status}.${surface.replaceAll(/[^a-z0-9]+/gi, "_")}`,
        value: display,
        display_pl: display,
        display_en: display,
        source_type: "internal_evidence",
        source_label: `Unapproved ${status} fixture`,
        surfaces: ["index.html"],
        status
      });
      const root = await fixture({
        facts: [fact(), statusFact],
        ...publicSurfaceOptions(surface, display)
      });
      const result = await runVerification({ root, scope: "facts" });
      assert.ok(
        result.errors.some((entry) => entry.startsWith(`ERROR fact-surface-status ${surface}:`)),
        result.errors.join("\n")
      );
    });
  }
}

const highRiskSemanticDrifts = [
  {
    id: "hero.implementations",
    surface: "llms.txt",
    approved: "20+ SAP Ariba implementations",
    drift: "20+ SAP Ariba implementations, SAP Fieldglass and SAP S/4HANA"
  },
  {
    id: "hero.implementations",
    surface: "llms-full.txt",
    approved: "20+ SAP Ariba implementations",
    drift: "20+ SAP Ariba/Fieldglass/S/4HANA implementations"
  },
  {
    id: "hero.implementations",
    surface: "worker/index.js",
    approved: "20+ wdrożeń SAP Ariba",
    drift: "20+ wdrożeń SAP Ariba, SAP Fieldglass i SAP S/4HANA"
  },
  {
    id: "hero.project_value_eur",
    surface: "llms-full.txt",
    approved: "Total value of delivered projects: EUR 500M.",
    drift: "Total value of delivered projects: EUR 500M+."
  },
  {
    id: "hero.project_value_eur",
    surface: "worker/index.js",
    approved: "Łączna wartość zrealizowanych projektów: 500 mln EUR.",
    drift: "Łączna wartość zrealizowanych projektów: ponad 500 mln EUR."
  }
];

for (const { id, surface, approved, drift } of highRiskSemanticDrifts) {
  test(`Plan 1 broad review rejects semantic drift for ${id} on ${surface}`, async () => {
    const controlled = fact({
      id,
      value: approved,
      display_pl: approved,
      display_en: approved,
      surfaces: [surface],
      surface_rules: {
        [surface]: {
          approved_any: [approved],
          forbidden: [drift]
        }
      }
    });
    const root = await fixture({
      facts: [fact(), controlled],
      ...publicSurfaceOptions(surface, `${approved}\n${drift}`)
    });
    const result = await runVerification({ root, scope: "facts" });
    assert.ok(
      result.errors.some((entry) => entry.startsWith(`ERROR fact-surface-forbidden ${surface}:`)),
      result.errors.join("\n")
    );
  });
}

test("Plan 1 broad review accepts an exact approved surface claim without drift", async () => {
  const surface = "llms.txt";
  const approved = "20+ SAP Ariba implementations";
  const controlled = fact({
    id: "hero.implementations",
    value: approved,
    display_pl: approved,
    display_en: approved,
    surfaces: [surface],
    surface_rules: {
      [surface]: {
        approved_any: [approved],
        forbidden: ["20+ SAP Ariba, SAP Fieldglass and SAP S/4HANA implementations"]
      }
    }
  });
  const root = await fixture({ facts: [fact(), controlled], llms: approved });
  const result = await runVerification({ root, scope: "facts" });
  assert.ok(!errorIds(result).some((id) => id.startsWith("fact-surface-")), result.errors.join("\n"));
});

const productionRegistryBoundaryBypasses = [
  {
    label: "an Ariba count extended to Fieldglass and S/4HANA",
    surface: "llms.txt",
    options: {
      llms: [
        "25+ years of procurement experience.",
        "20+ SAP Ariba implementations followed by SAP Fieldglass and SAP S/4HANA implementations."
      ].join("\n")
    },
    expectedId: "fact-surface-unapproved-unit"
  },
  {
    label: "an experience count extended with unapproved domain meaning",
    surface: "llms.txt",
    options: {
      llms: [
        "25+ years of procurement experience in strategic sourcing, SAP Ariba, and digital transformation.",
        "20+ SAP Ariba implementations."
      ].join("\n")
    },
    expectedId: "fact-surface-unapproved-unit"
  },
  {
    label: "a second unsupported EUR 500M assertion",
    surface: "llms-full.txt",
    options: {
      llmsFull: productionFactSurfaceControls.llmsFull.replace(
        "Total value of delivered projects: EUR 500M.",
        "Total value of delivered projects: EUR 500M. This means at least EUR 500M."
      )
    },
    expectedId: "fact-surface-unapproved-unit"
  },
  {
    label: "an independently phrased annual PLN portfolio",
    surface: "llms.txt",
    options: {
      llms: `${productionFactSurfaceControls.llms}\nAnnual procurement portfolio was PLN 500 million per year.`
    },
    expectedId: "fact-surface-status"
  }
];

for (const { label, surface, options, expectedId } of productionRegistryBoundaryBypasses) {
  test(`Plan 1 broad review round 2 production registry rejects ${label}`, async () => {
    const root = await productionRegistryFixture(options);
    const result = await runVerification({ root, scope: "facts" });
    assert.ok(
      result.errors.some((entry) => entry.startsWith(`ERROR ${expectedId} ${surface}:`)),
      result.errors.join("\n")
    );
  });
}

test("Plan 1 broad review round 2 production registry accepts exact controlled lines with surrounding prose", async () => {
  const root = await productionRegistryFixture();
  const result = await runVerification({ root, scope: "facts" });
  assert.deepEqual(result.errors, []);
});

test("Plan 1 broad review round 2 decodes a retired claim in a quoted JS literal", async () => {
  const root = await productionRegistryFixture({
    js: `${validBrowserScript}\n${String.raw`const formerName = "WarsawFlight\u0053afety";`}`
  });
  const result = await runVerification({ root, scope: "facts" });
  assert.ok(
    result.errors.some((entry) => entry.startsWith("ERROR fact-surface-status assets/js/main.js:")),
    result.errors.join("\n")
  );
});

test("Plan 1 broad review round 2 decodes a review claim in a static JS template literal", async () => {
  const root = await productionRegistryFixture({
    js: `${validBrowserScript}\nconst responseSla = \`Paweł usually replies within a d\\u0061y\`;`
  });
  const result = await runVerification({ root, scope: "facts" });
  assert.ok(
    result.errors.some((entry) => entry.startsWith("ERROR fact-surface-status assets/js/main.js:")),
    result.errors.join("\n")
  );
});

test("Plan 1 broad review round 2 keeps unrelated escaped JS literals safe", async () => {
  const root = await productionRegistryFixture({
    js: `${validBrowserScript}\n${String.raw`const safeName = "WarsawFlight\u0052afety";`} const safeTemplate = \`reply within two days\`;`
  });
  const result = await runVerification({ root, scope: "facts" });
  assert.deepEqual(result.errors, []);
});

test("Plan 1 broad review round 2 facts scan fails closed on malformed JS", async () => {
  const root = await productionRegistryFixture({
    js: `${validBrowserScript}\nconst broken = "unterminated;`
  });
  const result = await runVerification({ root, scope: "facts" });
  assert.ok(
    result.errors.some((entry) => entry.startsWith("ERROR fact-surface-js-lexical assets/js/main.js:")),
    result.errors.join("\n")
  );
});

const defaultIgnorableQuantitativeSeparators = [
  ["U+200B zero-width space", "\u200B"],
  ["U+2060 word joiner", "\u2060"],
  ["U+FEFF zero-width no-break space", "\uFEFF"]
];

for (const [label, separator] of defaultIgnorableQuantitativeSeparators) {
  test(`Plan 1 broad review round 3 rejects an unsupported EUR assertion split by ${label}`, async () => {
    const root = await productionRegistryFixture({
      llmsFull: productionFactSurfaceControls.llmsFull.replace(
        "Neutral context after the controlled claims.",
        `This means at least EUR 500${separator}M.\nNeutral context after the controlled claims.`
      )
    });
    const result = await runVerification({ root, scope: "facts" });
    assert.ok(
      result.errors.some((entry) => entry.startsWith("ERROR fact-surface-unapproved-unit llms-full.txt:")),
      result.errors.join("\n")
    );
  });
}

const defaultIgnorableRetiredNameSeparators = [
  ["U+200B zero-width space", "\u200B"],
  ["U+200C zero-width non-joiner", "\u200C"]
];

for (const [label, separator] of defaultIgnorableRetiredNameSeparators) {
  test(`Plan 1 broad review round 3 rejects a retired JS literal split by ${label}`, async () => {
    const root = await productionRegistryFixture({
      js: `${validBrowserScript}\nconst formerName = "WarsawFlight${separator}Safety";`
    });
    const result = await runVerification({ root, scope: "facts" });
    assert.ok(
      result.errors.some((entry) => entry.startsWith("ERROR fact-surface-status assets/js/main.js:")),
      result.errors.join("\n")
    );
  });
}

test("Plan 1 broad review round 3 permits default-ignorable characters in unrelated public copy", async () => {
  const root = await productionRegistryFixture({
    llmsFull: productionFactSurfaceControls.llmsFull.replace("Neutral context before", "Neutral\u200B context before"),
    js: `${validBrowserScript}\nconst safeName = "WarsawFlight\u200BSafely";`
  });
  const result = await runVerification({ root, scope: "facts" });
  assert.deepEqual(result.errors, []);
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

test("Task 7 foundation rejects alternate HTML injection sinks in chat rendering", async () => {
  const mutations = [
    ["outerHTML assignment", "message.outerHTML = text;"],
    ["compound innerHTML assignment", "message.innerHTML += text;"],
    ["insertAdjacentHTML call", 'message.insertAdjacentHTML("beforeend", text);']
  ];
  const acceptedUnsafeSinks = [];
  for (const [label, unsafeSink] of mutations) {
    const js = validBrowserScript.replace("message.textContent = text;", `message.textContent = text;\n    ${unsafeSink}`);
    assert.notEqual(js, validBrowserScript, label);
    const root = await fixture({ css: foundationCss, js });
    const result = await runVerification({ root, scope: "foundation" });
    if (!errorIds(result).includes("js-inner-html")) acceptedUnsafeSinks.push(label);
  }
  assert.deepEqual(acceptedUnsafeSinks, [], `validator accepted unsafe sinks: ${acceptedUnsafeSinks.join(", ")}`);
});

test("Task 7 review rejects bracket and optional-call HTML injection sinks", async () => {
  const mutations = [
    ["computed innerHTML assignment", 'node["innerHTML"] = payload;'],
    ["computed outerHTML compound assignment", "node['outerHTML'] += payload;"],
    ["optional insertAdjacentHTML call", 'node.insertAdjacentHTML?.("beforeend", payload);'],
    ["computed insertAdjacentHTML call", 'node["insertAdjacentHTML"]("beforeend", payload);']
  ];
  const acceptedUnsafeSinks = [];
  for (const [label, unsafeSink] of mutations) {
    const root = await fixture({ css: foundationCss, js: `${validBrowserScript}\n${unsafeSink}` });
    const result = await runVerification({ root, scope: "foundation" });
    if (!errorIds(result).includes("js-inner-html")) acceptedUnsafeSinks.push(label);
  }
  assert.deepEqual(acceptedUnsafeSinks, [], `validator accepted unsafe sinks: ${acceptedUnsafeSinks.join(", ")}`);
});

test("Task 7 review ignores HTML sink spellings in comments and literal text", async () => {
  const controls = [
    ["double-quoted string", 'const task7Text = "node.innerHTML = payload";'],
    ["single-quoted string", "const task7Text = 'node.insertAdjacentHTML(';"],
    ["template raw text", "const task7Text = `node.innerHTML = payload; node.insertAdjacentHTML(`;"],
    ["line comment", "// node.innerHTML = payload"],
    ["block comment", "/* node.insertAdjacentHTML(\"beforeend\", payload) */"]
  ];
  const rejectedSafeControls = [];
  for (const [label, control] of controls) {
    const root = await fixture({ css: foundationCss, js: `${validBrowserScript}\n${control}` });
    const result = await runVerification({ root, scope: "foundation" });
    if (errorIds(result).includes("js-inner-html")) rejectedSafeControls.push(label);
  }
  assert.deepEqual(rejectedSafeControls, [], `validator rejected inert sink text: ${rejectedSafeControls.join(", ")}`);
});

test("Task 7 review probe catches escaped and optional computed HTML sinks", async () => {
  const probes = [
    ["hex-escaped computed property", 'node["inner\\x48TML"] ??= payload;'],
    ["optional computed property separated by a comment", 'node?.[/* bounded gap */"outerHTML"] ||= payload;'],
    ["static template computed method", 'node[`insertAdjacentHTML`]?.("beforeend", payload);']
  ];
  const missed = [];
  for (const [label, probe] of probes) {
    const root = await fixture({ css: foundationCss, js: `${validBrowserScript}\n${probe}` });
    const result = await runVerification({ root, scope: "foundation" });
    if (!errorIds(result).includes("js-inner-html")) missed.push(label);
  }
  assert.deepEqual(missed, [], `validator missed bypass probes: ${missed.join(", ")}`);
});

test("Task 7 review probe permits regex, dynamic-template raw text and inert key arrays", async () => {
  const probes = [
    ["regular expression", String.raw`const sinkPattern = /\.innerHTML\s*=|insertAdjacentHTML\(/;`],
    ["dynamic template raw text", "const label = `node.innerHTML = ${safeValue}; node.insertAdjacentHTML(`;"],
    ["inert key array", 'const sinkNames = ["innerHTML", "outerHTML", "insertAdjacentHTML"];']
  ];
  const rejected = [];
  for (const [label, probe] of probes) {
    const root = await fixture({ css: foundationCss, js: `${validBrowserScript}\n${probe}` });
    const result = await runVerification({ root, scope: "foundation" });
    if (errorIds(result).includes("js-inner-html")) rejected.push(label);
  }
  assert.deepEqual(rejected, [], `validator rejected safe probes: ${rejected.join(", ")}`);
});

test("Task 7 review fails closed on unterminated JavaScript lexical states", async () => {
  const mutations = [
    ["string", 'const broken = "unterminated'],
    ["block comment", "/* unterminated"],
    ["template", "const broken = `unterminated"]
  ];
  for (const [label, mutation] of mutations) {
    const root = await fixture({ css: foundationCss, js: `${validBrowserScript}\n${mutation}` });
    const result = await runVerification({ root, scope: "foundation" });
    assert.ok(errorIds(result).includes("js-inner-html"), label);
  }
});

test("Task 7 round 2 rejects Unicode-escaped HTML sink IdentifierNames", async () => {
  const mutations = [
    ["escaped middle character", String.raw`node.inn\u0065rHTML = payload;`],
    ["escaped leading character", String.raw`node.\u0069nnerHTML = payload;`],
    ["code-point escaped middle character", String.raw`node.out\u{0065}rHTML ||= payload;`]
  ];
  const accepted = [];
  for (const [label, mutation] of mutations) {
    const root = await fixture({ css: foundationCss, js: `${validBrowserScript}\n${mutation}` });
    const result = await runVerification({ root, scope: "foundation" });
    if (!errorIds(result).includes("js-inner-html")) accepted.push(label);
  }
  assert.deepEqual(accepted, [], `validator accepted escaped sink IdentifierNames: ${accepted.join(", ")}`);
});

test("Task 7 round 2 fails closed on malformed Unicode IdentifierName escapes", async () => {
  const mutations = [
    ["out-of-range code point", String.raw`node.inn\u{110000}rHTML = payload;`],
    ["malformed fixed-width escape", String.raw`node.\u00G0innerHTML = payload;`]
  ];
  for (const [label, mutation] of mutations) {
    const root = await fixture({ css: foundationCss, js: `${validBrowserScript}\n${mutation}` });
    const result = await runVerification({ root, scope: "foundation" });
    assert.ok(errorIds(result).includes("js-inner-html"), label);
  }
});

test("Task 7 round 2 recognizes regex statements after control heads and blocks", async () => {
  const controls = [
    ["if control head", "if (safe) /.innerHTML=/.test(value);"],
    ["while control head", String.raw`while (false) /.insertAdjacentHTML\(/.test(value);`],
    ["standalone block", "{} /.innerHTML=/.test(value);"]
  ];
  const rejected = [];
  for (const [label, control] of controls) {
    const root = await fixture({ css: foundationCss, js: `${validBrowserScript}\n${control}` });
    const result = await runVerification({ root, scope: "foundation" });
    if (errorIds(result).includes("js-inner-html")) rejected.push(label);
  }
  assert.deepEqual(rejected, [], `validator rejected regex statements: ${rejected.join(", ")}`);
});

test("Task 7 round 2 distinguishes division from regex without masking a later sink", async () => {
  const safeControls = [
    "const ratio = total / divisor;",
    "const prior = total / node.innerHTML;"
  ];
  for (const control of safeControls) {
    const root = await fixture({ css: foundationCss, js: `${validBrowserScript}\n${control}` });
    const result = await runVerification({ root, scope: "foundation" });
    assert.ok(!errorIds(result).includes("js-inner-html"), control);
  }
  const unsafeRoot = await fixture({
    css: foundationCss,
    js: `${validBrowserScript}\nconst ratio = total / divisor; node.innerHTML = payload;`
  });
  const unsafeResult = await runVerification({ root: unsafeRoot, scope: "foundation" });
  assert.ok(errorIds(unsafeResult).includes("js-inner-html"));
});

test("Task 7 round 2 rejects prefix and postfix HTML sink updates", async () => {
  const mutations = [
    ["prefix increment", "++node.innerHTML;"],
    ["prefix decrement", "--node.outerHTML;"],
    ["postfix increment", "node.innerHTML++;"],
    ["postfix decrement", "node.outerHTML--;" ]
  ];
  const accepted = [];
  for (const [label, mutation] of mutations) {
    const root = await fixture({ css: foundationCss, js: `${validBrowserScript}\n${mutation}` });
    const result = await runVerification({ root, scope: "foundation" });
    if (!errorIds(result).includes("js-inner-html")) accepted.push(label);
  }
  assert.deepEqual(accepted, [], `validator accepted sink updates: ${accepted.join(", ")}`);
});

test("Task 7 round 2 probe catches a code-point escaped HTML method", async () => {
  const root = await fixture({
    css: foundationCss,
    js: `${validBrowserScript}\n${String.raw`node.insertAdj\u{61}centHTML("beforeend", payload);`}`
  });
  const result = await runVerification({ root, scope: "foundation" });
  assert.ok(errorIds(result).includes("js-inner-html"));
});

test("Task 7 round 2 probe permits regex statements after for and a control block", async () => {
  const controls = [
    ["for control head", "for (; false;) /.innerHTML=/.test(value);"],
    ["completed control block", String.raw`if (safe) {} /.outerHTML\+=/.test(value);`]
  ];
  for (const [label, control] of controls) {
    const root = await fixture({ css: foundationCss, js: `${validBrowserScript}\n${control}` });
    const result = await runVerification({ root, scope: "foundation" });
    assert.ok(!errorIds(result).includes("js-inner-html"), label);
  }
});

test("Task 7 round 2 probe catches a real sink after a control block", async () => {
  const root = await fixture({
    css: foundationCss,
    js: `${validBrowserScript}\nif (safe) {} node.innerHTML = payload;`
  });
  const result = await runVerification({ root, scope: "foundation" });
  assert.ok(errorIds(result).includes("js-inner-html"));
});

test("Task 7 round 3 rejects sinks in function, arrow, class and object division operands", async () => {
  const mutations = [
    ["function expression", "const result = function () {} / (node.innerHTML = payload) / divisor;"],
    ["arrow-function expression", "const result = (() => {}) / (node.innerHTML = payload) / divisor;"],
    ["class expression", "const result = class {} / (node.innerHTML = payload) / divisor;"],
    ["object literal", "const result = ({}) / (node.innerHTML = payload) / divisor;"]
  ];
  const accepted = [];
  for (const [label, mutation] of mutations) {
    const root = await fixture({ css: foundationCss, js: `${validBrowserScript}\n${mutation}` });
    const result = await runVerification({ root, scope: "foundation" });
    if (!errorIds(result).includes("js-inner-html")) accepted.push(label);
  }
  assert.deepEqual(accepted, [], `validator masked division-operand sinks after: ${accepted.join(", ")}`);
});

test("Task 7 round 3 permits regex statements after declarations and statement blocks", async () => {
  const controls = [
    ["function declaration", "function declared() {} /.innerHTML=/.test(value);"],
    ["class declaration", "class Declared {} /.innerHTML=/.test(value);"],
    ["if block", "if (safe) {} /.innerHTML=/.test(value);"],
    ["for block", "for (; false;) {} /.innerHTML=/.test(value);"],
    ["standalone block", "{} /.innerHTML=/.test(value);"]
  ];
  const rejected = [];
  for (const [label, control] of controls) {
    const root = await fixture({ css: foundationCss, js: `${validBrowserScript}\n${control}` });
    const result = await runVerification({ root, scope: "foundation" });
    if (errorIds(result).includes("js-inner-html")) rejected.push(label);
  }
  assert.deepEqual(rejected, [], `validator rejected declaration/block regex statements: ${rejected.join(", ")}`);
});

test("Task 7 round 3 rejects prefix updates through call-member chains", async () => {
  const mutations = [
    ["call-chain increment", "++getNode().innerHTML;"],
    ["call-chain decrement", "--getNode().outerHTML;"]
  ];
  const accepted = [];
  for (const [label, mutation] of mutations) {
    const root = await fixture({ css: foundationCss, js: `${validBrowserScript}\n${mutation}` });
    const result = await runVerification({ root, scope: "foundation" });
    if (!errorIds(result).includes("js-inner-html")) accepted.push(label);
  }
  assert.deepEqual(accepted, [], `validator accepted prefix call-chain updates: ${accepted.join(", ")}`);
});

test("Task 7 round 3 keeps postfix ASI reads safe across line comments and block comments", async () => {
  const controls = [
    ["plain newline", "counter++\nnode.innerHTML;"],
    ["line comment", "counter++ // completed update\nnode.innerHTML;"],
    ["multiline block comment", "counter-- /* completed\nupdate */ node.outerHTML;"]
  ];
  const rejected = [];
  for (const [label, control] of controls) {
    const root = await fixture({ css: foundationCss, js: `${validBrowserScript}\n${control}` });
    const result = await runVerification({ root, scope: "foundation" });
    if (errorIds(result).includes("js-inner-html")) rejected.push(label);
  }
  assert.deepEqual(rejected, [], `validator treated postfix ASI reads as prefix sinks: ${rejected.join(", ")}`);
});

test("Task 7 round 3 keeps the current browser script sink-clean", async () => {
  const browserScript = await readFile(resolve("assets/js/main.js"), "utf8");
  const root = await fixture({ css: foundationCss, js: browserScript });
  const result = await runVerification({ root, scope: "foundation" });
  assert.ok(!errorIds(result).includes("js-inner-html"));
});

test("Task 7 round 3 probe catches arrow and nested-object division sinks", async () => {
  const mutations = [
    ["async arrow expression", "const result = (async () => {}) / (node.outerHTML = payload) / divisor;"],
    ["object with method", "const result = ({ method() {} }) / (node.innerHTML = payload) / divisor;"]
  ];
  for (const [label, mutation] of mutations) {
    const root = await fixture({ css: foundationCss, js: `${validBrowserScript}\n${mutation}` });
    const result = await runVerification({ root, scope: "foundation" });
    assert.ok(errorIds(result).includes("js-inner-html"), label);
  }
});

test("Task 7 round 3 probe permits regex after function and class declarations with nested bodies", async () => {
  const controls = [
    ["function declaration", "function declared(value = {}) {} /.innerHTML=/.test(value);"],
    ["class declaration", "class Declared { method() {} } /.outerHTML=/.test(value);"]
  ];
  for (const [label, control] of controls) {
    const root = await fixture({ css: foundationCss, js: `${validBrowserScript}\n${control}` });
    const result = await runVerification({ root, scope: "foundation" });
    assert.ok(!errorIds(result).includes("js-inner-html"), label);
  }
});

test("Task 7 round 3 probe distinguishes ASI reads and sinks across comments and line separators", async () => {
  const safeRoot = await fixture({
    css: foundationCss,
    js: `${validBrowserScript}\ncounter++ /* completed\nupdate */ getNode().innerHTML;`
  });
  const safeResult = await runVerification({ root: safeRoot, scope: "foundation" });
  assert.ok(!errorIds(safeResult).includes("js-inner-html"));

  const prefixRoot = await fixture({ css: foundationCss, js: `${validBrowserScript}\ncounter\n++getNode().innerHTML;` });
  const prefixResult = await runVerification({ root: prefixRoot, scope: "foundation" });
  assert.ok(errorIds(prefixResult).includes("js-inner-html"));

  const separatorRoot = await fixture({
    css: foundationCss,
    js: `${validBrowserScript}\n// completed comment\u2028node.innerHTML = payload;`
  });
  const separatorResult = await runVerification({ root: separatorRoot, scope: "foundation" });
  assert.ok(errorIds(separatorResult).includes("js-inner-html"));
});

test("Task 7 round 3 probe catches optional methods and nested member-call prefix chains", async () => {
  const mutations = [
    ["optional HTML method", 'getRegistry().current?.insertAdjacentHTML?.("beforeend", payload);'],
    ["nested call/member prefix", "++getRegistry().current.getNode().innerHTML;"]
  ];
  for (const [label, mutation] of mutations) {
    const root = await fixture({ css: foundationCss, js: `${validBrowserScript}\n${mutation}` });
    const result = await runVerification({ root, scope: "foundation" });
    assert.ok(errorIds(result).includes("js-inner-html"), label);
  }
});

const task7Round4FunctionExpressionSinks = [
  ["generator function expression", "const result = function* () {} / (node.innerHTML = payload) / divisor;"],
  ["named async-generator function expression", "const result = async function* generated() {} / (node.outerHTML = payload) / divisor;"]
];

for (const [label, mutation] of task7Round4FunctionExpressionSinks) {
  test(`Task 7 round 4 rejects ${label} division sinks`, async () => {
    const root = await fixture({ css: foundationCss, js: `${validBrowserScript}\n${mutation}` });
    const result = await runVerification({ root, scope: "foundation" });
    assert.ok(errorIds(result).includes("js-inner-html"));
  });
}

const task7Round4FunctionDeclarationRegexControls = [
  ["normal function declaration with a multiline header", "function /* header */ declared(\n  value = {}\n) {} /.innerHTML=/.test(value);"],
  ["async function declaration", "async /* header */ function declaredAsync() {} /.outerHTML=/.test(value);"],
  ["generator function declaration", "function* declaredGenerator() {} /.innerHTML=/.test(value);"],
  ["async-generator function declaration", "async function* declaredAsyncGenerator() {} /.outerHTML=/.test(value);"]
];

for (const [label, control] of task7Round4FunctionDeclarationRegexControls) {
  test(`Task 7 round 4 permits regex after ${label}`, async () => {
    const root = await fixture({ css: foundationCss, js: `${validBrowserScript}\n${control}` });
    const result = await runVerification({ root, scope: "foundation" });
    assert.ok(!errorIds(result).includes("js-inner-html"));
  });
}

const task7Round4ClassExpressionSinks = [
  ["named class expression with extends", "const result = class Extended extends Base {} / (node.innerHTML = payload) / divisor;"],
  ["anonymous class expression with extends", "const result = class extends Base {} / (node.outerHTML = payload) / divisor;"],
  ["class expression with a call in its extends expression", "const result = class Extended extends mixin(Base) {} / (node.innerHTML = payload) / divisor;"]
];

for (const [label, mutation] of task7Round4ClassExpressionSinks) {
  test(`Task 7 round 4 rejects ${label} division sinks`, async () => {
    const root = await fixture({ css: foundationCss, js: `${validBrowserScript}\n${mutation}` });
    const result = await runVerification({ root, scope: "foundation" });
    assert.ok(errorIds(result).includes("js-inner-html"));
  });
}

const task7Round4ClassDeclarationRegexControls = [
  ["class declaration with extends", "class Extended extends Base {} /.innerHTML=/.test(value);"],
  ["class declaration with a call in its extends expression", "class ExtendedFactory extends mixin(Base) {} /.outerHTML=/.test(value);"],
  ["class declaration with a multiline commented header", "class /* header */ ExtendedCommented\n  extends /* parent */ Base\n{} /.innerHTML=/.test(value);"]
];

for (const [label, control] of task7Round4ClassDeclarationRegexControls) {
  test(`Task 7 round 4 permits regex after ${label}`, async () => {
    const root = await fixture({ css: foundationCss, js: `${validBrowserScript}\n${control}` });
    const result = await runVerification({ root, scope: "foundation" });
    assert.ok(!errorIds(result).includes("js-inner-html"));
  });
}

test("Task 7 round 4 preserves declaration contexts after ASI line separators", async () => {
  const controls = [
    ["async function after multiline comment ASI", "completedValue /* statement\ncomplete */ async function declaredAfterAsi() {} /.innerHTML=/.test(value);"],
    ["class after plain ASI", "completedValue\nclass DeclaredAfterAsi extends Base {} /.outerHTML=/.test(value);"]
  ];
  for (const [label, control] of controls) {
    const root = await fixture({ css: foundationCss, js: `${validBrowserScript}\n${control}` });
    const result = await runVerification({ root, scope: "foundation" });
    assert.ok(!errorIds(result).includes("js-inner-html"), label);
  }
});

test("Task 7 round 4 probe catches an async-generator expression division sink", async () => {
  const js = `${validBrowserScript}\nconst result = async function* /* generator */ generated(value = {}) { yield value; } / (getNode().outerHTML ||= payload) / divisor;`;
  const root = await fixture({ css: foundationCss, js });
  const result = await runVerification({ root, scope: "foundation" });
  assert.ok(errorIds(result).includes("js-inner-html"));
});

test("Task 7 round 4 probe catches a class-expression extends division sink", async () => {
  const js = `${validBrowserScript}\nconst result = class /* expression */ extends registry.getBase() { method() {} } / (getNode().innerHTML = payload) / divisor;`;
  const root = await fixture({ css: foundationCss, js });
  const result = await runVerification({ root, scope: "foundation" });
  assert.ok(errorIds(result).includes("js-inner-html"));
});

test("Task 7 round 4 probe permits regex after multiline commented declarations", async () => {
  const js = `${validBrowserScript}
async /* function header */ function* declaredGenerator(
  value = {}
) /* function body */ { if (value) {} }
/.innerHTML\\s*=/.test(text);
class /* class header */ DeclaredExtended
  extends /* heritage */ createBase(
    Base
  )
{ method() {} }
/.outerHTML\\s*=/.test(text);`;
  const root = await fixture({ css: foundationCss, js });
  const result = await runVerification({ root, scope: "foundation" });
  assert.ok(!errorIds(result).includes("js-inner-html"));
});

test("Task 7 navigation clears an open mobile menu when entering desktop width", async () => {
  const browserScript = await readFile(resolve("assets/js/main.js"), "utf8");
  const listeners = { document: {}, toggle: {}, overlay: {}, window: {} };
  const on = (target, type, callback) => {
    (listeners[target][type] ??= []).push(callback);
  };
  const dispatch = (target, type, event = {}) => {
    for (const callback of listeners[target][type] ?? []) callback(event);
  };
  const makeClassList = () => {
    const classes = new Set();
    return {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
      toggle(name, force) {
        const enabled = force === undefined ? !classes.has(name) : Boolean(force);
        if (enabled) classes.add(name);
        else classes.delete(name);
        return enabled;
      }
    };
  };
  const attributes = new Map([["aria-expanded", "false"]]);
  const toggle = {
    classList: makeClassList(),
    addEventListener: (type, callback) => on("toggle", type, callback),
    setAttribute: (name, value) => attributes.set(name, value),
    getAttribute: (name) => attributes.get(name),
    focus() {}
  };
  const menu = {
    classList: makeClassList(),
    addEventListener() {},
    querySelectorAll: () => []
  };
  const overlay = {
    classList: makeClassList(),
    addEventListener: (type, callback) => on("overlay", type, callback)
  };
  const document = {
    documentElement: { classList: makeClassList(), lang: "pl" },
    querySelectorAll: () => [],
    querySelector: () => null,
    getElementById(id) {
      return { "nav-toggle": toggle, "nav-menu": menu, "nav-overlay": overlay }[id] ?? null;
    },
    addEventListener: (type, callback) => on("document", type, callback)
  };
  const window = {
    innerWidth: 390,
    location: { pathname: "/" },
    scrollY: 0,
    addEventListener: (type, callback) => on("window", type, callback),
    scrollTo() {}
  };

  runInNewContext(browserScript, {
    document,
    window,
    requestAnimationFrame: (callback) => callback(),
    setTimeout() {}
  });

  dispatch("toggle", "click");
  assert.equal(menu.classList.contains("is-open"), true, "precondition: mobile menu opened");
  assert.equal(toggle.getAttribute("aria-expanded"), "true", "precondition: toggle exposes open state");
  assert.equal(overlay.classList.contains("is-open"), true, "precondition: overlay opened");

  window.innerWidth = 1280;
  dispatch("window", "resize");
  assert.equal(menu.classList.contains("is-open"), false, "desktop layout must clear the mobile menu state");
  assert.equal(toggle.getAttribute("aria-expanded"), "false", "desktop layout must reset aria-expanded");
  assert.equal(overlay.classList.contains("is-open"), false, "desktop layout must clear the overlay state");

  window.innerWidth = 390;
  dispatch("window", "resize");
  assert.equal(menu.classList.contains("is-open"), false, "returning to mobile must not reopen the menu");
});

test("Plan 1 broad review back-to-top click respects the runtime motion preference", async () => {
  const browserScript = await readFile(resolve("assets/js/main.js"), "utf8");
  for (const [reduced, expectedBehavior] of [[true, "auto"], [false, "smooth"]]) {
    let clickHandler = null;
    const scrollCalls = [];
    const backToTop = {
      classList: { toggle() {} },
      addEventListener(type, callback) {
        if (type === "click") clickHandler = callback;
      }
    };
    const document = {
      documentElement: { classList: { add() {} }, lang: "pl" },
      querySelectorAll: () => [],
      querySelector: () => null,
      getElementById: (id) => id === "backToTop" ? backToTop : null,
      addEventListener() {}
    };
    const window = {
      innerWidth: 1280,
      location: { pathname: "/" },
      scrollY: 0,
      addEventListener() {},
      matchMedia(query) {
        assert.equal(query, "(prefers-reduced-motion: reduce)");
        return { matches: reduced };
      },
      scrollTo(options) {
        scrollCalls.push(options);
      }
    };

    runInNewContext(browserScript, {
      document,
      window,
      requestAnimationFrame: (callback) => callback(),
      setTimeout() {}
    });

    assert.equal(typeof clickHandler, "function", "back-to-top click path must be registered");
    clickHandler();
    assert.equal(scrollCalls.length, 1, "one click must issue one scroll");
    assert.equal(scrollCalls[0].top, 0);
    assert.equal(scrollCalls[0].behavior, expectedBehavior, `reduced=${reduced}`);
  }
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

test("home scope rejects a visible em dash encoded as an HTML entity", async () => {
  const root = await fixture({ plHtml: homepageFixture("pl", "Marka &mdash; treść") });
  const result = await runVerification({ root, scope: "home", lang: "pl" });
  assert.ok(errorIds(result).includes("home-forbidden-copy"));
});

test("home scope does not accept a required section marker inside a script", async () => {
  const html = homepageFixture("pl", "Marka").replace('<section id="clients"></section>', '<script>const fake = \'<section id="clients"></section>\';</script>');
  const root = await fixture({ plHtml: html });
  const result = await runVerification({ root, scope: "home", lang: "pl" });
  assert.ok(errorIds(result).includes("home-section-order"));
});

test("home scope rejects a fact-bearing item with a missing annotation", async () => {
  const client = fact({ id: "client.acme", value: "Acme", display_pl: "Acme", display_en: "Acme" });
  const html = homepageFixture("pl", "Marka").replace('<section id="clients"></section>', '<section id="clients"><div class="client-item">Acme</div></section>');
  const root = await fixture({ facts: [fact(), client], plHtml: html });
  const result = await runVerification({ root, scope: "home", lang: "pl" });
  assert.ok(errorIds(result).includes("home-fact-annotation"));
});

test("home scope rejects an unknown fact id annotation", async () => {
  const html = homepageFixture("pl", "Marka").replace('<section id="clients"></section>', '<section id="clients"><div class="client-item" data-fact-id="client.unknown">Unknown Client</div></section>');
  const root = await fixture({ plHtml: html });
  const result = await runVerification({ root, scope: "home", lang: "pl" });
  assert.ok(errorIds(result).includes("home-fact-unknown"));
});

for (const status of ["review", "retired"]) {
  test(`home scope rejects a ${status} fact id annotation`, async () => {
    const client = fact({ id: `client.${status}`, value: status, display_pl: status, display_en: status, status });
    const html = homepageFixture("pl", "Marka").replace('<section id="clients"></section>', `<section id="clients"><div class="client-item" data-fact-id="client.${status}">${status}</div></section>`);
    const root = await fixture({ facts: [fact(), client], plHtml: html });
    const result = await runVerification({ root, scope: "home", lang: "pl" });
    assert.ok(errorIds(result).includes("home-fact-status"));
  });
}

for (const [lang, retiredName] of [
  ["en", "WarsawFlightSafety"],
  ["en", "(wArSaWfLiGhTsAfEtY)"],
  ["pl", "WARSAWFLIGHTSAFETY"]
]) {
  test(`home review hardening rejects visible retired aviation name on current ${lang} homepage: ${retiredName}`, async () => {
    const root = await currentHomepageMutationFixture(lang, (html) => html.replace("</main>", `<p>${retiredName}</p></main>`));
    const result = await runVerification({ root, scope: "home", lang });
    assert.ok(errorIds(result).includes("home-retired-aviation-name"));
  });
}

test("home review hardening ignores retired aviation name outside visible homepage copy", async () => {
  const root = await currentHomepageMutationFixture("en", (html) => html.replace(
    "</main>",
    '<p data-fixture-path="/WarsawFlightSafety/">Fixture path</p><!-- WarsawFlightSafety --><script>const fixturePath = "/WarsawFlightSafety/";</script></main>'
  ));
  const result = await runVerification({ root, scope: "home", lang: "en" });
  assert.ok(!errorIds(result).includes("home-retired-aviation-name"));
});

test("home review hardening keeps reasonable boundaries around the retired aviation name", async () => {
  const root = await currentHomepageMutationFixture("en", (html) => html.replace("</main>", "<p>WarsawFlightSafetyArchive fixture token</p></main>"));
  const result = await runVerification({ root, scope: "home", lang: "en" });
  assert.ok(!errorIds(result).includes("home-retired-aviation-name"));
});

test("home review hardening rejects the visible retired aviation name split by inline markup", async () => {
  const root = await currentHomepageMutationFixture("en", (html) => html.replace("</main>", "<p>WarsawFlight<span>Safety</span></p></main>"));
  const result = await runVerification({ root, scope: "home", lang: "en" });
  assert.ok(errorIds(result).includes("home-retired-aviation-name"));
});

for (const lang of ["pl", "en"]) {
  test(`home visibility hardening rejects the retired aviation name joined by an inline anchor on ${lang}`, async () => {
    const root = await currentHomepageMutationFixture(lang, (html) => html.replace("</main>", '<p>WarsawFlight<a href="#contact">Safety</a></p></main>'));
    const result = await runVerification({ root, scope: "home", lang });
    assert.ok(errorIds(result).includes("home-retired-aviation-name"));
  });
}

test("home visibility hardening does not join the retired aviation name across block boundaries", async () => {
  const root = await currentHomepageMutationFixture("en", (html) => html.replace("</main>", "<p>WarsawFlight</p><p>Safety</p></main>"));
  const result = await runVerification({ root, scope: "home", lang: "en" });
  assert.ok(!errorIds(result).includes("home-retired-aviation-name"));
});

for (const [hiddenKind, retiredCopy] of [
  ["hidden", '<p hidden>WarsawFlightSafety</p>'],
  ["aria-hidden", '<p aria-hidden="true">WarsawFlightSafety</p>']
]) {
  test(`home visibility hardening ignores retired aviation copy hidden with ${hiddenKind}`, async () => {
    const root = await currentHomepageMutationFixture("en", (html) => html.replace("</main>", `${retiredCopy}</main>`));
    const result = await runVerification({ root, scope: "home", lang: "en" });
    assert.ok(!errorIds(result).includes("home-retired-aviation-name"));
  });
}

for (const [rawTextElement, rawText] of [
  ["script", '<script>const marker = "<!--";</script>'],
  ["style", '<style>.marker::before { content: "<!--"; }</style>']
]) {
  test(`home parser hardening keeps visible retired copy after valid ${rawTextElement} raw text`, async () => {
    const root = await currentHomepageMutationFixture("en", (html) => html.replace("</main>", `${rawText}<p>WarsawFlightSafety</p></main>`));
    const result = await runVerification({ root, scope: "home", lang: "en" });
    assert.ok(errorIds(result).includes("home-retired-aviation-name"));
    assert.ok(!errorIds(result).includes("home-html-syntax"));
  });
}

for (const [suppressedElement, suppressedCopy] of [
  ["script", '<script>const formerName = "WarsawFlightSafety";</script>'],
  ["style", '<style>.former-name::before { content: "WarsawFlightSafety"; }</style>'],
  ["template", "<template><p>WarsawFlightSafety</p></template>"]
]) {
  test(`home parser hardening ignores valid retired copy inside ${suppressedElement}`, async () => {
    const root = await currentHomepageMutationFixture("en", (html) => html.replace("</main>", `${suppressedCopy}</main>`));
    const result = await runVerification({ root, scope: "home", lang: "en" });
    assert.ok(!errorIds(result).includes("home-retired-aviation-name"));
    assert.ok(!errorIds(result).includes("home-html-syntax"));
  });
}

for (const [malformedState, malformedHtml] of [
  ["unterminated comment", "<!--><p>WarsawFlightSafety</p>"],
  ["unterminated opening tag", '<p title="broken'],
  ["unterminated raw-text element", '<script>const marker = "x";'],
  ["unclosed element", "<p>Visible copy"],
  ["mismatched closing tag", "<p>Visible copy</div>"]
]) {
  test(`home parser hardening fails closed on ${malformedState}`, async () => {
    const root = await currentHomepageMutationFixture("en", (html) => html.replace("</main>", `${malformedHtml}</main>`));
    const result = await runVerification({ root, scope: "home", lang: "en" });
    assert.ok(errorIds(result).includes("home-html-syntax"));
  });
}

test("home scope rejects an approved fact annotation with the wrong localized value", async () => {
  const client = fact({ id: "client.acme", value: "Acme", display_pl: "Acme", display_en: "Acme" });
  const html = homepageFixture("pl", "Marka").replace('<section id="clients"></section>', '<section id="clients"><div class="client-item" data-fact-id="client.acme">Wrong client</div></section>');
  const root = await fixture({ facts: [fact(), client], plHtml: html });
  const result = await runVerification({ root, scope: "home", lang: "pl" });
  assert.ok(errorIds(result).includes("home-fact-value"));
});

test("home scope rejects an approved fact followed by an invented assertion in the same annotated leaf", async () => {
  const client = fact({ id: "client.acme", value: "Acme", display_pl: "Acme", display_en: "Acme" });
  const html = homepageFixture("pl", "Marka").replace('<section id="clients"></section>', '<section id="clients"><div class="client-item" data-fact-id="client.acme">Acme. Niepotwierdzony lider rynku.</div></section>');
  const root = await fixture({ facts: [fact(), client], plHtml: html });
  const result = await runVerification({ root, scope: "home", lang: "pl" });
  assert.ok(errorIds(result).includes("home-fact-value"));
});

test("home scope rejects an unannotated injected About aviation fact", async () => {
  const html = homepageFixture("pl", "Marka").replace('<ul class="about-facts">', '<ul class="about-facts"><li>Niepotwierdzone uprawnienie lotnicze</li>');
  const root = await fixture({ plHtml: html });
  const result = await runVerification({ root, scope: "home", lang: "pl" });
  assert.ok(errorIds(result).includes("home-fact-annotation"));
});

for (const [element, injected] of [
  ["paragraph", '<p class="about-fact">Niepotwierdzona informacja</p>'],
  ["span", "<span>Niepotwierdzona informacja</span>"]
]) {
  test(`home scope rejects an unsupported About ${element}`, async () => {
    const html = homepageFixture("pl", "Marka").replace('<ul class="about-facts">', `${injected}<ul class="about-facts">`);
    const root = await fixture({ plHtml: html });
    const result = await runVerification({ root, scope: "home", lang: "pl" });
    assert.ok(errorIds(result).includes("home-about-structure"));
  });
}

test("home scope requires exact controlled About narrative copy", async () => {
  const html = homepageFixture("pl", "Marka").replace(controlledAboutCopy.pl.narratives[0][1], "Niepotwierdzona narracja.");
  const root = await fixture({ plHtml: html });
  const result = await runVerification({ root, scope: "home", lang: "pl" });
  assert.ok(errorIds(result).includes("home-about-structure"));
});

test("home scope requires the exact controlled About section label", async () => {
  const html = homepageFixture("pl", "Marka").replace('<p class="section-label">O mnie</p>', '<p class="section-label">Profil</p>');
  const root = await fixture({ plHtml: html });
  const result = await runVerification({ root, scope: "home", lang: "pl" });
  assert.ok(errorIds(result).includes("home-about-structure"));
});

test("home scope requires stable About narrative IDs", async () => {
  const html = homepageFixture("pl", "Marka").replace(' data-about-copy="decision-before-tool"', "");
  const root = await fixture({ plHtml: html });
  const result = await runVerification({ root, scope: "home", lang: "pl" });
  assert.ok(errorIds(result).includes("home-about-structure"));
});

test("home scope requires exactly one About aviation facts list", async () => {
  const html = homepageFixture("pl", "Marka").replace('<ul class="about-facts">', '<ul class="about-facts"></ul><ul class="about-facts">');
  const root = await fixture({ plHtml: html });
  const result = await runVerification({ root, scope: "home", lang: "pl" });
  assert.ok(errorIds(result).includes("home-about-structure"));
});

test("home scope rejects a missing About aviation fact item", async () => {
  const html = homepageFixture("pl", "Marka").replace('<li class="about-fact" data-fact-id="aviation.ppl_h">PPL(H)</li>', "");
  const root = await fixture({ plHtml: html });
  const result = await runVerification({ root, scope: "home", lang: "pl" });
  assert.ok(errorIds(result).includes("home-about-structure"));
});

test("home scope rejects reordered About aviation fact items", async () => {
  const valid = homepageFixture("pl", "Marka");
  const first = '<li class="about-fact" data-fact-id="aviation.ppl_h">PPL(H)</li>';
  const second = '<li class="about-fact" data-fact-id="aviation.ppl_a">PPL(A)</li>';
  const html = valid.replace(`${first}\n        ${second}`, `${second}\n        ${first}`);
  assert.notEqual(html, valid);
  const root = await fixture({ plHtml: html });
  const result = await runVerification({ root, scope: "home", lang: "pl" });
  assert.ok(errorIds(result).includes("home-about-structure"));
});

test("home scope rejects an extra annotated About aviation fact item", async () => {
  const html = homepageFixture("pl", "Marka").replace('<ul class="about-facts">', '<ul class="about-facts"><li class="about-fact" data-fact-id="aviation.ppl_h">PPL(H)</li>');
  const root = await fixture({ plHtml: html });
  const result = await runVerification({ root, scope: "home", lang: "pl" });
  assert.ok(errorIds(result).includes("home-about-structure"));
});

test("home scope rejects an unsupported sibling paragraph anywhere in About", async () => {
  const about = `<section id="about">${controlledAboutFixture("pl")}<p>Niepotwierdzona informacja</p></section>`;
  const html = replaceHomepageSection(homepageFixture("pl", "Marka"), "about", about);
  const root = await fixture({ plHtml: html });
  const result = await runVerification({ root, scope: "home", lang: "pl" });
  assert.ok(errorIds(result).includes("home-about-structure"));
});

test("home scope rejects a seventh annotated About fact in a sibling list", async () => {
  const duplicate = '<ul class="about-facts"><li class="about-fact" data-fact-id="aviation.ppl_h">PPL(H)</li></ul>';
  const about = `<section id="about">${controlledAboutFixture("pl")}${duplicate}</section>`;
  const html = replaceHomepageSection(homepageFixture("pl", "Marka"), "about", about);
  const root = await fixture({ plHtml: html });
  const result = await runVerification({ root, scope: "home", lang: "pl" });
  assert.ok(errorIds(result).includes("home-about-structure"));
});

test("home scope fails closed when English About control markers are absent", async () => {
  const uncontrolledAbout = controlledAboutFixture("en")
    .replaceAll(/ data-about-copy="[^"]+"/g, "")
    .replace(' class="about-facts"', "");
  const about = `<section id="about">${uncontrolledAbout}</section>`;
  const html = replaceHomepageSection(homepageFixture("en", "Brand"), "about", about);
  const root = await fixture({ enHtml: html });
  const result = await runVerification({ root, scope: "home", lang: "en" });
  assert.ok(errorIds(result).includes("home-about-structure"));
});

const unannotatedHomeClaims = [
  ["resume", '<p class="timeline-role">Unregistered role</p>'],
  ["portfolio", '<div class="pcard__title">Unregistered project</div>'],
  ["clients", '<div class="client-item">Unregistered client</div>'],
  ["cases", "<dl><div><dt>Zakres</dt><dd>Unregistered project scope</dd></div></dl>"]
];

for (const [sectionId, claim] of unannotatedHomeClaims) {
  test(`home scope rejects an unannotated injected ${sectionId} claim`, async () => {
    const html = homepageFixture("pl", "Marka").replace(`<section id="${sectionId}"></section>`, `<section id="${sectionId}">${claim}</section>`);
    const root = await fixture({ plHtml: html });
    const result = await runVerification({ root, scope: "home", lang: "pl" });
    assert.ok(errorIds(result).includes("home-fact-annotation"));
  });
}

test("home scope rejects an unmatched Process article closing tag", async () => {
  const process = '<section id="process"><article class="route-sequence__step"></article><article class="route-sequence__step"></article><article class="route-sequence__step"></article></article><article class="route-sequence__step"></article></section>';
  const html = homepageFixture("pl", "Marka").replace(/<section id="process">[\s\S]*?<\/section>/, process);
  const root = await fixture({ plHtml: html });
  const result = await runVerification({ root, scope: "home", lang: "pl" });
  assert.ok(errorIds(result).includes("home-process-structure"));
});

test("home scope rejects a duplicate public-procurement possible-result row", async () => {
  const skills = '<section id="skills"><article data-service="public-procurement"><h3><a href="/uslugi/doradztwo-zamowienia-publiczne/">Zamówienia publiczne</a></h3><dl><div><dt>Możliwy wynik</dt><dd>One</dd></div><div><dt>Możliwy wynik</dt><dd>Two</dd></div></dl></article></section>';
  const html = replaceHomepageSection(homepageFixture("pl", "Marka"), "skills", skills);
  const root = await fixture({ plHtml: html });
  const result = await runVerification({ root, scope: "home", lang: "pl" });
  assert.ok(errorIds(result).includes("home-skills-structure"));
});

test("home scope accepts the localized English public-procurement Skills structure", async () => {
  const skills = `<section id="skills">${publicProcurementSkillsFixture("en")}</section>`;
  const html = replaceHomepageSection(homepageFixture("en", "Brand"), "skills", skills);
  const root = await fixture({ enHtml: html });
  const result = await runVerification({ root, scope: "home", lang: "en" });
  assert.ok(!errorIds(result).includes("home-skills-structure"));
});

test("home scope rejects mixed-language public-procurement ledger labels", async () => {
  const article = publicProcurementSkillsFixture("pl", { labels: ["Problem", "Działanie", "Możliwy wynik", "Possible outcome"] });
  const html = replaceHomepageSection(homepageFixture("pl", "Marka"), "skills", `<section id="skills">${article}</section>`);
  const root = await fixture({ plHtml: html });
  const result = await runVerification({ root, scope: "home", lang: "pl" });
  assert.ok(errorIds(result).includes("home-skills-structure"));
});

test("home scope rejects an extra unknown public-procurement ledger label", async () => {
  const article = publicProcurementSkillsFixture("pl", { labels: ["Problem", "Działanie", "Możliwy wynik", "Ryzyko"] });
  const html = replaceHomepageSection(homepageFixture("pl", "Marka"), "skills", `<section id="skills">${article}</section>`);
  const root = await fixture({ plHtml: html });
  const result = await runVerification({ root, scope: "home", lang: "pl" });
  assert.ok(errorIds(result).includes("home-skills-structure"));
});

test("home scope rejects reordered public-procurement ledger labels", async () => {
  const article = publicProcurementSkillsFixture("pl", { labels: ["Działanie", "Problem", "Możliwy wynik"] });
  const html = replaceHomepageSection(homepageFixture("pl", "Marka"), "skills", `<section id="skills">${article}</section>`);
  const root = await fixture({ plHtml: html });
  const result = await runVerification({ root, scope: "home", lang: "pl" });
  assert.ok(errorIds(result).includes("home-skills-structure"));
});

test("home scope rejects a missing public-procurement service item", async () => {
  const html = replaceHomepageSection(homepageFixture("pl", "Marka"), "skills", '<section id="skills"></section>');
  const root = await fixture({ plHtml: html });
  const result = await runVerification({ root, scope: "home", lang: "pl" });
  assert.ok(errorIds(result).includes("home-skills-structure"));
});

test("home scope rejects a public-procurement service item without its marker", async () => {
  const html = homepageFixture("pl", "Marka").replace(' data-service="public-procurement"', "");
  const root = await fixture({ plHtml: html });
  const result = await runVerification({ root, scope: "home", lang: "pl" });
  assert.ok(errorIds(result).includes("home-skills-structure"));
});

test("home scope rejects an unknown English public-procurement href", async () => {
  const skills = `<section id="skills">${publicProcurementSkillsFixture("en", { href: "/en/uslugi/typo/" })}</section>`;
  const html = replaceHomepageSection(homepageFixture("en", "Brand"), "skills", skills);
  const root = await fixture({ enHtml: html });
  const result = await runVerification({ root, scope: "home", lang: "en" });
  assert.ok(errorIds(result).includes("home-skills-structure"));
});

test("home scope rejects a duplicate public-procurement service marker on another route", async () => {
  const skills = `<section id="skills">${publicProcurementSkillsFixture("pl")}<article data-service="public-procurement"><a href="/uslugi/typo/">Other</a></article></section>`;
  const html = replaceHomepageSection(homepageFixture("pl", "Marka"), "skills", skills);
  const root = await fixture({ plHtml: html });
  const result = await runVerification({ root, scope: "home", lang: "pl" });
  assert.ok(errorIds(result).includes("home-skills-structure"));
});

for (const [variant, options] of [
  ["Polish path", { href: "/uslugi/doradztwo-zamowienia-publiczne/" }],
  ["Polish outcome label", { outcome: "Możliwy wynik" }]
]) {
  test(`home scope rejects the ${variant} on the English homepage`, async () => {
    const skills = `<section id="skills">${publicProcurementSkillsFixture("en", options)}</section>`;
    const html = replaceHomepageSection(homepageFixture("en", "Brand"), "skills", skills);
    const root = await fixture({ enHtml: html });
    const result = await runVerification({ root, scope: "home", lang: "en" });
    assert.ok(errorIds(result).includes("home-skills-structure"));
  });
}

test("home scope rejects the generic skill-card pattern", async () => {
  const skills = '<section id="skills"><article class="skill-card"><h3>Generic area</h3></article></section>';
  const html = replaceHomepageSection(homepageFixture("pl", "Marka"), "skills", skills);
  const root = await fixture({ plHtml: html });
  const result = await runVerification({ root, scope: "home", lang: "pl" });
  assert.ok(errorIds(result).includes("home-skills-structure"));
});

for (const surface of ["navigation", "footer"]) {
  test(`home scope requires the Polish Projekty label in the ${surface}`, async () => {
    const valid = homepageFixture("pl", "Marka");
    const html = surface === "navigation"
      ? valid.replace('<a href="/case-studies/">Projekty</a>', '<a href="/case-studies/">Case studies</a>')
      : valid.replace('<a href="/case-studies">Projekty</a>', '<a href="/case-studies">Case studies</a>');
    const root = await fixture({ plHtml: html });
    const result = await runVerification({ root, scope: "home", lang: "pl" });
    assert.ok(errorIds(result).includes("home-pl-ia"));
  });
}

for (const surface of ["navigation", "footer"]) {
  test(`home scope requires the English Projects label in the ${surface}`, async () => {
    const valid = homepageFixture("en", "Brand");
    const html = surface === "navigation"
      ? valid.replace('<a href="/en/case-studies/">Projects</a>', '<a href="/en/case-studies/">Case studies</a>')
      : valid.replace('<a href="/en/case-studies">Projects</a>', '<a href="/en/case-studies">Case studies</a>');
    const root = await fixture({ enHtml: html });
    const result = await runVerification({ root, scope: "home", lang: "en" });
    assert.ok(errorIds(result).includes("home-en-ia"));
  });
}

test("facts scope rejects an undated or stale akrobacja.com current status", async () => {
  const currentStatus = fact({
    id: "portfolio.akrobacja_com.current_status",
    value: "current aviation venture",
    display_pl: "Aktualna marka działalności lotniczej",
    display_en: "Current aviation venture",
    kind: "constant",
    as_of: null,
    source_label: "Owner correction, 2026-08-25",
    surfaces: ["index.html", "en/index.html"]
  });
  const root = await fixture({ facts: [fact(), currentStatus] });
  const result = await runVerification({ root, scope: "facts" });
  assert.ok(errorIds(result).includes("fact-current-contract"));
});

test("facts scope requires the 2026-08-26 owner correction on retired WarsawFlightSafety wording", async () => {
  const retired = fact({
    id: "aviation.warsaw_flight_safety",
    value: "retired wording",
    display_pl: "Właściciel WarsawFlightSafety",
    display_en: "Owner of WarsawFlightSafety",
    source_label: "Owner correction, 2026-08-25",
    status: "retired"
  });
  const root = await fixture({ facts: [fact(), retired] });
  const result = await runVerification({ root, scope: "facts" });
  assert.ok(errorIds(result).includes("fact-current-contract"));
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
      const html = homepageFixture(lang, lang === "pl" ? "Marka" : "Brand")
        .replace('<section id="contact"><a', `<section id="contact"><p>${page}</p><a`);
      const root = await fixture({ facts: [fact(), review], [`${lang}Html`]: html });
      const result = await runVerification({ root, scope: "home", lang });
      assert.deepEqual(errorIds(result).filter((errorId) => errorId.startsWith("fact-")), [`fact-${id}`]);
    });
  }
}

test("home parity rejects an extra English section marker", async () => {
  const enHtml = homepageFixture("en", "Brand").replace(
    '<section data-section="trust"></section>',
    '<section data-section="trust"></section><section data-section="trust"></section>'
  );
  const root = await fixture({ enHtml });
  const result = await runVerification({ root, scope: "home" });
  assert.ok(errorIds(result).includes("home-parity-sections"));
});

test("home scope rejects the same duplicate section marker on both languages", async () => {
  const duplicateTrust = (html) => html.replace(
    '<section data-section="trust"></section>',
    '<section data-section="trust"></section><section data-section="trust"></section>'
  );
  const root = await fixture({ plHtml: duplicateTrust(homepageFixture("pl", "Marka")), enHtml: duplicateTrust(homepageFixture("en", "Brand")) });
  const result = await runVerification({ root, scope: "home" });
  assert.ok(errorIds(result).includes("home-section-order"));
});

const factSequenceMutations = {
  missing: (html) => html.replace('<li class="about-fact" data-fact-id="aviation.ppl_h">PPL(H)</li>', ""),
  extra: (html) => html.replace('<section id="contact">', '<section id="contact"><span data-fact-id="brand.promise">Brand</span>'),
  reordered: (html) => html
    .replace('<li class="about-fact" data-fact-id="aviation.ppl_h">PPL(H)</li>', "__PPL_H__")
    .replace('<li class="about-fact" data-fact-id="aviation.ppl_a">PPL(A)</li>', '<li class="about-fact" data-fact-id="aviation.ppl_h">PPL(H)</li>')
    .replace("__PPL_H__", '<li class="about-fact" data-fact-id="aviation.ppl_a">PPL(A)</li>'),
  different: (html) => html.replace(
    '<li class="about-fact" data-fact-id="aviation.ppl_h">PPL(H)</li>',
    '<li class="about-fact" data-fact-id="aviation.ppl_a">PPL(A)</li>'
  )
};

for (const [mutation, mutate] of Object.entries(factSequenceMutations)) {
  test(`home parity rejects a ${mutation} English fact ID sequence`, async () => {
    const root = await fixture({ enHtml: mutate(homepageFixture("en", "Brand")) });
    const result = await runVerification({ root, scope: "home" });
    assert.ok(errorIds(result).includes("home-parity-facts"));
  });
}

test("home parity rejects reordered Process step identities", async () => {
  const enHtml = homepageFixture("en", "Brand").replace("01 / Diagnosis", "02 / Diagnosis");
  const root = await fixture({ enHtml });
  const result = await runVerification({ root, scope: "home" });
  assert.ok(errorIds(result).includes("home-parity-process"));
});

test("home parity rejects a changed evidence-row sequence", async () => {
  const enHtml = homepageFixture("en", "Brand").replace('data-domain="applications"', 'data-domain="aviation"');
  const root = await fixture({ enHtml });
  const result = await runVerification({ root, scope: "home" });
  assert.ok(errorIds(result).includes("home-parity-evidence-rows"));
});

for (const [inventory, first, second, errorId] of [
  ["portfolio", '<a class="pcard" href="https://alpha.example"><div class="pcard__title" data-fact-id="portfolio.alpha">Alpha</div></a>', '<a class="pcard" href="https://beta.example"><div class="pcard__title" data-fact-id="portfolio.beta">Beta</div></a>', "home-parity-portfolio"],
  ["clients", '<div class="client-item" data-fact-id="client.alpha">Alpha Client</div>', '<div class="client-item" data-fact-id="client.beta">Beta Client</div>', "home-parity-clients"]
]) {
  test(`home parity rejects reordered ${inventory} items`, async () => {
    const valid = parityInventoryFixture("en");
    const enHtml = valid.replace(first, "__FIRST__").replace(second, first).replace("__FIRST__", second);
    assert.notEqual(enHtml, valid);
    const inventoryFacts = [
      fact(),
      fact({ id: "portfolio.alpha", value: "Alpha", display_pl: "Alpha", display_en: "Alpha" }),
      fact({ id: "portfolio.beta", value: "Beta", display_pl: "Beta", display_en: "Beta" }),
      fact({ id: "client.alpha", value: "Alpha Client", display_pl: "Alpha Client", display_en: "Alpha Client" }),
      fact({ id: "client.beta", value: "Beta Client", display_pl: "Beta Client", display_en: "Beta Client" })
    ];
    const root = await fixture({ facts: inventoryFacts, plHtml: parityInventoryFixture("pl"), enHtml });
    const result = await runVerification({ root, scope: "home" });
    assert.ok(errorIds(result).includes(errorId));
  });
}

for (const [variant, enHref] of [
  ["Polish route", "/lotnictwo/"],
  ["invented translation", "/en/aviation/"]
]) {
  test(`home parity rejects a ${variant} on an English direct link`, async () => {
    const plHtml = homepageFixture("pl", "Marka").replace('<section id="portfolio"></section>', '<section id="portfolio"><a href="/lotnictwo/">Lotnictwo</a></section>');
    const enHtml = homepageFixture("en", "Brand").replace('<section id="portfolio"></section>', `<section id="portfolio"><a href="${enHref}">Aviation</a></section>`);
    const root = await fixture({ plHtml, enHtml });
    const result = await runVerification({ root, scope: "home" });
    assert.ok(errorIds(result).includes("home-parity-links"));
  });
}

test("home parity permits only the labelled Polish-only Procurement 2026 route", async () => {
  const plHtml = homepageFixture("pl", "Marka").replace('<section id="portfolio"></section>', '<section id="portfolio"><a class="pcard" href="/procurement-2026/"><div class="pcard__link">Otwórz projekt</div></a></section>');
  const enHtml = homepageFixture("en", "Brand").replace('<section id="portfolio"></section>', '<section id="portfolio"><a class="pcard" href="/procurement-2026/" lang="pl"><div class="pcard__link">Open project in Polish</div></a></section>');
  const root = await fixture({ plHtml, enHtml });
  const result = await runVerification({ root, scope: "home" });
  assert.ok(!errorIds(result).includes("home-parity-links"));
  assert.ok(!errorIds(result).includes("home-en-pl-only-link"));
});

test("home review hardening rejects a generic label on the current English Procurement 2026 anchor", async () => {
  const root = await currentHomepageMutationFixture("en", (html) => html.replace("Open project in Polish", "Open project"));
  const result = await runVerification({ root, scope: "home" });
  assert.ok(errorIds(result).includes("home-en-pl-only-link"));
});

for (const [location, mutate] of [
  ["an attribute", (html) => html
    .replace("Open project in Polish", "Open project")
    .replace('href="/procurement-2026/" lang="pl"', 'href="/procurement-2026/" lang="pl" aria-label="Open project in Polish"')],
  ["a comment", (html) => html.replace("Open project in Polish", "Open project<!-- Open project in Polish -->")],
  ["another element in the target anchor", (html) => html.replace(
    '<div class="pcard__link">Open project in Polish</div>',
    '<p>Open project in Polish</p><div class="pcard__link">Open project</div>'
  )],
  ["a sibling outside the target anchor", (html) => html
    .replace("Open project in Polish", "Open project")
    .replace('<a href="/procurement-2026/"', '<p>Open project in Polish</p><a href="/procurement-2026/"')],
  ["another anchor", (html) => html
    .replace("Open project in Polish", "Open project")
    .replace('<div class="pcard__link">Open project</div>', '<div class="pcard__link">Open project in Polish</div>')]
]) {
  test(`home review hardening does not accept the Polish disclosure from ${location}`, async () => {
    const root = await currentHomepageMutationFixture("en", mutate);
    const result = await runVerification({ root, scope: "home" });
    assert.ok(errorIds(result).includes("home-en-pl-only-link"));
  });
}

for (const [hiddenKind, mutate] of [
  ["hidden target anchor", (html) => html.replace(
    '<a href="/procurement-2026/" lang="pl" class="pcard">',
    '<a href="/procurement-2026/" lang="pl" hidden class="pcard">'
  )],
  ["aria-hidden target anchor", (html) => html.replace(
    '<a href="/procurement-2026/" lang="pl" class="pcard">',
    '<a href="/procurement-2026/" lang="pl" aria-hidden="true" class="pcard">'
  )],
  ["hidden label wrapper", (html) => html.replace(
    '<div class="pcard__link">Open project in Polish</div>',
    '<div class="pcard__link" hidden>Open project in Polish</div>'
  )],
  ["aria-hidden label wrapper", (html) => html.replace(
    '<div class="pcard__link">Open project in Polish</div>',
    '<div class="pcard__link" aria-hidden="true">Open project in Polish</div>'
  )],
  ["hidden inline label", (html) => html.replace(
    '<div class="pcard__link">Open project in Polish</div>',
    '<div class="pcard__link"><span hidden>Open project in Polish</span></div>'
  )],
  ["aria-hidden inline label", (html) => html.replace(
    '<div class="pcard__link">Open project in Polish</div>',
    '<div class="pcard__link"><span aria-hidden="true">Open project in Polish</span></div>'
  )],
  ["hidden ancestor", (html) => html.replace('<div class="portfolio-cards">', '<div class="portfolio-cards" hidden>')]
]) {
  test(`home visibility hardening rejects the Polish-only disclosure with a ${hiddenKind}`, async () => {
    const root = await currentHomepageMutationFixture("en", mutate);
    const result = await runVerification({ root, scope: "home" });
    assert.ok(errorIds(result).includes("home-en-pl-only-link"));
  });
}

test("home visibility hardening does not treat aria-hidden false or data-hidden as hidden", async () => {
  const root = await currentHomepageMutationFixture("en", (html) => html.replace(
    '<a href="/procurement-2026/" lang="pl" class="pcard">',
    '<a href="/procurement-2026/" lang="pl" aria-hidden="false" data-hidden="fixture" class="pcard">'
  ));
  const result = await runVerification({ root, scope: "home" });
  assert.ok(!errorIds(result).includes("home-en-pl-only-link"));
});

test("home visibility hardening resists a hidden decoy inside the visible retired aviation name", async () => {
  const root = await currentHomepageMutationFixture("en", (html) => html.replace(
    "</main>",
    '<p>WarsawFlight<span hidden>archived</span><a href="#contact">Safety</a></p></main>'
  ));
  const result = await runVerification({ root, scope: "home", lang: "en" });
  assert.ok(errorIds(result).includes("home-retired-aviation-name"));
});

test("home visibility hardening resists an aria-hidden disclosure decoy beside a generic label", async () => {
  const root = await currentHomepageMutationFixture("en", (html) => html.replace(
    '<div class="pcard__link">Open project in Polish</div>',
    '<div aria-hidden=" TRUE "><div class="pcard__link">Open project in Polish</div></div><div class="pcard__link">Open project</div>'
  ));
  const result = await runVerification({ root, scope: "home" });
  assert.ok(errorIds(result).includes("home-en-pl-only-link"));
});

test("home parser hardening reads Procurement href only from the real anchor attribute", async () => {
  const root = await currentHomepageMutationFixture("en", (html) => html.replace(
    '<a href="/procurement-2026/" lang="pl" class="pcard">',
    '<a title=\'href="/procurement-2026/"\' href="/en/procurement-2026/" lang="pl" class="pcard">'
  ));
  const result = await runVerification({ root, scope: "home" });
  assert.ok(errorIds(result).includes("home-en-pl-only-link"));
  assert.ok(errorIds(result).includes("home-parity-links"));
});

test("home parser hardening preserves a valid Procurement href after a quoted greater-than sign", async () => {
  const root = await currentHomepageMutationFixture("en", (html) => html.replace(
    '<a href="/procurement-2026/" lang="pl" class="pcard">',
    '<a title="Decision > tool" href="/procurement-2026/" lang="pl" class="pcard">'
  ));
  const result = await runVerification({ root, scope: "home" });
  assert.ok(!errorIds(result).includes("home-en-pl-only-link"));
  assert.ok(!errorIds(result).includes("home-parity-links"));
  assert.ok(!errorIds(result).includes("home-html-syntax"));
});

test("home parser hardening resists comment and anchor decoys inside raw script text", async () => {
  const root = await currentHomepageMutationFixture("en", (html) => html.replace(
    "</main>",
    `<script>const decoy = '<a href="/en/procurement-2026/"> <!--';</script><p>WarsawFlight<strong>Safety</strong></p></main>`
  ));
  const result = await runVerification({ root, scope: "home", lang: "en" });
  assert.ok(errorIds(result).includes("home-retired-aviation-name"));
  assert.ok(!errorIds(result).includes("home-html-syntax"));
});

test("home parser hardening resists fake routes in multiple quoted attributes", async () => {
  const root = await currentHomepageMutationFixture("en", (html) => html.replace(
    '<a href="/procurement-2026/" lang="pl" class="pcard">',
    '<a title="Decision > href=\'/procurement-2026/\'" data-route=\'href="/procurement-2026/"\' href="/en/procurement-2026/" lang="pl" class="pcard">'
  ));
  const result = await runVerification({ root, scope: "home" });
  assert.ok(errorIds(result).includes("home-en-pl-only-link"));
  assert.ok(errorIds(result).includes("home-parity-links"));
  assert.ok(!errorIds(result).includes("home-html-syntax"));
});

test("home parity preserves the local skip-link target", async () => {
  const plHtml = `<a href="#main">Przejdź do treści</a>${homepageFixture("pl", "Marka")}`;
  const enHtml = `<a href="#main">Skip to main content</a>${homepageFixture("en", "Brand")}`;
  const root = await fixture({ plHtml, enHtml });
  const result = await runVerification({ root, scope: "home" });
  assert.ok(!errorIds(result).includes("home-parity-links"));
});

for (const [variant, anchor] of [
  ["fake English route", '<a href="/en/procurement-2026/">Procurement Process 2026</a>'],
  ["missing language disclosure", '<a href="/procurement-2026/">Procurement Process 2026</a>']
]) {
  test(`home parity rejects the Procurement 2026 ${variant}`, async () => {
    const plHtml = homepageFixture("pl", "Marka").replace('<section id="portfolio"></section>', '<section id="portfolio"><a href="/procurement-2026/">Procurement Process 2026</a></section>');
    const enHtml = homepageFixture("en", "Brand").replace('<section id="portfolio"></section>', `<section id="portfolio">${anchor}</section>`);
    const root = await fixture({ plHtml, enHtml });
    const result = await runVerification({ root, scope: "home" });
    assert.ok(errorIds(result).includes(variant === "fake English route" ? "home-parity-links" : "home-en-pl-only-link"));
  });
}

test("home scope requires the fixed English hero thesis and lead", async () => {
  const enHtml = homepageFixture("en", "Procurement that works.").replace(
    "</h1>",
    '</h1><p class="hero-lead">I combine systems and delivery.</p>'
  );
  const root = await fixture({ enHtml });
  const result = await runVerification({ root, scope: "home", lang: "en" });
  assert.ok(errorIds(result).includes("home-en-contract"));
});

test("home scope requires the exact English Knowledge navigation label", async () => {
  const enHtml = homepageFixture("en", "Brand").replace('href="/en/wiedza/">Knowledge', 'href="/en/wiedza/">Insights');
  const root = await fixture({ enHtml });
  const result = await runVerification({ root, scope: "home", lang: "en" });
  assert.ok(errorIds(result).includes("home-en-contract"));
});

test("home scope requires every English Skills evidence row to use the exact ledger labels", async () => {
  const enHtml = homepageFixture("en", "Brand").replace("<dt>Action</dt>", "<dt>Approach</dt>");
  const root = await fixture({ enHtml });
  const result = await runVerification({ root, scope: "home", lang: "en" });
  assert.ok(errorIds(result).includes("home-skills-structure"));
});

test("home scope requires the exact ordered English contact intents", async () => {
  const enHtml = homepageFixture("en", "Brand").replace("subject=Operational%20application", "subject=Applications");
  const root = await fixture({ enHtml });
  const result = await runVerification({ root, scope: "home", lang: "en" });
  assert.ok(errorIds(result).includes("home-contact-intents"));
});

async function task7HomeMutation(lang, mutate) {
  const valid = homepageFixture(lang, lang === "pl" ? "Marka" : "Brand");
  const mutated = mutate(valid);
  assert.notEqual(mutated, valid, `Task 7 ${lang} mutation must change the fixture`);
  const root = await fixture({ [`${lang}Html`]: mutated });
  return runVerification({ root, scope: "home", lang });
}

const task7HomeMutations = [
  ["missing main landmark", "home-main", (html) => html.replace('<main id="main">', '<div id="main">').replace("</main>", "</div>")],
  ["missing skip link", "home-skip-link", (html) => html.replace('class="skip-link"', 'class="removed-skip-link"')],
  ["initially expanded mobile navigation", "home-nav-toggle", (html) => html.replace('aria-expanded="false"', 'aria-expanded="true"')],
  ["unlinked mobile navigation control", "home-nav-toggle", (html) => html.replace('aria-controls="nav-menu"', 'aria-controls="other-menu"')],
  ["wrong chat input limit", "home-chat-maxlength", (html) => html.replace('maxlength="2000"', 'maxlength="1999"')],
  ["missing hero image width", "home-hero-image", (html) => html.replace(' width="960"', "")],
  ["missing hero image height", "home-hero-image", (html) => html.replace(' height="1280"', "")],
  ["missing high-priority hero fetch", "home-hero-image", (html) => html.replace(' fetchpriority="high"', "")],
  ["stale stylesheet cache version", "home-cache-version", (html) => html.replace('style.css?v=20260825-flightplan-1', 'style.css?v=stale')],
  ["stale browser-script cache version", "home-cache-version", (html) => html.replace('main.js?v=20260825-flightplan-1', 'main.js?v=stale')],
  ["inline presentation style", "home-inline-style", (html) => html.replace('<section id="hero">', '<section id="hero" style="display:block">')]
];

for (const lang of ["pl", "en"]) {
  for (const [mutation, expectedError, mutate] of task7HomeMutations) {
    test(`Task 7 home baseline rejects ${mutation} on ${lang}`, async () => {
      const result = await task7HomeMutation(lang, mutate);
      assert.ok(errorIds(result).includes(expectedError));
    });
  }
}

const task7Round3ExactResourceMutations = [
  ["alternate stylesheet rel", "home-cache-version", (html) => html.replace(
    '<link rel="stylesheet" href="/assets/css/style.css?v=20260825-flightplan-1">',
    '<link rel="alternate stylesheet" href="/assets/css/style.css?v=20260825-flightplan-1">'
  )],
  ["stylesheet title attribute", "home-cache-version", (html) => html.replace(
    '<link rel="stylesheet" href="/assets/css/style.css?v=20260825-flightplan-1">',
    '<link rel="stylesheet" href="/assets/css/style.css?v=20260825-flightplan-1" title="decoy">'
  )],
  ["stylesheet integrity attribute", "home-cache-version", (html) => html.replace(
    '<link rel="stylesheet" href="/assets/css/style.css?v=20260825-flightplan-1">',
    '<link rel="stylesheet" href="/assets/css/style.css?v=20260825-flightplan-1" integrity="sha256-decoy">'
  )],
  ["stylesheet data decoy", "home-cache-version", (html) => html.replace(
    '<link rel="stylesheet" href="/assets/css/style.css?v=20260825-flightplan-1">',
    '<link rel="stylesheet" href="/assets/css/style.css?v=20260825-flightplan-1" data-decoy="true">'
  )],
  ["deferred async browser script", "home-cache-version", (html) => html.replace(
    '<script src="/assets/js/main.js?v=20260825-flightplan-1" defer>',
    '<script src="/assets/js/main.js?v=20260825-flightplan-1" defer async>'
  )],
  ["typed browser script", "home-cache-version", (html) => html.replace(
    '<script src="/assets/js/main.js?v=20260825-flightplan-1" defer>',
    '<script src="/assets/js/main.js?v=20260825-flightplan-1" defer type="text/javascript">'
  )],
  ["browser script integrity attribute", "home-cache-version", (html) => html.replace(
    '<script src="/assets/js/main.js?v=20260825-flightplan-1" defer>',
    '<script src="/assets/js/main.js?v=20260825-flightplan-1" defer integrity="sha256-decoy">'
  )],
  ["browser script data decoy", "home-cache-version", (html) => html.replace(
    '<script src="/assets/js/main.js?v=20260825-flightplan-1" defer>',
    '<script src="/assets/js/main.js?v=20260825-flightplan-1" defer data-decoy="true">'
  )],
  ["disabled latin font preload", "home-font-preload", (html) => html.replace(
    '<link rel="preload" as="font" type="font/woff2" href="/assets/fonts/barlow-semi-condensed-latin-600-normal.woff2" crossorigin>',
    '<link rel="preload" as="font" type="font/woff2" href="/assets/fonts/barlow-semi-condensed-latin-600-normal.woff2" crossorigin disabled>'
  )],
  ["latin-ext font preload title attribute", "home-font-preload", (html) => html.replace(
    '<link rel="preload" as="font" type="font/woff2" href="/assets/fonts/barlow-semi-condensed-latin-ext-600-normal.woff2" crossorigin>',
    '<link rel="preload" as="font" type="font/woff2" href="/assets/fonts/barlow-semi-condensed-latin-ext-600-normal.woff2" crossorigin title="decoy">'
  )],
  ["font preload integrity attribute", "home-font-preload", (html) => html.replace(
    '<link rel="preload" as="font" type="font/woff2" href="/assets/fonts/barlow-semi-condensed-latin-600-normal.woff2" crossorigin>',
    '<link rel="preload" as="font" type="font/woff2" href="/assets/fonts/barlow-semi-condensed-latin-600-normal.woff2" crossorigin integrity="sha256-decoy">'
  )],
  ["font preload data decoy", "home-font-preload", (html) => html.replace(
    '<link rel="preload" as="font" type="font/woff2" href="/assets/fonts/barlow-semi-condensed-latin-600-normal.woff2" crossorigin>',
    '<link rel="preload" as="font" type="font/woff2" href="/assets/fonts/barlow-semi-condensed-latin-600-normal.woff2" crossorigin data-decoy="true">'
  )]
];

const task7Round4ScriptTopologyMutations = [
  ["extra text/ecmascript inline script", (html) => html.replace(
    "</body>",
    '<script type="text/ecmascript">window.reviewExtra = true;</script></body>'
  )],
  ["extra application/ecmascript inline script", (html) => html.replace(
    "</body>",
    '<script type="application/ecmascript">window.reviewExtra = true;</script></body>'
  )],
  ["extra application/x-javascript inline script", (html) => html.replace(
    "</body>",
    '<script type="application/x-javascript">window.reviewExtra = true;</script></body>'
  )],
  ["extra text/javascript1.5 inline script", (html) => html.replace(
    "</body>",
    '<script type="text/javascript1.5">window.reviewExtra = true;</script></body>'
  )],
  ["extra text/livescript external script", (html) => html.replace(
    "</body>",
    '<script type="text/livescript" src="/assets/js/legacy.js"></script></body>'
  )],
  ["extra inline module script", (html) => html.replace(
    "</body>",
    '<script type="module">window.reviewExtra = true;</script></body>'
  )],
  ["extra external module script", (html) => html.replace(
    "</body>",
    '<script type="module" src="/assets/js/module.js"></script></body>'
  )],
  ["extra untyped inline script", (html) => html.replace(
    "</body>",
    '<script>window.reviewExtra = true;</script></body>'
  )],
  ["extra unknown-MIME inline script", (html) => html.replace(
    "</body>",
    '<script type="application/x-review-decoy">window.reviewExtra = true;</script></body>'
  )],
  ["extra unknown-MIME external script", (html) => html.replace(
    "</body>",
    '<script type="application/x-review-decoy" src="/assets/js/decoy.js"></script></body>'
  )],
  ["external JSON-LD decoy script", (html) => html.replace(
    "</body>",
    '<script type="application/ld+json" src="/assets/js/structured-data-decoy.js"></script></body>'
  )],
  ["inert template script decoy", (html) => html.replace(
    "</body>",
    '<template><script type="application/json">{"decoy":true}</script></template></body>'
  )]
];

for (const lang of ["pl", "en"]) {
  test(`Task 7 round 4 script topology accepts exactly two JSON-LD blocks and one main script on ${lang}`, async () => {
    const root = await fixture({ [`${lang}Html`]: homepageFixture(lang, lang === "pl" ? "Marka" : "Brand") });
    const result = await runVerification({ root, scope: "home", lang });
    assert.ok(!errorIds(result).includes("home-cache-version"));
  });
  for (const [mutation, mutate] of task7Round4ScriptTopologyMutations) {
    test(`Task 7 round 4 script topology rejects ${mutation} on ${lang}`, async () => {
      const result = await task7HomeMutation(lang, mutate);
      assert.ok(errorIds(result).includes("home-cache-version"));
    });
  }
}

test("Task 7 round 4 probe rejects an extra obscure text/jscript script", async () => {
  const result = await task7HomeMutation("pl", (html) => html.replace(
    "</body>",
    '<script type="text/jscript">window.obscureReviewExtra = true;</script></body>'
  ));
  assert.ok(errorIds(result).includes("home-cache-version"));
});

for (const lang of ["pl", "en"]) {
  test(`Task 7 round 3 exact resources accepts current controlled tags on ${lang}`, async () => {
    const root = await fixture({ [`${lang}Html`]: homepageFixture(lang, lang === "pl" ? "Marka" : "Brand") });
    const result = await runVerification({ root, scope: "home", lang });
    assert.ok(!errorIds(result).includes("home-cache-version"));
    assert.ok(!errorIds(result).includes("home-font-preload"));
  });
  for (const [mutation, expectedError, mutate] of task7Round3ExactResourceMutations) {
    test(`Task 7 round 3 exact resources rejects ${mutation} on ${lang}`, async () => {
      const result = await task7HomeMutation(lang, mutate);
      assert.ok(errorIds(result).includes(expectedError));
    });
  }
}

const task7Round2ActiveResourceMutations = [
  ["stylesheet with inactive media", "home-cache-version", (html) => html.replace(
    '<link rel="stylesheet" href="/assets/css/style.css?v=20260825-flightplan-1">',
    '<link rel="stylesheet" href="/assets/css/style.css?v=20260825-flightplan-1" media="not all">'
  )],
  ["disabled stylesheet", "home-cache-version", (html) => html.replace(
    '<link rel="stylesheet" href="/assets/css/style.css?v=20260825-flightplan-1">',
    '<link rel="stylesheet" href="/assets/css/style.css?v=20260825-flightplan-1" disabled>'
  )],
  ["latin font preload with inactive media", "home-font-preload", (html) => html.replace(
    '<link rel="preload" as="font" type="font/woff2" href="/assets/fonts/barlow-semi-condensed-latin-600-normal.woff2" crossorigin>',
    '<link rel="preload" as="font" type="font/woff2" href="/assets/fonts/barlow-semi-condensed-latin-600-normal.woff2" crossorigin media="not all">'
  )],
  ["latin-ext font preload with inactive media", "home-font-preload", (html) => html.replace(
    '<link rel="preload" as="font" type="font/woff2" href="/assets/fonts/barlow-semi-condensed-latin-ext-600-normal.woff2" crossorigin>',
    '<link rel="preload" as="font" type="font/woff2" href="/assets/fonts/barlow-semi-condensed-latin-ext-600-normal.woff2" crossorigin media="not all">'
  )],
  ["nomodule browser script", "home-cache-version", (html) => html.replace(
    '<script src="/assets/js/main.js?v=20260825-flightplan-1" defer>',
    '<script src="/assets/js/main.js?v=20260825-flightplan-1" defer nomodule>'
  )],
  ["stylesheet inside noscript", "home-cache-version", (html) => html.replace(
    '<link rel="stylesheet" href="/assets/css/style.css?v=20260825-flightplan-1">',
    '<noscript><link rel="stylesheet" href="/assets/css/style.css?v=20260825-flightplan-1"></noscript>'
  )],
  ["latin font preload inside noscript", "home-font-preload", (html) => html.replace(
    '<link rel="preload" as="font" type="font/woff2" href="/assets/fonts/barlow-semi-condensed-latin-600-normal.woff2" crossorigin>',
    '<noscript><link rel="preload" as="font" type="font/woff2" href="/assets/fonts/barlow-semi-condensed-latin-600-normal.woff2" crossorigin></noscript>'
  )],
  ["latin-ext font preload inside noscript", "home-font-preload", (html) => html.replace(
    '<link rel="preload" as="font" type="font/woff2" href="/assets/fonts/barlow-semi-condensed-latin-ext-600-normal.woff2" crossorigin>',
    '<noscript><link rel="preload" as="font" type="font/woff2" href="/assets/fonts/barlow-semi-condensed-latin-ext-600-normal.woff2" crossorigin></noscript>'
  )],
  ["browser script inside noscript", "home-cache-version", (html) => html.replace(
    '<script src="/assets/js/main.js?v=20260825-flightplan-1" defer></script>',
    '<noscript><script src="/assets/js/main.js?v=20260825-flightplan-1" defer></script></noscript>'
  )],
  ["stylesheet inside template", "home-cache-version", (html) => html.replace(
    '<link rel="stylesheet" href="/assets/css/style.css?v=20260825-flightplan-1">',
    '<template><link rel="stylesheet" href="/assets/css/style.css?v=20260825-flightplan-1"></template>'
  )],
  ["latin font preload inside template", "home-font-preload", (html) => html.replace(
    '<link rel="preload" as="font" type="font/woff2" href="/assets/fonts/barlow-semi-condensed-latin-600-normal.woff2" crossorigin>',
    '<template><link rel="preload" as="font" type="font/woff2" href="/assets/fonts/barlow-semi-condensed-latin-600-normal.woff2" crossorigin></template>'
  )],
  ["latin-ext font preload inside template", "home-font-preload", (html) => html.replace(
    '<link rel="preload" as="font" type="font/woff2" href="/assets/fonts/barlow-semi-condensed-latin-ext-600-normal.woff2" crossorigin>',
    '<template><link rel="preload" as="font" type="font/woff2" href="/assets/fonts/barlow-semi-condensed-latin-ext-600-normal.woff2" crossorigin></template>'
  )],
  ["browser script inside template", "home-cache-version", (html) => html.replace(
    '<script src="/assets/js/main.js?v=20260825-flightplan-1" defer></script>',
    '<template><script src="/assets/js/main.js?v=20260825-flightplan-1" defer></script></template>'
  )],
  ["stylesheet inside aria-hidden ancestor", "home-cache-version", (html) => html.replace(
    '<link rel="stylesheet" href="/assets/css/style.css?v=20260825-flightplan-1">',
    '<div aria-hidden="true"><link rel="stylesheet" href="/assets/css/style.css?v=20260825-flightplan-1"></div>'
  )],
  ["font preload inside hidden ancestor", "home-font-preload", (html) => html.replace(
    '<link rel="preload" as="font" type="font/woff2" href="/assets/fonts/barlow-semi-condensed-latin-600-normal.woff2" crossorigin>',
    '<div hidden><link rel="preload" as="font" type="font/woff2" href="/assets/fonts/barlow-semi-condensed-latin-600-normal.woff2" crossorigin></div>'
  )],
  ["browser script inside aria-hidden ancestor", "home-cache-version", (html) => html.replace(
    '<script src="/assets/js/main.js?v=20260825-flightplan-1" defer></script>',
    '<div aria-hidden="true"><script src="/assets/js/main.js?v=20260825-flightplan-1" defer></script></div>'
  )]
];

for (const lang of ["pl", "en"]) {
  for (const [mutation, expectedError, mutate] of task7Round2ActiveResourceMutations) {
    test(`Task 7 round 2 active resources rejects ${mutation} on ${lang}`, async () => {
      const result = await task7HomeMutation(lang, mutate);
      assert.ok(errorIds(result).includes(expectedError));
    });
  }
}

const task7ReviewHomeSemanticMutations = [
  ["hidden main landmark", "home-main", (html) => html.replace('<main id="main">', '<main id="main" hidden>')],
  ["aria-hidden main landmark", "home-main", (html) => html.replace('<main id="main">', '<main id="main" aria-hidden="true">')],
  ["main landmark inside a hidden ancestor", "home-main", (html) => html
    .replace('<main id="main">', '<div hidden><main id="main">')
    .replace('</main><footer>', '</main></div><footer>')],
  ["hidden hero section", "home-hero-image", (html) => html.replace('<section id="hero">', '<section id="hero" hidden>')],
  ["aria-hidden hero section", "home-hero-image", (html) => html.replace('<section id="hero">', '<section id="hero" aria-hidden="true">')],
  ["hero section inside an aria-hidden ancestor", "home-hero-image", (html) => html
    .replace('<section id="hero">', '<div aria-hidden="true"><section id="hero">')
    .replace('</section>\n    <section data-section="trust">', '</section></div>\n    <section data-section="trust">')],
  ["hidden chat input", "home-chat-maxlength", (html) => html.replace('<input id="chat-input"', '<input hidden id="chat-input"')],
  ["aria-hidden chat input", "home-chat-maxlength", (html) => html.replace('<input id="chat-input"', '<input aria-hidden="true" id="chat-input"')],
  ["chat input inside a hidden ancestor", "home-chat-maxlength", (html) => html.replace(
    '<input id="chat-input" maxlength="2000">',
    '<div hidden><input id="chat-input" maxlength="2000"></div>'
  )],
  ["stylesheet changed to a style preload", "home-cache-version", (html) => html.replace(
    '<link rel="stylesheet" href="/assets/css/style.css?v=20260825-flightplan-1">',
    '<link rel="preload" as="style" href="/assets/css/style.css?v=20260825-flightplan-1">'
  )],
  ["hidden stylesheet", "home-cache-version", (html) => html.replace(
    '<link rel="stylesheet" href="/assets/css/style.css?v=20260825-flightplan-1">',
    '<link rel="stylesheet" href="/assets/css/style.css?v=20260825-flightplan-1" hidden>'
  )],
  ["stylesheet attributes on a meta decoy", "home-cache-version", (html) => html.replace(
    '<link rel="stylesheet" href="/assets/css/style.css?v=20260825-flightplan-1">',
    '<meta rel="stylesheet" href="/assets/css/style.css?v=20260825-flightplan-1">'
  )],
  ["additional active stylesheet", "home-cache-version", (html) => html.replace(
    "</head>",
    '<link rel="stylesheet" href="/assets/css/extra.css">\n  </head>'
  )],
  ["non-executable JSON browser script", "home-cache-version", (html) => html.replace(
    '<script src="/assets/js/main.js?v=20260825-flightplan-1" defer>',
    '<script src="/assets/js/main.js?v=20260825-flightplan-1" type="application/json" defer>'
  )],
  ["browser script without defer", "home-cache-version", (html) => html.replace(
    '<script src="/assets/js/main.js?v=20260825-flightplan-1" defer>',
    '<script src="/assets/js/main.js?v=20260825-flightplan-1">'
  )],
  ["hidden browser script", "home-cache-version", (html) => html.replace(
    '<script src="/assets/js/main.js?v=20260825-flightplan-1" defer>',
    '<script src="/assets/js/main.js?v=20260825-flightplan-1" defer hidden>'
  )],
  ["browser-script attributes on a meta decoy", "home-cache-version", (html) => html.replace(
    '<script src="/assets/js/main.js?v=20260825-flightplan-1" defer></script>',
    '<meta src="/assets/js/main.js?v=20260825-flightplan-1" defer>'
  )],
  ["additional executable browser script", "home-cache-version", (html) => html.replace(
    "</body>",
    '<script src="/assets/js/extra.js" defer></script></body>'
  )],
  ["Playfair substituted for the latin Barlow preload", "home-font-preload", (html) => html.replace(
    '/assets/fonts/barlow-semi-condensed-latin-600-normal.woff2',
    '/assets/fonts/playfair-latin.woff2'
  )],
  ["DM Sans substituted for the latin-ext Barlow preload", "home-font-preload", (html) => html.replace(
    '/assets/fonts/barlow-semi-condensed-latin-ext-600-normal.woff2',
    '/assets/fonts/dmsans-latext.woff2'
  )],
  ["third font preload", "home-font-preload", (html) => html.replace(
    '    <link rel="stylesheet" href="/assets/css/style.css?v=20260825-flightplan-1">',
    '    <link rel="preload" as="font" type="font/woff2" href="/assets/fonts/dmmono-latin.woff2" crossorigin>\n    <link rel="stylesheet" href="/assets/css/style.css?v=20260825-flightplan-1">'
  )],
  ["font preload with the wrong rel", "home-font-preload", (html) => html.replace(
    '<link rel="preload" as="font" type="font/woff2" href="/assets/fonts/barlow-semi-condensed-latin-600-normal.woff2" crossorigin>',
    '<link rel="prefetch" as="font" type="font/woff2" href="/assets/fonts/barlow-semi-condensed-latin-600-normal.woff2" crossorigin>'
  )],
  ["font preload with an additional rel token", "home-font-preload", (html) => html.replace(
    '<link rel="preload" as="font" type="font/woff2" href="/assets/fonts/barlow-semi-condensed-latin-600-normal.woff2" crossorigin>',
    '<link rel="preload stylesheet" as="font" type="font/woff2" href="/assets/fonts/barlow-semi-condensed-latin-600-normal.woff2" crossorigin>'
  )],
  ["font preload with the wrong destination", "home-font-preload", (html) => html.replace(
    '<link rel="preload" as="font" type="font/woff2" href="/assets/fonts/barlow-semi-condensed-latin-600-normal.woff2" crossorigin>',
    '<link rel="preload" as="script" type="font/woff2" href="/assets/fonts/barlow-semi-condensed-latin-600-normal.woff2" crossorigin>'
  )],
  ["font preload with the wrong MIME type", "home-font-preload", (html) => html.replace(
    '<link rel="preload" as="font" type="font/woff2" href="/assets/fonts/barlow-semi-condensed-latin-600-normal.woff2" crossorigin>',
    '<link rel="preload" as="font" type="font/ttf" href="/assets/fonts/barlow-semi-condensed-latin-600-normal.woff2" crossorigin>'
  )],
  ["font preload without crossorigin", "home-font-preload", (html) => html.replace(
    '<link rel="preload" as="font" type="font/woff2" href="/assets/fonts/barlow-semi-condensed-latin-600-normal.woff2" crossorigin>',
    '<link rel="preload" as="font" type="font/woff2" href="/assets/fonts/barlow-semi-condensed-latin-600-normal.woff2">'
  )],
  ["font preload with credentialed crossorigin", "home-font-preload", (html) => html.replace(
    '<link rel="preload" as="font" type="font/woff2" href="/assets/fonts/barlow-semi-condensed-latin-600-normal.woff2" crossorigin>',
    '<link rel="preload" as="font" type="font/woff2" href="/assets/fonts/barlow-semi-condensed-latin-600-normal.woff2" crossorigin="use-credentials">'
  )],
  ["hidden font preload", "home-font-preload", (html) => html.replace(
    '<link rel="preload" as="font" type="font/woff2" href="/assets/fonts/barlow-semi-condensed-latin-600-normal.woff2" crossorigin>',
    '<link rel="preload" as="font" type="font/woff2" href="/assets/fonts/barlow-semi-condensed-latin-600-normal.woff2" crossorigin hidden>'
  )],
  ["font-preload attributes on a meta decoy", "home-font-preload", (html) => html.replace(
    '<link rel="preload" as="font" type="font/woff2" href="/assets/fonts/barlow-semi-condensed-latin-600-normal.woff2" crossorigin>',
    '<meta rel="preload" as="font" type="font/woff2" href="/assets/fonts/barlow-semi-condensed-latin-600-normal.woff2" crossorigin>'
  )]
];

for (const lang of ["pl", "en"]) {
  for (const [mutation, expectedError, mutate] of task7ReviewHomeSemanticMutations) {
    test(`Task 7 review home semantics rejects ${mutation} on ${lang}`, async () => {
      const result = await task7HomeMutation(lang, mutate);
      assert.ok(errorIds(result).includes(expectedError));
    });
  }
}

function deterministicBudgetNoise(length) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let state = 0x51f15e;
  let value = "";
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    value += alphabet[state % alphabet.length];
  }
  return value;
}

test("Task 7 foundation rejects CSS above the compressed budget", async () => {
  const css = `${foundationCss}\n/* ${deterministicBudgetNoise(200_000)} */`;
  const root = await fixture({ css });
  const result = await runVerification({ root, scope: "foundation" });
  assert.ok(errorIds(result).includes("budget-css-gzip"));
});

test("Task 7 foundation rejects browser JavaScript above the compressed budget", async () => {
  const js = `${validBrowserScript}\nconst task7BudgetNoise = "${deterministicBudgetNoise(80_000)}";`;
  const root = await fixture({ css: foundationCss, js });
  const result = await runVerification({ root, scope: "foundation" });
  assert.ok(errorIds(result).includes("budget-js-gzip"));
});

test("Task 7 foundation rejects a hero image above the byte budget", async () => {
  const root = await fixture({ css: foundationCss, heroImage: Buffer.alloc(220_001) });
  const result = await runVerification({ root, scope: "foundation" });
  assert.ok(errorIds(result).includes("budget-hero-image"));
});

test("Task 7 foundation fails closed when the budgeted hero image is missing", async () => {
  const root = await fixture({ css: foundationCss, heroImage: null });
  const result = await runVerification({ root, scope: "foundation" });
  assert.ok(errorIds(result).includes("budget-hero-image"));
});
