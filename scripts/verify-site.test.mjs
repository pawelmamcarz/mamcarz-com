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
  return `${navigationFixture[lang]}<main>
    <section id="hero"><h1 data-fact-id="brand.promise">${content}</h1></section>
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
  </main><footer><a href="${projectsHref}">${projectsLabel}</a></footer><input id="chat-input" maxlength="2000">`;
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

async function fixture({ facts = [fact()], blocked_claims = [blockedClaim()], pl = "Marka", en = "Brand", plHtml, enHtml, serviceHtml = legacyNavigationFixture, notFoundHtml = legacyNavigationFixture, css = "body{}", js = validBrowserScript, extraFiles = {} } = {}) {
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
    mkdir(resolve(root, "en"), { recursive: true }),
    mkdir(resolve(root, "uslugi/wdrozenie-sap-ariba"), { recursive: true }),
    mkdir(resolve(root, "worker"), { recursive: true })
  ]);
  await Promise.all([
    writeFile(resolve(root, "content/site-facts.json"), JSON.stringify({ version: 1, facts: fixtureFacts, blocked_claims })),
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
  const plHtml = homepageFixture("pl", "Marka").replace('<section id="portfolio"></section>', '<section id="portfolio"><a href="/procurement-2026/">Procurement Process 2026</a></section>');
  const enHtml = homepageFixture("en", "Brand").replace('<section id="portfolio"></section>', '<section id="portfolio"><a href="/procurement-2026/" lang="pl">Procurement Process 2026, Polish-language material</a></section>');
  const root = await fixture({ plHtml, enHtml });
  const result = await runVerification({ root, scope: "home" });
  assert.ok(!errorIds(result).includes("home-parity-links"));
  assert.ok(!errorIds(result).includes("home-en-pl-only-link"));
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
