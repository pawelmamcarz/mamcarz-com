import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const defaultRoot = resolve(import.meta.dirname, "..");
const factKeys = ["id", "value", "display_pl", "display_en", "kind", "as_of", "source_type", "source_label", "source_url", "surfaces", "status"];
const kinds = new Set(["constant", "dated"]);
const sourceTypes = new Set(["owner_verified", "public_source", "internal_evidence"]);
const statuses = new Set(["approved", "review", "retired"]);
const blockedKeys = ["id", "pattern", "forbidden_contexts", "reason"];
const requiredPublicClaimSurfaces = ["index.html", "en/index.html", "llms.txt", "llms-full.txt", "worker/index.js", "assets/js/main.js"];

function error(errors, id, path, message) {
  errors.push(`ERROR ${id} ${path}: ${message}`);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validFactValue(value) {
  return nonEmptyString(value) || (typeof value === "number" && Number.isFinite(value));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function normalize(text) {
  return text
    .normalize("NFKC")
    .replace(/\p{Default_Ignorable_Code_Point}+/gu, "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_match, entity) => {
      const codePoint = Number.parseInt(entity.slice(0, 1).toLowerCase() === "x" ? entity.slice(1) : entity, entity.slice(0, 1).toLowerCase() === "x" ? 16 : 10);
      return codePoint > 0 && codePoint <= 0x10FFFF ? String.fromCodePoint(codePoint) : "�";
    })
    .replace(/&mdash;/gi, "—")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&");
}

function renderedText(html) {
  return normalize(decodeHtmlEntities(html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")));
}

function openingTagAttributes(openingTag) {
  const attributes = new Map();
  const tag = /^<\s*[a-z][a-z0-9:-]*/i.exec(openingTag);
  if (!tag) return attributes;
  let cursor = tag[0].length;
  while (cursor < openingTag.length) {
    while (/\s/.test(openingTag[cursor] ?? "")) cursor += 1;
    if (openingTag[cursor] === ">" || (openingTag[cursor] === "/" && openingTag[cursor + 1] === ">")) break;
    const nameStart = cursor;
    while (cursor < openingTag.length && !/[\s=/>]/.test(openingTag[cursor])) cursor += 1;
    const name = openingTag.slice(nameStart, cursor).toLowerCase();
    if (name.length === 0) {
      cursor += 1;
      continue;
    }
    while (/\s/.test(openingTag[cursor] ?? "")) cursor += 1;
    let value = null;
    if (openingTag[cursor] === "=") {
      cursor += 1;
      while (/\s/.test(openingTag[cursor] ?? "")) cursor += 1;
      const quote = openingTag[cursor];
      if (quote === "\"" || quote === "'") {
        cursor += 1;
        const valueStart = cursor;
        while (cursor < openingTag.length && openingTag[cursor] !== quote) cursor += 1;
        value = openingTag.slice(valueStart, cursor);
        if (openingTag[cursor] === quote) cursor += 1;
      } else {
        const valueStart = cursor;
        while (cursor < openingTag.length && !/[\s>]/.test(openingTag[cursor])) cursor += 1;
        value = openingTag.slice(valueStart, cursor);
      }
    }
    if (!attributes.has(name)) attributes.set(name, value);
  }
  return attributes;
}

function scanHtmlTagEnd(html, opening) {
  let quote = null;
  for (let index = opening + 1; index < html.length; index += 1) {
    const character = html[index];
    if (quote !== null) {
      if (character === quote) quote = null;
    } else if (character === "\"" || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return -1;
}

function parsedTag(openingTag) {
  const match = /^<\s*(\/?)\s*([a-z][a-z0-9:-]*)\b/i.exec(openingTag);
  if (!match) return null;
  const name = match[2].toLowerCase();
  return {
    name,
    closing: match[1] === "/",
    selfClosing: voidHtmlElements.has(name) || (/\/\s*>$/.test(openingTag) && !rawTextElements.has(name)),
    attributes: match[1] === "/" ? new Map() : openingTagAttributes(openingTag)
  };
}

function parseStaticHtml(html) {
  const root = { type: "root", name: "#root", attributes: new Map(), children: [], parent: null };
  const stack = [root];
  const errors = [];
  const append = (node) => {
    node.parent = stack[stack.length - 1];
    node.parent.children.push(node);
  };
  let cursor = 0;
  while (cursor < html.length) {
    const opening = html.indexOf("<", cursor);
    if (opening === -1) {
      if (cursor < html.length) append({ type: "text", value: html.slice(cursor) });
      break;
    }
    if (opening > cursor) append({ type: "text", value: html.slice(cursor, opening) });
    if (html.startsWith("<!--", opening)) {
      const commentEnd = html.indexOf("-->", opening + 4);
      if (commentEnd === -1) {
        errors.push(`unterminated comment at offset ${opening}`);
        cursor = html.length;
        break;
      }
      cursor = commentEnd + 3;
      continue;
    }
    const tagEnd = scanHtmlTagEnd(html, opening);
    if (tagEnd === -1) {
      errors.push(`unterminated tag at offset ${opening}`);
      cursor = html.length;
      break;
    }
    const source = html.slice(opening, tagEnd + 1);
    if (/^<!doctype\b/i.test(source)) {
      cursor = tagEnd + 1;
      continue;
    }
    const tag = parsedTag(source);
    if (!tag) {
      errors.push(`malformed tag at offset ${opening}`);
      cursor = tagEnd + 1;
      continue;
    }
    if (tag.closing) {
      const current = stack[stack.length - 1];
      if (current.name === tag.name) {
        stack.pop();
      } else {
        errors.push(`mismatched closing tag </${tag.name}> at offset ${opening}`);
        let matchingIndex = -1;
        for (let index = stack.length - 1; index > 0; index -= 1) {
          if (stack[index].name === tag.name) {
            matchingIndex = index;
            break;
          }
        }
        if (matchingIndex !== -1) stack.length = matchingIndex;
      }
      cursor = tagEnd + 1;
      continue;
    }
    const node = { type: "element", name: tag.name, attributes: tag.attributes, children: [], parent: null };
    append(node);
    cursor = tagEnd + 1;
    if (rawTextElements.has(tag.name) && !tag.selfClosing) {
      const closing = new RegExp(`<\\/\\s*${escapeRegExp(tag.name)}\\s*>`, "ig");
      closing.lastIndex = cursor;
      const match = closing.exec(html);
      if (!match) {
        errors.push(`unterminated raw-text element <${tag.name}> at offset ${opening}`);
        cursor = html.length;
        break;
      }
      cursor = match.index + match[0].length;
      continue;
    }
    if (!tag.selfClosing) stack.push(node);
  }
  for (const unclosed of stack.slice(1).reverse()) errors.push(`unclosed element <${unclosed.name}>`);
  return { root, errors };
}

function elementAttribute(element, name) {
  return element.attributes.get(name.toLowerCase()) ?? null;
}

function elementHasClass(element, className) {
  return (elementAttribute(element, "class") ?? "").split(/\s+/).includes(className);
}

function elementDescendants(node, name = null) {
  const descendants = [];
  for (const child of node.children ?? []) {
    if (child.type !== "element") continue;
    if (name === null || child.name === name) descendants.push(child);
    descendants.push(...elementDescendants(child, name));
  }
  return descendants;
}

function htmlBodyRoot(parsedRoot) {
  const bodies = elementDescendants(parsedRoot, "body");
  return bodies.length === 1 ? bodies[0] : parsedRoot;
}

function elementHasHiddenState(element) {
  return element.attributes.has("hidden") || normalize(elementAttribute(element, "aria-hidden") ?? "") === "true";
}

function elementIsStaticallyHidden(element) {
  return elementHasHiddenState(element) || staticallyHiddenElements.has(element.name);
}

function elementIsStaticallyVisible(element) {
  for (let current = element; current?.type === "element"; current = current.parent) {
    if (elementIsStaticallyHidden(current)) return false;
  }
  return true;
}

const inactiveResourceAncestors = new Set(["noscript", "template"]);

function elementIsActiveResource(element) {
  for (let current = element; current?.type === "element"; current = current.parent) {
    if (elementHasHiddenState(current) || inactiveResourceAncestors.has(current.name)) return false;
  }
  return true;
}

function elementAttributeTokens(element, name) {
  return normalize(elementAttribute(element, name) ?? "").split(" ").filter(Boolean);
}

function elementHasExactAttributeNames(element, names) {
  return element.attributes.size === names.size && [...names].every((name) => element.attributes.has(name));
}

function staticVisibleText(node) {
  let text = "";
  const visit = (current, ancestorHidden = false) => {
    if (current.type === "text") {
      if (!ancestorHidden) text += current.value;
      return;
    }
    const hidden = ancestorHidden || (current.type === "element" && elementIsStaticallyHidden(current));
    const block = current.type === "element" && blockTextElements.has(current.name);
    if (!hidden && block) text += " ";
    for (const child of current.children ?? []) visit(child, hidden);
    if (!hidden && block) text += " ";
  };
  visit(node);
  return normalize(decodeHtmlEntities(text));
}

function homepageBody(html) {
  return /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html;
}

const homepageMarkers = [
  'id="hero"',
  'data-section="trust"',
  'id="process"',
  'data-cta-after="process"',
  'id="cases"',
  'data-cta-after="cases"',
  'id="about"',
  'id="education"',
  'id="resume"',
  'id="skills"',
  'id="portfolio"',
  'id="clients"',
  'id="contact"'
];

const forbiddenHomepageCopy = ["—", "nie tylko", "kompleksow", "innowacyjn", "realnie", "#1", "największ", "Polpharma"];
const retiredHomepageAviationName = /(^|[^\p{L}\p{N}_])warsawflightsafety($|[^\p{L}\p{N}_])/u;
const blockTextElements = new Set(["address", "article", "aside", "blockquote", "body", "br", "dd", "details", "dialog", "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "li", "main", "nav", "ol", "p", "pre", "section", "summary", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul"]);
const rawTextElements = new Set(["script", "style"]);
const staticallyHiddenElements = new Set(["script", "style", "template"]);
const voidHtmlElements = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

const homeFactTags = ["a", "dd", "div", "h1", "h3", "li", "p", "span", "strong"];

const homeFactPatterns = [
  { section: "hero", tag: "h1", prefix: "brand." },
  { section: "hero", tag: "div", className: "stat-num", prefix: "hero." },
  { sectionAttribute: ["data-section", "trust"], tag: "span", className: "trust-bar-name", prefix: "client." },
  { section: "cases", tag: "h3", className: "evidence-row__title", prefix: "client." },
  { section: "cases", tag: "dd", prefix: "project." },
  { section: "about", tag: "li", prefix: "aviation." },
  { section: "education", tag: "div", className: "resume-edu-year", prefix: "education." },
  { section: "education", tag: "strong", prefix: "education." },
  { section: "education", tag: "span", prefix: "education." },
  { section: "resume", tag: "div", className: "timeline-year", prefix: "career." },
  { section: "resume", tag: "div", className: "timeline-company", prefix: "career." },
  { section: "resume", tag: "p", className: "timeline-role", prefix: "career." },
  { section: "resume", tag: "p", className: "timeline-desc", prefix: "career." },
  { section: "portfolio", tag: "div", className: "pcard__tag", prefix: "portfolio." },
  { section: "portfolio", tag: "div", className: "pcard__title", prefix: "portfolio." },
  { section: "portfolio", tag: "div", className: "pcard__desc", prefix: "portfolio." },
  { section: "portfolio", tag: "p", className: "evidence-row__context", prefix: "portfolio." },
  { section: "portfolio", tag: "h3", className: "evidence-row__title", prefix: "portfolio." },
  { section: "portfolio", tag: "dd", prefix: "portfolio." },
  { section: "clients", tag: "div", className: "client-item", prefix: "client." }
];

const aboutCopyContracts = {
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

const aboutAviationFactOrder = [
  "aviation.ppl_h",
  "aviation.ppl_a",
  "aviation.aerobatics_rating",
  "aviation.diverse_extreme_team",
  "aviation.forum_photographer",
  "aviation.air_to_air_media"
];

const localizedHomeRoutes = new Map([
  ["/", "/en/"],
  ["/#about", "/en/#about"],
  ["/#contact", "/en/#contact"],
  ["#main", "#main"],
  ["#contact", "#contact"],
  ["/uslugi/transformacja-zakupow/", "/en/uslugi/transformacja-zakupow/"],
  ["/uslugi/wdrozenie-sap-ariba/", "/en/uslugi/wdrozenie-sap-ariba/"],
  ["/uslugi/wdrozenie-sap-ariba", "/en/uslugi/wdrozenie-sap-ariba"],
  ["/uslugi/doradztwo-zamowienia-publiczne/", "/en/uslugi/doradztwo-zamowienia-publiczne/"],
  ["/aplikacje-operacyjne/", "/en/aplikacje-operacyjne/"],
  ["/lotnictwo/", "/en/lotnictwo/"],
  ["/case-studies/", "/en/case-studies/"],
  ["/case-studies", "/en/case-studies"],
  ["/wiedza/", "/en/wiedza/"],
  ["/procurement-2026/", "/procurement-2026/"]
]);

const englishHomeContract = {
  headline: "From decision to an operational system.",
  lead: "I lead procurement transformations, build operational applications and develop aviation ventures. I take work from a defined problem to a solution used in day-to-day operations.",
  process: ["Diagnosis", "Strategy", "Implementation", "Value"],
  domains: [
    ["/en/uslugi/transformacja-zakupow/", "Advisory"],
    ["/en/aplikacje-operacyjne/", "Operational applications"],
    ["/en/lotnictwo/", "Aviation"]
  ],
  navigation: [
    ["/en/aplikacje-operacyjne/", "Operational applications"],
    ["/en/lotnictwo/", "Aviation"],
    ["/en/case-studies/", "Projects"],
    ["/en/wiedza/", "Knowledge"],
    ["/en/#about", "About"],
    ["/en/#contact", "Contact"]
  ]
};

function activeHomepageBody(body) {
  return stripHtmlComments(body).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
}

function sectionBlock(activeBody, pattern) {
  return tagBlocks(activeBody, "section").find((block) => pattern.section
    ? attributeValue(block.opening, "id") === pattern.section
    : attributeValue(block.opening, pattern.sectionAttribute[0]) === pattern.sectionAttribute[1]);
}

function homeFactElements(activeBody) {
  return homeFactTags.flatMap((tag) => tagBlocks(activeBody, tag)
    .filter((block) => attributeValue(block.opening, "data-fact-id") !== null)
    .map((block) => ({ ...block, tag })));
}

function withoutAnnotatedHomeFacts(activeBody) {
  let remaining = activeBody;
  for (const tag of homeFactTags) {
    const pattern = new RegExp(`<${tag}\\b(?=[^>]*\\bdata-fact-id\\s*=)[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi");
    remaining = remaining.replace(pattern, " ");
  }
  return remaining;
}

function verifyHomeFactPatterns(activeBody, page, errors) {
  for (const pattern of homeFactPatterns) {
    const section = sectionBlock(activeBody, pattern);
    if (!section) continue;
    const blocks = tagBlocks(section.full, pattern.tag).filter((block) => !pattern.className || hasClass(block.opening, pattern.className));
    for (const block of blocks) {
      const factId = attributeValue(block.opening, "data-fact-id");
      if (factId === null || !factId.startsWith(pattern.prefix)) {
        error(errors, "home-fact-annotation", page.path, `${pattern.section ?? pattern.sectionAttribute[1]} ${pattern.tag}${pattern.className ? `.${pattern.className}` : ""} requires a ${pattern.prefix} data-fact-id`);
      }
    }
  }
}

function verifyAboutStructure(activeBody, page, errors) {
  const about = sectionBlock(activeBody, { section: "about" });
  if (!about) return;
  const aboutTexts = tagBlocks(about.full, "div").filter((block) => hasClass(block.opening, "about-text"));
  const problems = [];
  if (aboutTexts.length !== 1) problems.push(`expected one .about-text; found ${aboutTexts.length}`);
  const aboutText = aboutTexts[0];
  if (!aboutText) {
    error(errors, "home-about-structure", page.path, problems.join("; "));
    return;
  }

  const contract = aboutCopyContracts[page.lang];
  const allParagraphs = tagBlocks(about.full, "p");
  const paragraphs = tagBlocks(aboutText.full, "p");
  if (allParagraphs.length !== 3 || paragraphs.length !== 3) {
    problems.push(`expected exactly three controlled About paragraphs; found ${allParagraphs.length} section-wide and ${paragraphs.length} in .about-text`);
  }
  const label = paragraphs[0];
  if (!label || (attributeValue(label.opening, "class") ?? "").trim() !== "section-label" || attributeValue(label.opening, "data-about-copy") !== null || renderedText(label.content) !== normalize(contract.label)) {
    problems.push("section label must be the exact localized controlled paragraph");
  }
  for (const [index, [copyId, copy]] of contract.narratives.entries()) {
    const paragraph = paragraphs[index + 1];
    if (!paragraph || attributeValue(paragraph.opening, "data-about-copy") !== copyId || renderedText(paragraph.content) !== normalize(copy)) {
      problems.push(`narrative ${copyId} must be exact and ordered`);
    }
  }

  if (tagBlocks(about.full, "span").length > 0) problems.push("unsupported span inside About");

  const allOpeningTags = openingTags(about.full, "[a-z][a-z0-9:-]*");
  const items = tagBlocks(about.full, "li");
  const aboutFactTags = allOpeningTags.filter((tag) => hasClass(tag, "about-fact"));
  const annotatedTags = allOpeningTags.filter((tag) => attributeValue(tag, "data-fact-id") !== null);
  if (items.length !== aboutAviationFactOrder.length || aboutFactTags.length !== aboutAviationFactOrder.length || annotatedTags.length !== aboutAviationFactOrder.length) {
    problems.push(`expected six About li, .about-fact and data-fact-id uses; found ${items.length}, ${aboutFactTags.length} and ${annotatedTags.length}`);
  }
  if (aboutFactTags.some((tag) => !/^<li\b/i.test(tag) || attributeValue(tag, "data-fact-id") === null)) {
    problems.push("every .about-fact must be an annotated li");
  }

  const aboutFactContainers = allOpeningTags.filter((tag) => hasClass(tag, "about-facts"));
  const aboutFactLists = tagBlocks(about.full, "ul").filter((block) => hasClass(block.opening, "about-facts"));
  if (aboutFactContainers.length !== 1 || aboutFactLists.length !== 1) {
    problems.push(`expected one ul.about-facts; found ${aboutFactContainers.length}`);
  } else {
    const listItems = tagBlocks(aboutFactLists[0].full, "li");
    if (listItems.length !== aboutAviationFactOrder.length) problems.push(`expected ${aboutAviationFactOrder.length} facts in ul.about-facts; found ${listItems.length}`);
    for (const [index, factId] of aboutAviationFactOrder.entries()) {
      const item = items[index];
      if (!item || !hasClass(item.opening, "about-fact") || attributeValue(item.opening, "data-fact-id") !== factId) {
        problems.push(`About fact ${index + 1} must be ${factId}`);
      }
    }
  }

  if (problems.length > 0) error(errors, "home-about-structure", page.path, problems.join("; "));
}

function verifyHomeStructures(activeBody, page, errors) {
  verifyAboutStructure(activeBody, page, errors);
  const process = sectionBlock(activeBody, { section: "process" });
  if (process) {
    const steps = tagBlocks(process.full, "article").filter((block) => hasClass(block.opening, "route-sequence__step"));
    const routeSteps = steps.length;
    const articleClosings = (process.full.match(/<\/article\s*>/gi) ?? []).length;
    if (routeSteps !== 4 || articleClosings !== 4) {
      error(errors, "home-process-structure", page.path, `Process requires four matched route steps; found ${routeSteps} openings and ${articleClosings} closings`);
    }
    const expectedLabels = page.lang === "pl" ? ["Diagnoza", "Strategia", "Wdrożenie", "Wartość"] : englishHomeContract.process;
    const labels = steps.map((step) => tagBlocks(step.full, "h3").map((heading) => renderedText(heading.content)));
    const indexes = steps.map((step) => {
      const label = tagBlocks(step.full, "p").find((paragraph) => hasClass(paragraph.opening, "section-index"));
      return /^(\d{2})\s*\//.exec(renderedText(label?.content ?? ""))?.[1] ?? null;
    });
    const expectedIndexes = ["01", "02", "03", "04"];
    if (labels.length !== expectedLabels.length
      || labels.some((headings, index) => headings.length !== 1 || headings[0] !== normalize(expectedLabels[index]))
      || indexes.some((value, index) => value !== expectedIndexes[index])) {
      error(errors, "home-process-structure", page.path, "Process requires the exact localized ordered step labels and 01-04 indexes");
    }
  }

  const skills = sectionBlock(activeBody, { section: "skills" });
  if (skills) {
    const genericCards = openingTags(skills.full, "[a-z][a-z0-9:-]*").filter((tag) => hasClass(tag, "skill-card"));
    if (genericCards.length > 0) error(errors, "home-skills-structure", page.path, "Skills must use the route/evidence system instead of skill-card");
    const localized = page.lang === "pl"
      ? { path: "/uslugi/doradztwo-zamowienia-publiczne/", labels: ["Problem", "Działanie", "Możliwy wynik"], name: "Zamówienia publiczne" }
      : { path: "/en/uslugi/doradztwo-zamowienia-publiczne/", labels: ["Problem", "Action", "Possible outcome"], name: "Public procurement" };
    const evidenceRows = tagBlocks(skills.full, "article").filter((block) => hasClass(block.opening, "evidence-row"));
    for (const [index, row] of evidenceRows.entries()) {
      const labels = tagBlocks(row.full, "dt").map((block) => renderedText(block.content));
      const expectedLabels = localized.labels.map(normalize);
      if (labels.length !== expectedLabels.length || labels.some((label, labelIndex) => label !== expectedLabels[labelIndex])) {
        error(errors, "home-skills-structure", page.path, `Skills evidence row ${index + 1} requires the exact ordered ledger labels: ${localized.labels.join(", ")}`);
      }
    }
    const serviceMarkers = openingTags(skills.full, "[a-z][a-z0-9:-]*").filter((tag) => attributeValue(tag, "data-service") === "public-procurement");
    const serviceArticles = tagBlocks(skills.full, "article").filter((block) => attributeValue(block.opening, "data-service") === "public-procurement");
    if (serviceMarkers.length !== 1 || serviceArticles.length !== 1) {
      error(errors, "home-skills-structure", page.path, `${localized.name} requires exactly one article[data-service=public-procurement]; found ${serviceMarkers.length} markers and ${serviceArticles.length} articles`);
    } else {
      const links = tagBlocks(serviceArticles[0].full, "a");
      const exactRoute = links.length === 1 && attributeValue(links[0].opening, "href") === localized.path;
      if (!exactRoute) error(errors, "home-skills-structure", page.path, `${localized.name} must use the exact localized ${localized.path} route`);
      const labels = tagBlocks(serviceArticles[0].full, "dt").map((block) => renderedText(block.content));
      const expectedLabels = localized.labels.map(normalize);
      if (labels.length !== expectedLabels.length || labels.some((label, index) => label !== expectedLabels[index])) {
        error(errors, "home-skills-structure", page.path, `${localized.name} requires the exact ordered ledger labels: ${localized.labels.join(", ")}`);
      }
    }
  }

  const projects = page.lang === "pl"
    ? { navPath: "/case-studies/", footerPath: "/case-studies", label: "Projekty", errorId: "home-pl-ia", language: "Polish" }
    : { navPath: "/en/case-studies/", footerPath: "/en/case-studies", label: "Projects", errorId: "home-en-ia", language: "English" };
  const navigation = tagBlocks(activeBody, "nav").find((block) => hasClass(block.opening, "site-nav"));
  const footer = tagBlocks(activeBody, "footer")[0];
  const navProjects = navigation ? tagBlocks(navigation.full, "a").filter((block) => attributeValue(block.opening, "href") === projects.navPath) : [];
  const footerProjects = footer ? tagBlocks(footer.full, "a").filter((block) => attributeValue(block.opening, "href") === projects.footerPath) : [];
  const validNavLabel = navProjects.length === 1 && renderedText(navProjects[0].content) === normalize(projects.label);
  const validFooterLabel = footerProjects.length === 1 && renderedText(footerProjects[0].content) === normalize(projects.label);
  if (!validNavLabel || !validFooterLabel) error(errors, projects.errorId, page.path, `${projects.language} navigation and footer must label the case-studies route as ${projects.label}`);

  const contact = sectionBlock(activeBody, { section: "contact" });
  if (contact) {
    const expectedIntents = page.lang === "pl"
      ? [["mailto:pawel@mamcarz.com?subject=Doradztwo", "Doradztwo"], ["mailto:pawel@mamcarz.com?subject=Aplikacja%20operacyjna", "Aplikacja operacyjna"], ["mailto:pawel@mamcarz.com?subject=Lotnictwo", "Lotnictwo"]]
      : [["mailto:pawel@mamcarz.com?subject=Advisory", "Advisory"], ["mailto:pawel@mamcarz.com?subject=Operational%20application", "Operational application"], ["mailto:pawel@mamcarz.com?subject=Aviation", "Aviation"]];
    const intents = tagBlocks(contact.full, "a")
      .map((block) => [attributeValue(block.opening, "href"), renderedText(block.content)])
      .filter(([href]) => href?.startsWith("mailto:pawel@mamcarz.com?subject="));
    const valid = intents.length === expectedIntents.length && expectedIntents.every(([href, label], index) => intents[index]?.[0] === href && intents[index]?.[1] === normalize(label));
    if (!valid) error(errors, "home-contact-intents", page.path, "Contact requires the exact ordered localized Advisory, Operational application and Aviation mailto intents");
  }
}

function verifyHomepageContent(body, parsedBody, page, errors) {
  const activeBody = activeHomepageBody(body);
  let previousIndex = -1;
  for (const marker of homepageMarkers) {
    const index = activeBody.indexOf(marker);
    if (index === -1) {
      error(errors, "home-section-order", page.path, `missing marker ${marker}`);
      continue;
    }
    if (index <= previousIndex) error(errors, "home-section-order", page.path, `marker ${marker} is out of order`);
    previousIndex = index;
  }
  const actualMarkers = homepageMarkerSequence(activeBody);
  if (!exactSequence(homepageMarkers, actualMarkers)) {
    error(errors, "home-section-order", page.path, "homepage requires exactly the 11 ordered sections and two ordered CTA markers");
  }

  const visible = staticVisibleText(parsedBody);
  for (const pattern of forbiddenHomepageCopy) {
    if (visible.includes(normalize(pattern))) error(errors, "home-forbidden-copy", page.path, `visible copy contains ${pattern}`);
  }
  if (retiredHomepageAviationName.test(visible)) {
    error(errors, "home-retired-aviation-name", page.path, "visible homepage copy must not publish the retired WarsawFlightSafety name");
  }
  return visible;
}

function verifyHomepageBaseline(parsedRoot, page, errors) {
  const elements = elementDescendants(parsedRoot);
  const mains = elements.filter((element) => element.name === "main");
  if (mains.length !== 1 || elementAttribute(mains[0] ?? { attributes: new Map() }, "id") !== "main" || !elementIsStaticallyVisible(mains[0])) {
    error(errors, "home-main", page.path, "homepage requires exactly one visible main#main landmark");
  }

  const skipLinks = elements.filter((element) => element.name === "a" && elementHasClass(element, "skip-link"));
  if (skipLinks.length !== 1 || elementAttribute(skipLinks[0], "href") !== "#main" || !elementIsStaticallyVisible(skipLinks[0])) {
    error(errors, "home-skip-link", page.path, "homepage requires exactly one visible skip-link targeting #main");
  }

  const navToggles = elements.filter((element) => element.name === "button" && elementAttribute(element, "id") === "nav-toggle");
  if (navToggles.length !== 1
    || elementAttribute(navToggles[0], "aria-expanded") !== "false"
    || elementAttribute(navToggles[0], "aria-controls") !== "nav-menu") {
    error(errors, "home-nav-toggle", page.path, "nav-toggle requires aria-expanded=false and aria-controls=nav-menu");
  }

  const chatInputs = elements.filter((element) => element.name === "input" && elementAttribute(element, "id") === "chat-input");
  if (chatInputs.length !== 1 || elementAttribute(chatInputs[0], "maxlength") !== "2000" || !elementIsStaticallyVisible(chatInputs[0])) {
    error(errors, "home-chat-maxlength", page.path, "homepage requires one visible chat input with maxlength 2000");
  }

  const heroSections = elements.filter((element) => element.name === "section" && elementAttribute(element, "id") === "hero");
  const visibleHero = heroSections.length === 1 && elementIsStaticallyVisible(heroSections[0]);
  const heroImages = visibleHero ? elementDescendants(heroSections[0], "img") : [];
  const heroImage = heroImages[0];
  const width = heroImage ? elementAttribute(heroImage, "width") : null;
  const height = heroImage ? elementAttribute(heroImage, "height") : null;
  const validDimensions = /^\d+$/.test(width ?? "") && Number(width) > 0
    && /^\d+$/.test(height ?? "") && Number(height) > 0;
  if (!visibleHero || heroImages.length !== 1 || !elementIsStaticallyVisible(heroImage) || !validDimensions || elementAttribute(heroImage, "fetchpriority") !== "high") {
    error(errors, "home-hero-image", page.path, "visible hero requires one visible image with explicit positive width and height plus fetchpriority=high");
  }

  const expectedCss = "/assets/css/style.css?v=20260825-flightplan-1";
  const expectedJs = "/assets/js/main.js?v=20260825-flightplan-1";
  const stylesheetAttributeNames = new Set(["rel", "href"]);
  const stylesheetNodes = elements.filter((element) => element.name === "link" && (
    elementAttributeTokens(element, "rel").includes("stylesheet")
    || (elementAttribute(element, "href") ?? "").startsWith("/assets/css/style.css")
  ));
  const validStylesheets = stylesheetNodes.filter((element) => {
    const rel = elementAttributeTokens(element, "rel");
    return elementHasExactAttributeNames(element, stylesheetAttributeNames)
      && rel.length === 1
      && rel[0] === "stylesheet"
      && elementAttribute(element, "href") === expectedCss
      && elementIsActiveResource(element);
  });
  const scriptAttributeNames = new Set(["src", "defer"]);
  const jsonLdAttributeNames = new Set(["type"]);
  const scriptNodes = elements.filter((element) => element.name === "script");
  const jsonLdScripts = scriptNodes.filter((element) => elementHasExactAttributeNames(element, jsonLdAttributeNames)
    && normalize(elementAttribute(element, "type") ?? "") === "application/ld+json"
    && elementIsActiveResource(element));
  const validBrowserScripts = scriptNodes.filter((element) => elementHasExactAttributeNames(element, scriptAttributeNames)
    && elementAttribute(element, "src") === expectedJs
    && element.attributes.has("defer")
    && elementIsActiveResource(element));
  if (stylesheetNodes.length !== 1 || validStylesheets.length !== 1
    || scriptNodes.length !== 3 || jsonLdScripts.length !== 2 || validBrowserScripts.length !== 1) {
    error(errors, "home-cache-version", page.path, `homepage requires exactly one active ${expectedCss} stylesheet, two inline application/ld+json scripts and one deferred ${expectedJs} script`);
  }

  const expectedFontHrefs = new Set([
    "/assets/fonts/barlow-semi-condensed-latin-600-normal.woff2",
    "/assets/fonts/barlow-semi-condensed-latin-ext-600-normal.woff2"
  ]);
  const fontAttributeNames = new Set(["rel", "as", "type", "href", "crossorigin"]);
  const fontLinks = elements.filter((element) => element.name === "link" && (
    (elementAttribute(element, "href") ?? "").startsWith("/assets/fonts/")
    || (elementAttributeTokens(element, "rel").includes("preload") && normalize(elementAttribute(element, "as") ?? "") === "font")
  ));
  const validFontLinks = fontLinks.filter((element) => {
    const rel = elementAttributeTokens(element, "rel");
    const crossorigin = normalize(elementAttribute(element, "crossorigin") ?? "");
    return elementHasExactAttributeNames(element, fontAttributeNames)
      && expectedFontHrefs.has(elementAttribute(element, "href"))
      && rel.length === 1
      && rel[0] === "preload"
      && normalize(elementAttribute(element, "as") ?? "") === "font"
      && normalize(elementAttribute(element, "type") ?? "") === "font/woff2"
      && element.attributes.has("crossorigin")
      && (crossorigin === "" || crossorigin === "anonymous")
      && elementIsActiveResource(element);
  });
  const actualFontHrefs = new Set(validFontLinks.map((element) => elementAttribute(element, "href")));
  if (fontLinks.length !== 2 || validFontLinks.length !== 2
    || actualFontHrefs.size !== expectedFontHrefs.size
    || [...expectedFontHrefs].some((href) => !actualFontHrefs.has(href))) {
    error(errors, "home-font-preload", page.path, "homepage requires only the Barlow Semi Condensed 600 latin and latin-ext WOFF2 font preloads with crossorigin");
  }

  if (elements.some((element) => element.attributes.has("style"))) {
    error(errors, "home-inline-style", page.path, "inline style attributes are forbidden on the homepage");
  }
}

function exactSequence(first, second) {
  return first.length === second.length && first.every((value, index) => value === second[index]);
}

function homepageMarkerSequence(activeBody) {
  const markers = [];
  const sectionIds = new Set(["hero", "process", "cases", "about", "education", "resume", "skills", "portfolio", "clients", "contact"]);
  for (const tag of openingTags(activeBody, "[a-z][a-z0-9:-]*")) {
    const tagName = /^<([a-z][a-z0-9:-]*)/i.exec(tag)?.[1].toLowerCase();
    if (tagName !== "section" && tagName !== "aside") continue;
    const id = attributeValue(tag, "id");
    const section = attributeValue(tag, "data-section");
    const cta = attributeValue(tag, "data-cta-after");
    if (sectionIds.has(id)) markers.push(`id="${id}"`);
    else if (section === "trust") markers.push('data-section="trust"');
    else if (cta === "process" || cta === "cases") markers.push(`data-cta-after="${cta}"`);
  }
  return markers;
}

function annotatedFactSequence(activeBody) {
  return openingTags(activeBody, "[a-z][a-z0-9:-]*")
    .map((tag) => attributeValue(tag, "data-fact-id"))
    .filter(nonEmptyString);
}

function processStepSequence(activeBody) {
  const process = sectionBlock(activeBody, { section: "process" });
  if (!process) return [];
  return tagBlocks(process.full, "article")
    .filter((block) => hasClass(block.opening, "route-sequence__step"))
    .map((step) => {
      const index = tagBlocks(step.full, "p").find((paragraph) => hasClass(paragraph.opening, "section-index"));
      return /^(\d{2})\s*\//.exec(renderedText(index?.content ?? ""))?.[1] ?? "missing";
    });
}

function evidenceRowSequence(activeBody) {
  return tagBlocks(activeBody, "article")
    .filter((block) => hasClass(block.opening, "evidence-row"))
    .map((row) => JSON.stringify({
      domain: attributeValue(row.opening, "data-domain") ?? "",
      service: attributeValue(row.opening, "data-service") ?? "",
      facts: annotatedFactSequence(row.full)
    }));
}

function portfolioItemSequence(activeBody) {
  const portfolio = sectionBlock(activeBody, { section: "portfolio" });
  if (!portfolio) return [];
  return tagBlocks(portfolio.full, "a")
    .filter((block) => hasClass(block.opening, "pcard"))
    .map((item) => annotatedFactSequence(item.full).join("|"));
}

function clientItemSequence(activeBody) {
  const clients = sectionBlock(activeBody, { section: "clients" });
  if (!clients) return [];
  return openingTags(clients.full, "div")
    .filter((tag) => hasClass(tag, "client-item"))
    .map((tag) => attributeValue(tag, "data-fact-id") ?? "missing");
}

function pairedLinkSequence(parsedBody) {
  return elementDescendants(parsedBody, "a")
    .filter((link) => !elementHasClass(link, "nav-lang"))
    .map((link) => ({ href: elementAttribute(link, "href") }))
    .filter((link) => nonEmptyString(link.href) && !link.href.startsWith("mailto:"));
}

function verifyEnglishPolishOnlyLink(parsedBody, page, errors) {
  if (page.lang !== "en") return;
  const procurementAnchors = elementDescendants(parsedBody, "a").filter((link) => {
    const href = elementAttribute(link, "href");
    const factIds = [link, ...elementDescendants(link)]
      .map((element) => elementAttribute(element, "data-fact-id"))
      .filter(nonEmptyString);
    return href === "/procurement-2026/"
      || href === "/en/procurement-2026/"
      || factIds.includes("portfolio.procurement_process_2026");
  });
  if (procurementAnchors.length === 0) return;
  const visibleProcurementAnchors = procurementAnchors.filter(elementIsStaticallyVisible);
  const validPolishOnly = procurementAnchors.length === 1 && visibleProcurementAnchors.length === 1 && visibleProcurementAnchors.every((anchor) => {
    const disclosureLabels = elementDescendants(anchor, "div")
      .filter((element) => elementHasClass(element, "pcard__link"))
      .filter(elementIsStaticallyVisible);
    return elementAttribute(anchor, "href") === "/procurement-2026/"
      && elementAttribute(anchor, "lang") === "pl"
      && disclosureLabels.length === 1
      && staticVisibleText(disclosureLabels[0]) === normalize("Open project in Polish");
  });
  if (!validPolishOnly) {
    error(errors, "home-en-pl-only-link", page.path, "Procurement 2026 requires the exact Polish route, lang=pl and visible Open project in Polish label on that anchor; a fake English route is forbidden");
  }
}

function verifyEnglishHomeContract(activeBody, page, errors) {
  if (page.lang !== "en") return;
  const problems = [];
  const hero = sectionBlock(activeBody, { section: "hero" });
  const headline = hero ? tagBlocks(hero.full, "h1") : [];
  const lead = hero ? tagBlocks(hero.full, "p").filter((paragraph) => hasClass(paragraph.opening, "hero-lead")) : [];
  if (headline.length !== 1 || renderedText(headline[0]?.content ?? "") !== normalize(englishHomeContract.headline)) problems.push("hero headline");
  if (lead.length !== 1 || renderedText(lead[0]?.content ?? "") !== normalize(englishHomeContract.lead)) problems.push("hero lead");
  const domainNav = hero ? tagBlocks(hero.full, "nav").find((nav) => hasClass(nav.opening, "hero-tag")) : null;
  const domainLinks = domainNav ? tagBlocks(domainNav.full, "a").map((link) => [attributeValue(link.opening, "href"), renderedText(link.content)]) : [];
  if (domainLinks.length !== englishHomeContract.domains.length || englishHomeContract.domains.some(([href, label], index) => domainLinks[index]?.[0] !== href || domainLinks[index]?.[1] !== normalize(label))) problems.push("three equal domain routes");
  const navigation = tagBlocks(activeBody, "nav").find((nav) => hasClass(nav.opening, "site-nav"));
  const links = navigation ? tagBlocks(navigation.full, "a") : [];
  if (englishHomeContract.navigation.some(([href, label]) => {
    const matches = links.filter((link) => attributeValue(link.opening, "href") === href);
    return matches.length !== 1 || renderedText(matches[0].content) !== normalize(label);
  })) problems.push("navigation labels");
  const advisory = navigation ? tagBlocks(navigation.full, "summary") : [];
  if (advisory.length !== 1 || renderedText(advisory[0].content) !== normalize("Advisory")) problems.push("Advisory label");
  if (problems.length > 0) error(errors, "home-en-contract", page.path, `English homepage contract mismatch: ${problems.join(", ")}`);
}

function verifyHomepageParity(plBody, enBody, plParsedBody, enParsedBody, errors) {
  const comparisons = [
    ["home-parity-sections", "section markers", homepageMarkerSequence(plBody), homepageMarkerSequence(enBody)],
    ["home-parity-facts", "data-fact-id sequence", annotatedFactSequence(plBody), annotatedFactSequence(enBody)],
    ["home-parity-process", "Process steps", processStepSequence(plBody), processStepSequence(enBody)],
    ["home-parity-evidence-rows", "evidence rows", evidenceRowSequence(plBody), evidenceRowSequence(enBody)],
    ["home-parity-portfolio", "Portfolio items", portfolioItemSequence(plBody), portfolioItemSequence(enBody)],
    ["home-parity-clients", "Client items", clientItemSequence(plBody), clientItemSequence(enBody)]
  ];
  for (const [id, label, plSequence, enSequence] of comparisons) {
    if (!exactSequence(plSequence, enSequence)) error(errors, id, "en/index.html", `${label} must exactly match the ordered Polish sequence`);
  }

  const plLinks = pairedLinkSequence(plParsedBody);
  const enLinks = pairedLinkSequence(enParsedBody);
  const expectedEnglishLinks = plLinks.map(({ href }) => {
    if (/^https?:\/\//i.test(href)) return href;
    return localizedHomeRoutes.get(href) ?? null;
  });
  const actualEnglishLinks = enLinks.map(({ href }) => href);
  if (expectedEnglishLinks.some((href) => href === null) || !exactSequence(expectedEnglishLinks, actualEnglishLinks)) {
    error(errors, "home-parity-links", "en/index.html", "ordered internal routes must use exact /en/ counterparts and external routes must remain unchanged");
  }

}

function stripHtmlComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, " ");
}

function attributeValue(openingTag, name) {
  const match = new RegExp(`\\b${escapeRegExp(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(openingTag);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function hasClass(openingTag, className) {
  return (attributeValue(openingTag, "class") ?? "").split(/\s+/).includes(className);
}

function openingTags(html, tagName) {
  return [...html.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, "gi"))].map((match) => match[0]);
}

function tagBlocks(html, tagName) {
  const blocks = [];
  const stack = [];
  const tags = new RegExp(`<(/?)${tagName}\\b[^>]*>`, "gi");
  for (const match of html.matchAll(tags)) {
    if (match[1] === "") {
      stack.push({ opening: match[0], contentStart: match.index + match[0].length });
    } else {
      const opening = stack.pop();
      if (opening) {
        blocks.push({
          opening: opening.opening,
          content: html.slice(opening.contentStart, match.index),
          full: html.slice(opening.contentStart - opening.opening.length, match.index + match[0].length)
        });
      }
    }
  }
  return blocks;
}

function stripJsComments(source) {
  let output = "";
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (character === "\n") {
        lineComment = false;
        output += "\n";
      }
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote !== null) {
      output += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      output += character;
      continue;
    }
    if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    output += character;
  }
  return output;
}

const htmlSinkAssignments = new Set([
  "=", "+=", "-=", "*=", "/=", "%=", "**=", "<<=", ">>=", ">>>=", "&=", "^=", "|=", "&&=", "||=", "??=", "++", "--"
]);

const jsPunctuators = [
  ">>>=", "===", "!==", "**=", "<<=", ">>=", "&&=", "||=", "??=", ">>>", "...", "=>", "==", "!=", "<=", ">=", "++", "--", "**", "<<", ">>", "&&", "||", "??", "?.", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^="
].sort((first, second) => second.length - first.length);

const regexPrefixKeywords = new Set([
  "await", "case", "delete", "do", "else", "in", "instanceof", "new", "return", "throw", "typeof", "void", "yield"
]);
const regexControlHeadKeywords = new Set(["catch", "for", "if", "switch", "while", "with"]);
const blockPrefixKeywords = new Set(["do", "else", "finally", "try"]);
const jsIdentifierStart = /^[$_\p{ID_Start}]$/u;
const jsIdentifierContinue = /^[$_\u200c\u200d\p{ID_Continue}]$/u;

function readJsEscape(source, index, errors) {
  const escaped = source[index + 1];
  if (escaped === undefined) {
    errors.push(`unterminated escape at offset ${index}`);
    return { value: "", end: source.length };
  }
  if (escaped === "\n") return { value: "", end: index + 2 };
  if (escaped === "\r") return { value: "", end: index + (source[index + 2] === "\n" ? 3 : 2) };
  const simpleEscapes = new Map([
    ["b", "\b"], ["f", "\f"], ["n", "\n"], ["r", "\r"], ["t", "\t"], ["v", "\v"], ["0", "\0"]
  ]);
  if (simpleEscapes.has(escaped)) return { value: simpleEscapes.get(escaped), end: index + 2 };
  if (escaped === "x") {
    const digits = source.slice(index + 2, index + 4);
    if (!/^[0-9a-f]{2}$/i.test(digits)) errors.push(`invalid hexadecimal escape at offset ${index}`);
    return { value: /^[0-9a-f]{2}$/i.test(digits) ? String.fromCodePoint(Number.parseInt(digits, 16)) : "", end: Math.min(source.length, index + 4) };
  }
  if (escaped === "u") {
    if (source[index + 2] === "{") {
      const closing = source.indexOf("}", index + 3);
      const digits = closing === -1 ? "" : source.slice(index + 3, closing);
      const codePoint = /^[0-9a-f]{1,6}$/i.test(digits) ? Number.parseInt(digits, 16) : -1;
      if (closing === -1 || codePoint < 0 || codePoint > 0x10FFFF) errors.push(`invalid Unicode escape at offset ${index}`);
      return { value: codePoint >= 0 && codePoint <= 0x10FFFF ? String.fromCodePoint(codePoint) : "", end: closing === -1 ? source.length : closing + 1 };
    }
    const digits = source.slice(index + 2, index + 6);
    if (!/^[0-9a-f]{4}$/i.test(digits)) errors.push(`invalid Unicode escape at offset ${index}`);
    return { value: /^[0-9a-f]{4}$/i.test(digits) ? String.fromCodePoint(Number.parseInt(digits, 16)) : "", end: Math.min(source.length, index + 6) };
  }
  return { value: escaped, end: index + 2 };
}

function sourceCodePoint(source, index) {
  const value = String.fromCodePoint(source.codePointAt(index));
  return { value, end: index + value.length };
}

function readJsIdentifier(source, start, errors) {
  let index = start;
  let value = "";
  let first = true;
  while (index < source.length) {
    let part;
    if (source[index] === "\\") {
      if (source[index + 1] !== "u") {
        errors.push(`invalid IdentifierName escape at offset ${index}`);
        return { value, end: Math.min(source.length, index + 2) };
      }
      const errorCount = errors.length;
      part = readJsEscape(source, index, errors);
      if (errors.length > errorCount || part.value.length === 0) return { value, end: part.end };
    } else {
      part = sourceCodePoint(source, index);
    }
    const valid = (first ? jsIdentifierStart : jsIdentifierContinue).test(part.value);
    if (!valid) {
      if (source[index] === "\\") errors.push(`invalid escaped IdentifierName character at offset ${index}`);
      break;
    }
    value += part.value;
    index = part.end;
    first = false;
  }
  return { value, end: index };
}

function tokenizeJavascriptForHtmlSinks(source) {
  const tokens = [];
  const errors = [];

  const push = (type, value, metadata = {}) => {
    const token = { type, value, ...metadata };
    tokens.push(token);
    return token;
  };

  const readQuotedString = (start) => {
    const quote = source[start];
    let value = "";
    let index = start + 1;
    while (index < source.length) {
      const character = source[index];
      if (character === quote) return { token: { type: "string", value }, end: index + 1 };
      if (character === "\n" || character === "\r") {
        errors.push(`unterminated string at offset ${start}`);
        return { token: { type: "string", value }, end: index };
      }
      if (character === "\\") {
        const escape = readJsEscape(source, index, errors);
        value += escape.value;
        index = escape.end;
        continue;
      }
      value += character;
      index += 1;
    }
    errors.push(`unterminated string at offset ${start}`);
    return { token: { type: "string", value }, end: source.length };
  };

  const canStartRegex = (previous) => {
    if (!previous) return true;
    if (previous.afterControlHead || previous.closesBlock) return true;
    if (previous.type === "identifier") return regexPrefixKeywords.has(previous.value);
    if (["number", "regex", "string", "template"].includes(previous.type)) return false;
    return ![")", "]", "}", "++", "--"].includes(previous.value);
  };

  const constructIsDeclaration = (index) => {
    const before = tokens[index - 1];
    const construct = tokens[index];
    return !before
      || before.value === ";"
      || before.value === "{"
      || before.closesBlock
      || (construct?.lineBreakBefore && tokenCanEndExpression(before));
  };

  const braceKind = (previous) => {
    if (previous?.value === "=>" || previous?.closesFunction === "expression") return "expression";
    if (previous?.closesFunction === "declaration") return "block";
    if (!previous || previous.afterControlHead || previous.closesBlock || blockPrefixKeywords.has(previous.value)) return "block";
    if ([";", "{", ")"].includes(previous.value)) return "block";
    return "expression";
  };

  const readRegex = (start) => {
    let index = start + 1;
    let escaped = false;
    let characterClass = false;
    while (index < source.length) {
      const character = source[index];
      if (character === "\n" || character === "\r") break;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "[") characterClass = true;
      else if (character === "]") characterClass = false;
      else if (character === "/" && !characterClass) {
        index += 1;
        while (/[a-z]/i.test(source[index] ?? "")) index += 1;
        return index;
      }
      index += 1;
    }
    errors.push(`unterminated regular expression at offset ${start}`);
    return index;
  };

  let scanCode;
  const scanTemplate = (start) => {
    let index = start + 1;
    let value = "";
    let dynamic = false;
    while (index < source.length) {
      const character = source[index];
      if (character === "`") {
        push(dynamic ? "template" : "string", dynamic ? "" : value);
        return index + 1;
      }
      if (character === "\\") {
        const escape = readJsEscape(source, index, errors);
        value += escape.value;
        index = escape.end;
        continue;
      }
      if (character === "$" && source[index + 1] === "{") {
        dynamic = true;
        const expression = scanCode(index + 2, true);
        if (!expression.closed) errors.push(`unterminated template expression at offset ${index}`);
        index = expression.index;
        continue;
      }
      value += character;
      index += 1;
    }
    errors.push(`unterminated template at offset ${start}`);
    push("template", "");
    return source.length;
  };

  scanCode = (start = 0, stopAtTemplateBrace = false) => {
    let index = start;
    let braceDepth = 0;
    let previous = null;
    const parenthesisKinds = [];
    const braceKinds = [];
    const pendingFunctions = [];
    const pendingClasses = [];
    let bracketDepth = 0;
    let lineBreakBefore = false;
    const pushCode = (type, value, metadata = {}) => {
      const token = push(type, value, { lineBreakBefore, ...metadata });
      lineBreakBefore = false;
      return token;
    };
    while (index < source.length) {
      const character = source[index];
      const next = source[index + 1];
      if (/\s/.test(character)) {
        if (/[\r\n\u2028\u2029]/.test(character)) lineBreakBefore = true;
        index += 1;
        continue;
      }
      if (character === "/" && next === "/") {
        const relativeTerminator = source.slice(index + 2).search(/[\r\n\u2028\u2029]/);
        if (relativeTerminator === -1) {
          index = source.length;
          continue;
        }
        const terminator = index + 2 + relativeTerminator;
        lineBreakBefore = true;
        index = terminator + (source[terminator] === "\r" && source[terminator + 1] === "\n" ? 2 : 1);
        continue;
      }
      if (character === "/" && next === "*") {
        const closing = source.indexOf("*/", index + 2);
        if (closing === -1) {
          errors.push(`unterminated block comment at offset ${index}`);
          return { index: source.length, closed: false };
        }
        if (/[\r\n\u2028\u2029]/.test(source.slice(index, closing + 2))) lineBreakBefore = true;
        index = closing + 2;
        continue;
      }
      if (character === "'" || character === '"') {
        const string = readQuotedString(index);
        previous = pushCode(string.token.type, string.token.value);
        index = string.end;
        continue;
      }
      if (character === "`") {
        index = scanTemplate(index);
        previous = tokens.at(-1) ?? null;
        lineBreakBefore = false;
        continue;
      }
      const codePoint = sourceCodePoint(source, index);
      if (character === "\\" || jsIdentifierStart.test(codePoint.value)) {
        const identifier = readJsIdentifier(source, index, errors);
        const before = previous;
        const tokenIndex = tokens.length;
        const hadLineBreakBefore = lineBreakBefore;
        previous = pushCode("identifier", identifier.value);
        if (identifier.value === "function" && ![".", "?."].includes(before?.value)) {
          const asyncFunction = before?.type === "identifier" && before.value === "async" && !hadLineBreakBefore;
          const constructIndex = asyncFunction ? tokenIndex - 1 : tokenIndex;
          pendingFunctions.push({
            kind: constructIsDeclaration(constructIndex) ? "declaration" : "expression",
            parenthesisDepth: parenthesisKinds.length,
            bracketDepth,
            braceDepth: braceKinds.length
          });
        } else if (identifier.value === "class" && ![".", "?."].includes(before?.value)) {
          pendingClasses.push({
            kind: constructIsDeclaration(tokenIndex) ? "declaration" : "expression",
            parenthesisDepth: parenthesisKinds.length,
            bracketDepth,
            braceDepth: braceKinds.length
          });
        }
        index = identifier.end > index ? identifier.end : codePoint.end;
        continue;
      }
      if (/\d/.test(character)) {
        const match = /^\d(?:[a-z0-9_.]*\d)?/i.exec(source.slice(index));
        previous = pushCode("number", match?.[0] ?? character);
        index += match?.[0].length ?? 1;
        continue;
      }
      if (character === "}" && stopAtTemplateBrace && braceDepth === 0) return { index: index + 1, closed: true };
      if (character === "/" && canStartRegex(previous)) {
        index = readRegex(index);
        previous = pushCode("regex", "regex");
        continue;
      }
      const punctuator = jsPunctuators.find((candidate) => source.startsWith(candidate, index)) ?? character;
      if (punctuator === "(") {
        const pendingFunction = pendingFunctions.at(-1);
        const functionKind = pendingFunction
          && pendingFunction.parenthesisDepth === parenthesisKinds.length
          && pendingFunction.bracketDepth === bracketDepth
          && pendingFunction.braceDepth === braceKinds.length
          ? `function-${pendingFunctions.pop().kind}`
          : null;
        parenthesisKinds.push(previous?.type === "identifier" && regexControlHeadKeywords.has(previous.value)
          ? "control"
          : (functionKind ?? "normal"));
        previous = pushCode("punctuator", punctuator);
      } else if (punctuator === ")") {
        const kind = parenthesisKinds.pop();
        previous = pushCode("punctuator", punctuator, {
          afterControlHead: kind === "control",
          closesFunction: kind === "function-expression" ? "expression" : (kind === "function-declaration" ? "declaration" : null)
        });
      } else if (punctuator === "{") {
        const pendingClass = pendingClasses.at(-1);
        const classKind = pendingClass
          && pendingClass.parenthesisDepth === parenthesisKinds.length
          && pendingClass.bracketDepth === bracketDepth
          && pendingClass.braceDepth === braceKinds.length
          ? (pendingClasses.pop().kind === "declaration" ? "block" : "expression")
          : null;
        braceDepth += 1;
        const kind = classKind ?? braceKind(previous);
        braceKinds.push(kind);
        previous = pushCode("punctuator", punctuator);
      } else if (punctuator === "}") {
        if (braceDepth > 0) braceDepth -= 1;
        previous = pushCode("punctuator", punctuator, { closesBlock: braceKinds.pop() === "block" });
      } else if (punctuator === "[") {
        bracketDepth += 1;
        previous = pushCode("punctuator", punctuator);
      } else if (punctuator === "]") {
        if (bracketDepth > 0) bracketDepth -= 1;
        previous = pushCode("punctuator", punctuator);
      } else {
        previous = pushCode("punctuator", punctuator);
      }
      index += punctuator.length;
    }
    return { index, closed: !stopAtTemplateBrace };
  };

  scanCode();
  return { tokens, errors };
}

function htmlSinkAccessAt(tokens, index) {
  const token = tokens[index];
  if (!token) return null;
  if ((token.value === "." || token.value === "?.") && tokens[index + 1]?.type === "identifier") {
    return { property: tokens[index + 1].value, end: index + 1 };
  }
  const bracketStart = token.value === "[" ? index : ((token.value === "?." && tokens[index + 1]?.value === "[") ? index + 1 : -1);
  if (bracketStart !== -1 && tokens[bracketStart + 1]?.type === "string" && tokens[bracketStart + 2]?.value === "]") {
    return { property: tokens[bracketStart + 1].value, end: bracketStart + 2 };
  }
  return null;
}

function tokenCanEndExpression(token) {
  if (!token || token.afterControlHead || token.closesBlock) return false;
  if (["identifier", "number", "regex", "string", "template"].includes(token.type)) return true;
  if ([")", "]", "++", "--"].includes(token.value)) return true;
  return token.value === "}";
}

function tokenIsPrefixUpdate(tokens, index) {
  const token = tokens[index];
  return token.lineBreakBefore || !tokenCanEndExpression(tokens[index - 1]);
}

function htmlSinkHasPrefixUpdate(tokens, accessIndex) {
  let sawReceiver = false;
  let parentheses = 0;
  let brackets = 0;
  for (let index = accessIndex - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    if (token.value === ")") {
      parentheses += 1;
      sawReceiver = true;
      continue;
    }
    if (token.value === "]") {
      brackets += 1;
      sawReceiver = true;
      continue;
    }
    if (parentheses > 0) {
      if (token.value === "(") parentheses -= 1;
      continue;
    }
    if (brackets > 0) {
      if (token.value === "[") brackets -= 1;
      continue;
    }
    if (token.value === "++" || token.value === "--") return sawReceiver && tokenIsPrefixUpdate(tokens, index);
    if (["identifier", "number", "string"].includes(token.type)) {
      sawReceiver = true;
      continue;
    }
    if ([".", "?.", "[", "]"].includes(token.value)) continue;
    return false;
  }
  return false;
}

function inspectJavascriptHtmlSinks(source) {
  const lexical = tokenizeJavascriptForHtmlSinks(source);
  for (let index = 0; index < lexical.tokens.length; index += 1) {
    const access = htmlSinkAccessAt(lexical.tokens, index);
    if (!access) continue;
    const after = lexical.tokens[access.end + 1];
    if ((access.property === "innerHTML" || access.property === "outerHTML")
      && (htmlSinkAssignments.has(after?.value) || htmlSinkHasPrefixUpdate(lexical.tokens, index))) {
      return { unsafe: true, errors: lexical.errors };
    }
    if (access.property === "insertAdjacentHTML"
      && (after?.value === "(" || (after?.value === "?." && lexical.tokens[access.end + 2]?.value === "("))) {
      return { unsafe: true, errors: lexical.errors };
    }
  }
  return { unsafe: false, errors: lexical.errors };
}

function namedFunctionBody(source, functionName) {
  const declaration = new RegExp(`\\bfunction\\s+${escapeRegExp(functionName)}\\s*\\([^)]*\\)\\s*\\{`).exec(source);
  if (!declaration) return null;
  const openingBrace = source.indexOf("{", declaration.index);
  const closingBrace = matchingBrace(source, openingBrace);
  if (closingBrace === -1) return null;
  return {
    body: source.slice(openingBrace + 1, closingBrace),
    start: declaration.index,
    end: closingBrace + 1
  };
}

async function read(context, relativePath) {
  try {
    return await readFile(resolve(context.root, relativePath), "utf8");
  } catch (cause) {
    error(context.errors, "file-read", relativePath, cause.code ?? cause.message);
    return null;
  }
}

export async function readFacts({ root = defaultRoot, onError = () => {} } = {}) {
  try {
    const parsed = JSON.parse(await readFile(resolve(root, "content/site-facts.json"), "utf8"));
    return isPlainObject(parsed) ? parsed : { version: 0, facts: [], blocked_claims: [] };
  } catch (cause) {
    onError("facts-json", "content/site-facts.json", cause.code ?? cause.message);
    return { version: 0, facts: [], blocked_claims: [] };
  }
}

function verifyAliases(fact, index, errors) {
  if (!Object.hasOwn(fact, "aliases")) return;
  const path = "content/site-facts.json";
  if (!isPlainObject(fact.aliases)) {
    error(errors, "fact-aliases", path, `facts[${index}] aliases must be an object`);
    return;
  }
  for (const language of ["pl", "en"]) {
    if (!Array.isArray(fact.aliases[language]) || !fact.aliases[language].every(nonEmptyString)) {
      error(errors, "fact-aliases", path, `facts[${index}] aliases.${language} must be an array of non-empty strings`);
    }
  }
}

function verifyStringArray(value, id, path, message, errors) {
  const valid = Array.isArray(value) && value.length > 0 && value.every(nonEmptyString);
  if (!valid) error(errors, id, path, message);
  return valid;
}

function verifyPublicSurfaceInventory(factData, errors) {
  const path = "content/site-facts.json";
  const surfaces = factData.public_claim_surfaces;
  const valid = Array.isArray(surfaces)
    && surfaces.length >= requiredPublicClaimSurfaces.length
    && surfaces.every(nonEmptyString)
    && new Set(surfaces).size === surfaces.length
    && requiredPublicClaimSurfaces.every((surface) => surfaces.includes(surface));
  if (!valid) {
    error(errors, "public-surface-inventory", path, `public_claim_surfaces must uniquely include ${requiredPublicClaimSurfaces.join(", ")}`);
    return requiredPublicClaimSurfaces;
  }
  return surfaces;
}

function verifySurfaceRules(fact, index, publicSurfaces, errors) {
  const path = "content/site-facts.json";
  if (Object.hasOwn(fact, "forbidden_variants")) {
    verifyStringArray(fact.forbidden_variants, "fact-forbidden-variants", path, `facts[${index}] forbidden_variants must be a non-empty string array`, errors);
  }
  if (!Object.hasOwn(fact, "surface_rules")) return;
  if (!isPlainObject(fact.surface_rules) || Object.keys(fact.surface_rules).length === 0) {
    error(errors, "fact-surface-rules", path, `facts[${index}] surface_rules must be a non-empty object`);
    return;
  }
  for (const [surface, rule] of Object.entries(fact.surface_rules)) {
    if (!publicSurfaces.includes(surface) || !Array.isArray(fact.surfaces) || !fact.surfaces.includes(surface)) {
      error(errors, "fact-surface-rules", path, `facts[${index}] surface rule ${surface} must name a declared public fact surface`);
    }
    if (!isPlainObject(rule)) {
      error(errors, "fact-surface-rules", path, `facts[${index}] surface rule ${surface} must be an object`);
      continue;
    }
    const keys = Object.keys(rule);
    if (keys.some((key) => !["approved_any", "forbidden", "match_mode", "controlled_any"].includes(key))) {
      error(errors, "fact-surface-rules", path, `facts[${index}] surface rule ${surface} contains an unsupported key`);
    }
    if (fact.status === "approved") {
      verifyStringArray(rule.approved_any, "fact-surface-rules", path, `facts[${index}] approved surface rule ${surface} requires approved_any`, errors);
    } else if (Object.hasOwn(rule, "approved_any")) {
      error(errors, "fact-surface-rules", path, `facts[${index}] non-approved surface rule ${surface} cannot declare approved_any`);
    }
    if (Object.hasOwn(rule, "forbidden")) {
      verifyStringArray(rule.forbidden, "fact-surface-rules", path, `facts[${index}] surface rule ${surface} forbidden must be a non-empty string array`, errors);
    }
    if (Object.hasOwn(rule, "match_mode") && rule.match_mode !== "line") {
      error(errors, "fact-surface-rules", path, `facts[${index}] surface rule ${surface} match_mode must be line`);
    }
    if (rule.match_mode === "line") {
      verifyStringArray(rule.controlled_any, "fact-surface-rules", path, `facts[${index}] line rule ${surface} requires controlled_any`, errors);
      if (surface.endsWith(".html")) error(errors, "fact-surface-rules", path, `facts[${index}] line rule ${surface} is not supported for HTML surfaces`);
    } else if (Object.hasOwn(rule, "controlled_any")) {
      error(errors, "fact-surface-rules", path, `facts[${index}] surface rule ${surface} controlled_any requires match_mode line`);
    }
  }
}

function verifyPinnedFactContract(fact, errors) {
  const path = "content/site-facts.json";
  if (fact.id === "portfolio.akrobacja_com.current_status") {
    const valid = fact.kind === "dated"
      && fact.as_of === "2026-08-26"
      && fact.source_type === "owner_verified"
      && fact.status === "approved"
      && fact.source_label?.includes("2026-08-26");
    if (!valid) error(errors, "fact-current-contract", path, "akrobacja.com current status requires approved dated owner evidence from 2026-08-26");
  }
  if (fact.id === "aviation.warsaw_flight_safety") {
    const valid = fact.source_type === "owner_verified"
      && fact.status === "retired"
      && fact.source_label?.includes("Owner correction, 2026-08-26");
    if (!valid) error(errors, "fact-current-contract", path, "WarsawFlightSafety wording must remain retired under the 2026-08-26 owner correction");
  }
}

function verifyFactSchema(factData, publicSurfaces, errors) {
  const path = "content/site-facts.json";
  if (factData.version !== 1) error(errors, "facts-version", path, "expected version 1");
  if (!Array.isArray(factData.facts)) {
    error(errors, "facts-array", path, "facts must be an array");
    return new Set();
  }

  const ids = new Set();
  for (const [index, fact] of factData.facts.entries()) {
    if (!isPlainObject(fact)) {
      error(errors, "fact-record", path, `facts[${index}] must be an object`);
      continue;
    }
    for (const key of factKeys) {
      if (!Object.hasOwn(fact, key)) error(errors, "fact-key", path, `facts[${index}] missing ${key}`);
    }
    if (!nonEmptyString(fact.id)) error(errors, "fact-id", path, `facts[${index}] id must be a non-empty string`);
    else if (ids.has(fact.id)) error(errors, "fact-duplicate-id", path, `duplicate fact id ${fact.id}`);
    else ids.add(fact.id);
    if (!validFactValue(fact.value)) error(errors, "fact-value", path, `facts[${index}] value must be a non-empty string or finite number`);
    if (!nonEmptyString(fact.display_pl)) error(errors, "fact-display-pl", path, `facts[${index}] display_pl must be a non-empty string`);
    if (!nonEmptyString(fact.display_en)) error(errors, "fact-display-en", path, `facts[${index}] display_en must be a non-empty string`);
    if (!kinds.has(fact.kind)) error(errors, "fact-kind", path, `facts[${index}] kind must be constant or dated`);
    if (fact.kind === "constant" && fact.as_of !== null) error(errors, "fact-as-of", path, `facts[${index}] constant facts require as_of null`);
    if (fact.kind === "dated" && (!nonEmptyString(fact.as_of) || !isIsoDate(fact.as_of))) error(errors, "fact-as-of", path, `facts[${index}] dated facts require YYYY-MM-DD as_of`);
    if (fact.kind !== "constant" && fact.kind !== "dated" && fact.as_of !== null && (!nonEmptyString(fact.as_of) || !isIsoDate(fact.as_of))) error(errors, "fact-as-of", path, `facts[${index}] as_of must be null or YYYY-MM-DD`);
    if (!sourceTypes.has(fact.source_type)) error(errors, "fact-source-type", path, `facts[${index}] source_type is invalid`);
    if (!nonEmptyString(fact.source_label)) error(errors, "fact-source-label", path, `facts[${index}] source_label must be a non-empty string`);
    if (fact.source_url !== null && (!nonEmptyString(fact.source_url) || !isHttpUrl(fact.source_url))) error(errors, "fact-source-url", path, `facts[${index}] source_url must be null or an http(s) URL`);
    if (!Array.isArray(fact.surfaces) || fact.surfaces.length === 0 || !fact.surfaces.every(nonEmptyString)) error(errors, "fact-surfaces", path, `facts[${index}] surfaces must be a non-empty string array`);
    else if (fact.surfaces.some((surface) => !publicSurfaces.includes(surface))) error(errors, "fact-surfaces", path, `facts[${index}] surfaces must be declared in public_claim_surfaces`);
    if (!statuses.has(fact.status)) error(errors, "fact-status", path, `facts[${index}] status is invalid`);
    verifyAliases(fact, index, errors);
    verifySurfaceRules(fact, index, publicSurfaces, errors);
    verifyPinnedFactContract(fact, errors);
  }
  return ids;
}

function verifyBlockedSchema(factData, factIds, errors) {
  const path = "content/site-facts.json";
  if (!Array.isArray(factData.blocked_claims)) {
    error(errors, "blocked-claims-array", path, "blocked_claims must be an array");
    return;
  }
  const ids = new Set();
  const patterns = new Set();
  let canonical = null;
  for (const [index, claim] of factData.blocked_claims.entries()) {
    if (!isPlainObject(claim)) {
      error(errors, "blocked-record", path, `blocked_claims[${index}] must be an object`);
      continue;
    }
    for (const key of blockedKeys) {
      if (!Object.hasOwn(claim, key)) error(errors, "blocked-key", path, `blocked_claims[${index}] missing ${key}`);
    }
    if (!nonEmptyString(claim.id)) error(errors, "blocked-id", path, `blocked_claims[${index}] id must be a non-empty string`);
    else {
      if (ids.has(claim.id)) error(errors, "blocked-duplicate-id", path, `duplicate blocked id ${claim.id}`);
      if (factIds.has(claim.id)) error(errors, "blocked-id-collision", path, `blocked id collides with fact id ${claim.id}`);
      ids.add(claim.id);
    }
    if (!nonEmptyString(claim.pattern)) error(errors, "blocked-pattern", path, `blocked_claims[${index}] pattern must be a non-empty string`);
    else {
      const pattern = normalize(claim.pattern);
      if (patterns.has(pattern)) error(errors, "blocked-duplicate-pattern", path, `duplicate blocked pattern ${claim.pattern}`);
      patterns.add(pattern);
    }
    if (!Array.isArray(claim.forbidden_contexts) || claim.forbidden_contexts.length === 0 || !claim.forbidden_contexts.every(nonEmptyString)) error(errors, "blocked-contexts", path, `blocked_claims[${index}] forbidden_contexts must be a non-empty string array`);
    if (!nonEmptyString(claim.reason)) error(errors, "blocked-reason", path, `blocked_claims[${index}] reason must be a non-empty string`);
    if (claim.id === "client.polpharma") canonical = claim;
  }
  const requiredContexts = ["trust", "clients", "client list", "worked for"];
  if (!canonical || canonical.pattern !== "Polpharma" || !Array.isArray(canonical.forbidden_contexts) || requiredContexts.some((item) => !canonical.forbidden_contexts.includes(item)) || !nonEmptyString(canonical.reason)) {
    error(errors, "blocked-canonical-polpharma", path, "requires canonical client.polpharma record with Polpharma pattern and client contexts");
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeClaimLine(line) {
  return normalize(line).replace(/^(?:(?:>\s*)+|[-*+]\s+)/, "").trim();
}

function publicSurfaceSearchData(surface, text, errors) {
  if (surface.endsWith(".html")) {
    const parsed = parseStaticHtml(text);
    return { texts: [normalize(stripHtmlComments(text)), staticVisibleText(parsed.root)], lineUnits: [] };
  }
  if (surface.endsWith(".js")) {
    const lexical = tokenizeJavascriptForHtmlSinks(text);
    for (const message of lexical.errors) error(errors, "fact-surface-js-lexical", surface, message);
    const literalValues = lexical.tokens
      .filter((token) => token.type === "string" && nonEmptyString(token.value))
      .map((token) => token.value);
    return {
      texts: [normalize(stripJsComments(text)), ...literalValues.map(normalize)],
      lineUnits: literalValues.flatMap((value) => value.split(/\r\n?|\n|\u2028|\u2029/)).map(normalizeClaimLine).filter(nonEmptyString)
    };
  }
  return {
    texts: [normalize(text)],
    lineUnits: text.split(/\r\n?|\n|\u2028|\u2029/).map(normalizeClaimLine).filter(nonEmptyString)
  };
}

function surfaceContains(searchTexts, candidate) {
  const normalized = normalize(candidate);
  return normalized.length > 0 && searchTexts.some((text) => text.includes(normalized));
}

function factStatusCandidates(fact, surface) {
  const aliases = isPlainObject(fact.aliases)
    ? [fact.aliases.pl, fact.aliases.en].flatMap((items) => Array.isArray(items) ? items : [])
    : [];
  const forbidden = Array.isArray(fact.forbidden_variants) ? fact.forbidden_variants : [];
  const surfaceForbidden = Array.isArray(fact.surface_rules?.[surface]?.forbidden) ? fact.surface_rules[surface].forbidden : [];
  return [...new Set([fact.value, fact.display_pl, fact.display_en, ...aliases, ...forbidden, ...surfaceForbidden].filter(nonEmptyString))];
}

async function verifyPublicFactSurfaces(factData, publicSurfaces, context) {
  const records = Array.isArray(factData.facts) ? factData.facts.filter(isPlainObject) : [];
  for (const surface of publicSurfaces) {
    const text = await read(context, surface);
    if (text === null) continue;
    const searchData = publicSurfaceSearchData(surface, text, context.errors);
    for (const fact of records) {
      if (fact.status === "review" || fact.status === "retired") {
        const published = factStatusCandidates(fact, surface).find((candidate) => surfaceContains(searchData.texts, candidate));
        if (published) error(context.errors, "fact-surface-status", surface, `${fact.id} has status ${fact.status} but publishes ${published}`);
        continue;
      }
      if (fact.status !== "approved") continue;
      if (!Array.isArray(fact.surfaces) || !fact.surfaces.includes(surface)) continue;
      const rule = isPlainObject(fact.surface_rules?.[surface]) ? fact.surface_rules[surface] : null;
      if (!rule) continue;
      const approvedUnits = Array.isArray(rule.approved_any) ? rule.approved_any.map(normalizeClaimLine) : [];
      const controlledTerms = Array.isArray(rule.controlled_any) ? rule.controlled_any.map(normalize) : [];
      const controlledUnits = rule.match_mode === "line"
        ? searchData.lineUnits.filter((unit) => controlledTerms.some((term) => unit.includes(term)))
        : [];
      const approved = rule.match_mode === "line"
        ? controlledUnits.some((unit) => approvedUnits.includes(unit))
        : Array.isArray(rule.approved_any) && rule.approved_any.some((candidate) => surfaceContains(searchData.texts, candidate));
      if (!approved) error(context.errors, "fact-surface-approved", surface, `${fact.id} is missing an exact approved surface claim`);
      const unapprovedUnit = rule.match_mode === "line" ? controlledUnits.find((unit) => !approvedUnits.includes(unit)) : null;
      if (unapprovedUnit) error(context.errors, "fact-surface-unapproved-unit", surface, `${fact.id} publishes an unapproved controlled line: ${unapprovedUnit}`);
      const forbidden = Array.isArray(rule.forbidden) ? rule.forbidden.find((candidate) => surfaceContains(searchData.texts, candidate)) : null;
      if (forbidden) error(context.errors, "fact-surface-forbidden", surface, `${fact.id} publishes forbidden semantic variant ${forbidden}`);
    }
  }
}

async function verifyBlockedSurfaces(factData, publicSurfaces, context) {
  const claims = Array.isArray(factData.blocked_claims) ? factData.blocked_claims.filter((claim) => isPlainObject(claim) && nonEmptyString(claim.id) && nonEmptyString(claim.pattern)) : [];
  for (const surface of publicSurfaces) {
    const text = await read(context, surface);
    if (text === null) continue;
    for (const claim of claims) {
      if (new RegExp(escapeRegExp(claim.pattern), "i").test(text)) {
        const contexts = Array.isArray(claim.forbidden_contexts) ? claim.forbidden_contexts.filter(nonEmptyString).join(", ") : "invalid contexts";
        error(context.errors, `blocked-${claim.id}`, surface, `blocked pattern ${claim.pattern} appears on a public claim surface (declared contexts: ${contexts})`);
      }
    }
  }
}

function stripCssComments(css) {
  let stripped = "";
  let quote = null;
  let escaped = false;
  let inComment = false;
  let commentStart = -1;
  for (let index = 0; index < css.length; index += 1) {
    const character = css[index];
    if (inComment) {
      if (character === "*" && css[index + 1] === "/") {
        inComment = false;
        commentStart = -1;
        index += 1;
      }
      continue;
    }
    if (quote !== null) {
      stripped += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      stripped += character;
      continue;
    }
    if (character === "\\" && css[index + 1] !== undefined) {
      stripped += character + css[index + 1];
      index += 1;
      continue;
    }
    if (character === "/" && css[index + 1] === "*") {
      stripped += " ";
      inComment = true;
      commentStart = index;
      index += 1;
      continue;
    }
    stripped += character;
  }
  return { css: stripped, unterminatedCommentAt: commentStart };
}

function matchingBrace(source, openingIndex) {
  let depth = 0;
  let parentheses = 0;
  let brackets = 0;
  let quote = null;
  let escaped = false;
  for (let index = openingIndex; index < source.length; index += 1) {
    const character = source[index];
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "(") parentheses += 1;
    else if (character === ")" && parentheses > 0) parentheses -= 1;
    else if (character === "[") brackets += 1;
    else if (character === "]" && brackets > 0) brackets -= 1;
    if (parentheses > 0 || brackets > 0) continue;
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function cssDelimiterIndex(source, delimiter) {
  let quote = null;
  let escaped = false;
  let parentheses = 0;
  let brackets = 0;
  let braces = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "(") parentheses += 1;
    else if (character === ")" && parentheses > 0) parentheses -= 1;
    else if (character === "[") brackets += 1;
    else if (character === "]" && brackets > 0) brackets -= 1;
    else if (character === "{") braces += 1;
    else if (character === "}" && braces > 0) braces -= 1;
    else if (character === delimiter && parentheses === 0 && brackets === 0 && braces === 0) return index;
  }
  return -1;
}

function splitCssTopLevel(source, delimiterCharacter) {
  const parts = [];
  let remainder = source;
  while (remainder.length > 0) {
    const delimiter = cssDelimiterIndex(remainder, delimiterCharacter);
    if (delimiter === -1) {
      parts.push(remainder);
      break;
    }
    parts.push(remainder.slice(0, delimiter));
    remainder = remainder.slice(delimiter + 1);
  }
  return parts;
}

function parseDeclarations(body) {
  const declarations = new Map();
  for (const candidate of splitCssTopLevel(body, ";")) {
    const colon = cssDelimiterIndex(candidate, ":");
    if (colon === -1) continue;
    const property = candidate.slice(0, colon).trim().toLowerCase();
    const value = candidate.slice(colon + 1).trim().replace(/\s+/g, " ");
    if (property) declarations.set(property, value);
  }
  return declarations;
}

function decodeCssEscapes(source) {
  let decoded = "";
  let quote = null;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote !== null) {
      decoded += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      decoded += character;
      continue;
    }
    if (character !== "\\") {
      decoded += character;
      continue;
    }
    const hexadecimal = /^([0-9a-f]{1,6})(?:\r\n|[\t\n\f\r ])?/i.exec(source.slice(index + 1));
    if (hexadecimal !== null) {
      const codePoint = Number.parseInt(hexadecimal[1], 16);
      decoded += codePoint === 0 || codePoint > 0x10FFFF ? "�" : String.fromCodePoint(codePoint);
      index += hexadecimal[0].length;
      continue;
    }
    const escapedCharacter = source[index + 1];
    if (escapedCharacter !== undefined && !/[\r\n\f]/.test(escapedCharacter)) {
      decoded += escapedCharacter;
      index += 1;
    }
  }
  return decoded;
}

function textOutsideCssStrings(source) {
  let outside = "";
  let quote = null;
  let escaped = false;
  for (const character of source) {
    if (quote !== null) {
      outside += " ";
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      outside += " ";
    } else {
      outside += character;
    }
  }
  return outside;
}

export function parseCssRules(source, media = [], rules = []) {
  let cursor = 0;
  while (cursor < source.length) {
    const opening = source.indexOf("{", cursor);
    if (opening === -1) break;
    const prelude = source.slice(cursor, opening).trim();
    const closing = matchingBrace(source, opening);
    if (closing === -1) break;
    const body = source.slice(opening + 1, closing);
    const normalizedPrelude = prelude.replace(/\s+/g, " ");
    const atRule = /^@([a-z-]+)/i.exec(normalizedPrelude);
    if (atRule?.[1].toLowerCase() === "media") {
      const mediaPrelude = `@media${normalizedPrelude.slice(atRule[0].length)}`;
      parseCssRules(body, [...media, mediaPrelude], rules);
    } else {
      const selectors = prelude.startsWith("@") ? [] : splitCssTopLevel(prelude, ",").map((selector) => selector.trim().replace(/\s+/g, " ")).filter(Boolean);
      rules.push({ prelude: normalizedPrelude, selectors, declarations: parseDeclarations(body), media });
    }
    cursor = closing + 1;
  }
  return rules;
}

function cssEscapeAtomEnd(source, openingIndex) {
  let cursor = openingIndex + 1;
  if (cursor >= source.length) return cursor;

  if (/[0-9a-f]/i.test(source[cursor])) {
    let hexadecimalDigits = 0;
    while (cursor < source.length && hexadecimalDigits < 6 && /[0-9a-f]/i.test(source[cursor])) {
      cursor += 1;
      hexadecimalDigits += 1;
    }
    if (source[cursor] === "\r" && source[cursor + 1] === "\n") return cursor + 2;
    if (/[\t\n\f\r ]/.test(source[cursor] ?? "")) return cursor + 1;
    return cursor;
  }

  if (source[cursor] === "\r" && source[cursor + 1] === "\n") return cursor + 2;
  const escapedCodePoint = source.codePointAt(cursor);
  return cursor + (escapedCodePoint !== undefined && escapedCodePoint > 0xFFFF ? 2 : 1);
}

function rightmostSelectorCompound(selector) {
  let start = 0;
  let quote = null;
  let escaped = false;
  let brackets = 0;
  let parentheses = 0;
  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index];
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "\\") {
      index = cssEscapeAtomEnd(selector, index) - 1;
      continue;
    }
    if (character === "[") {
      brackets += 1;
      continue;
    }
    if (character === "]" && brackets > 0) {
      brackets -= 1;
      continue;
    }
    if (brackets > 0) continue;
    if (character === "(") {
      parentheses += 1;
      continue;
    }
    if (character === ")" && parentheses > 0) {
      parentheses -= 1;
      continue;
    }
    if (parentheses > 0) continue;
    if (/\s/.test(character) || character === ">" || character === "+" || character === "~") start = index + 1;
    else if (character === "|" && selector[index + 1] === "|") {
      start = index + 2;
      index += 1;
    }
  }
  return selector.slice(start).trim();
}

function selectorSubjectIsPseudoElement(compound) {
  let quote = null;
  let escaped = false;
  let brackets = 0;
  let parentheses = 0;
  for (let index = 0; index < compound.length; index += 1) {
    const character = compound[index];
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "[") brackets += 1;
    else if (character === "]" && brackets > 0) brackets -= 1;
    else if (brackets === 0 && character === "(") parentheses += 1;
    else if (brackets === 0 && character === ")" && parentheses > 0) parentheses -= 1;
    else if (brackets === 0 && parentheses === 0 && character === ":") {
      if (compound[index + 1] === ":") return true;
      const legacyPseudoElement = /^:([a-z-]+)/i.exec(compound.slice(index));
      if (["before", "after", "first-letter", "first-line"].includes(legacyPseudoElement?.[1].toLowerCase())) return true;
    }
  }
  return false;
}

function matchingParenthesis(source, openingIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  let brackets = 0;
  for (let index = openingIndex; index < source.length; index += 1) {
    const character = source[index];
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "[") brackets += 1;
    else if (character === "]" && brackets > 0) brackets -= 1;
    else if (brackets === 0 && character === "(") depth += 1;
    else if (brackets === 0 && character === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function functionalSelectorTargetsHtmlBody(compound) {
  let quote = null;
  let escaped = false;
  let brackets = 0;
  for (let index = 0; index < compound.length; index += 1) {
    const character = compound[index];
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "[") {
      brackets += 1;
      continue;
    }
    if (character === "]" && brackets > 0) {
      brackets -= 1;
      continue;
    }
    if (brackets > 0 || character !== ":" || compound[index + 1] === ":") continue;
    const functionalPseudo = /^:([a-z-]+)\(/i.exec(compound.slice(index));
    if (functionalPseudo === null) continue;
    const opening = index + functionalPseudo[0].length - 1;
    const closing = matchingParenthesis(compound, opening);
    if (closing === -1) return false;
    if (["is", "where"].includes(functionalPseudo[1].toLowerCase())) {
      const argumentsText = compound.slice(opening + 1, closing);
      if (splitCssTopLevel(argumentsText, ",").some((argument) => selectorTargetsHtmlBody(argument.trim()))) return true;
    }
    index = closing;
  }
  return false;
}

function selectorTargetsHtmlBody(selector) {
  const compound = decodeCssEscapes(rightmostSelectorCompound(selector));
  if (selectorSubjectIsPseudoElement(compound)) return false;
  const typeSelector = /^(?:(?:\*|[a-z_-][a-z0-9_-]*)?\|)?(\*|[a-z_-][a-z0-9_-]*)/i.exec(compound)?.[1].toLowerCase() ?? null;
  if (typeSelector === "body") return true;
  if (typeSelector !== null && typeSelector !== "*") return false;
  return functionalSelectorTargetsHtmlBody(compound);
}

function rulesForSelector(rules, selector, media = []) {
  const normalizedSelector = selector.replace(/\s+/g, " ");
  return rules.filter((rule) => rule.selectors.includes(normalizedSelector)
    && rule.media.length === media.length
    && rule.media.every((query, index) => query === media[index]));
}

function propertyValue(rules, selector, property, media = []) {
  let value;
  for (const rule of rulesForSelector(rules, selector, media)) {
    if (rule.declarations.has(property)) value = rule.declarations.get(property);
  }
  return value;
}

function hexRgb(value) {
  const match = /^#([0-9a-f]{6})$/i.exec(value ?? "");
  if (!match) return null;
  return match[1].match(/.{2}/g).map((component) => Number.parseInt(component, 16) / 255);
}

function relativeLuminance(value) {
  const rgb = hexRgb(value);
  if (rgb === null) return null;
  const linear = rgb.map((component) => component <= 0.04045 ? component / 12.92 : ((component + 0.055) / 1.055) ** 2.4);
  return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
}

function contrastRatio(first, second) {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  if (firstLuminance === null || secondLuminance === null) return 0;
  return (Math.max(firstLuminance, secondLuminance) + 0.05) / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

function verifyHomepageNavigation(html, page, errors) {
  const activeHtml = stripHtmlComments(html).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const allNavBlocks = tagBlocks(activeHtml, "nav");
  const navBlocks = allNavBlocks.filter((block) => hasClass(block.opening, "site-nav"));
  if (navBlocks.length !== 1) {
    error(errors, "nav-structure", page.path, "expected exactly one nav.site-nav");
  }
  const siteNav = navBlocks[0] ?? allNavBlocks.find((block) => !hasClass(block.opening, "breadcrumb"));
  if (!siteNav) return;
  const ids = openingTags(activeHtml, "[a-z][a-z0-9:-]*")
    .map((tag) => attributeValue(tag, "id"))
    .filter(nonEmptyString);
  for (const id of ["nav-menu", "nav-toggle", "nav-overlay"]) {
    const count = ids.filter((candidate) => candidate === id).length;
    if (count !== 1) error(errors, "nav-id", page.path, `expected id ${id} exactly once; found ${count}`);
  }

  const menu = openingTags(siteNav.full, "ul").filter((tag) => attributeValue(tag, "id") === "nav-menu" && hasClass(tag, "nav-list"));
  const toggle = openingTags(siteNav.full, "button").filter((tag) => attributeValue(tag, "id") === "nav-toggle" && hasClass(tag, "nav-toggle"));
  const overlay = openingTags(activeHtml, "div").filter((tag) => attributeValue(tag, "id") === "nav-overlay" && hasClass(tag, "nav-overlay"));
  if (menu.length !== 1 || toggle.length !== 1 || attributeValue(toggle[0] ?? "", "aria-controls") !== "nav-menu" || attributeValue(toggle[0] ?? "", "aria-expanded") !== "false" || overlay.length !== 1) {
    error(errors, "nav-structure", page.path, "navigation requires a linked nav-list, nav-toggle and nav-overlay");
  }

  const config = page.lang === "pl" ? {
    routes: ["/uslugi/transformacja-zakupow/", "/aplikacje-operacyjne/", "/lotnictwo/", "/case-studies/", "/wiedza/", "/#about", "/#contact"],
    pairedHomepage: "/en/",
    summary: "Doradztwo",
    submenu: [
      ["/uslugi/transformacja-zakupow/", "Transformacja zakupów"],
      ["/uslugi/wdrozenie-sap-ariba/", "Wdrożenie SAP Ariba"],
      ["/uslugi/doradztwo-zamowienia-publiczne/", "Zamówienia publiczne"]
    ]
  } : {
    routes: ["/en/uslugi/transformacja-zakupow/", "/en/aplikacje-operacyjne/", "/en/lotnictwo/", "/en/case-studies/", "/en/wiedza/", "/en/#about", "/en/#contact"],
    pairedHomepage: "/",
    summary: "Advisory",
    submenu: [
      ["/en/uslugi/transformacja-zakupow/", "Procurement transformation"],
      ["/en/uslugi/wdrozenie-sap-ariba/", "SAP Ariba implementation"],
      ["/en/uslugi/doradztwo-zamowienia-publiczne/", "Public procurement"]
    ]
  };

  const navLinks = tagBlocks(siteNav.full, "a").map((block) => ({
    href: attributeValue(block.opening, "href"),
    text: renderedText(block.content),
    opening: block.opening
  }));
  let previousRouteIndex = -1;
  for (const route of config.routes) {
    const routeIndexes = navLinks.flatMap((link, index) => link.href === route ? [index] : []);
    if (routeIndexes.length !== 1 || routeIndexes[0] <= previousRouteIndex) {
      error(errors, "nav-route", page.path, `missing, duplicate or out-of-order route ${route}`);
    }
    if (routeIndexes.length === 1) previousRouteIndex = routeIndexes[0];
  }

  const groups = tagBlocks(siteNav.full, "details").filter((block) => hasClass(block.opening, "nav-group"));
  const summaries = groups.length === 1 ? tagBlocks(groups[0].full, "summary") : [];
  const submenus = groups.length === 1 ? tagBlocks(groups[0].full, "ul").filter((block) => hasClass(block.opening, "nav-submenu")) : [];
  const submenuLinks = submenus.length === 1 ? tagBlocks(submenus[0].full, "a").map((block) => [attributeValue(block.opening, "href"), renderedText(block.content)]) : [];
  const validSubmenu = submenuLinks.length === config.submenu.length && config.submenu.every(([href, text], index) => submenuLinks[index]?.[0] === href && submenuLinks[index]?.[1] === normalize(text));
  if (groups.length !== 1 || summaries.length !== 1 || renderedText(summaries[0]?.content ?? "") !== normalize(config.summary) || submenus.length !== 1 || !validSubmenu) {
    error(errors, "nav-advisory", page.path, "expected one native advisory details group with the exact localized submenu");
  }

  const languageLinks = navLinks.filter((link) => hasClass(link.opening, "nav-lang"));
  if (languageLinks.length !== 1 || languageLinks[0].href !== config.pairedHomepage) {
    error(errors, "nav-language", page.path, `language link must target ${config.pairedHomepage}`);
  }

  const chatInputs = openingTags(activeHtml, "input").filter((tag) => attributeValue(tag, "id") === "chat-input");
  if (chatInputs.length !== 1 || attributeValue(chatInputs[0], "maxlength") !== "2000") {
    error(errors, "chat-maxlength", page.path, "chat input requires maxlength 2000");
  }
  const contactLinks = openingTags(activeHtml, "a").filter((tag) => attributeValue(tag, "href") === "mailto:pawel@mamcarz.com");
  if (contactLinks.length === 0) error(errors, "contact-link", page.path, "homepage requires a usable mailto link without JavaScript");
}

function verifyLegacyNavigation(html, path, errors) {
  const activeHtml = stripHtmlComments(html).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const nav = tagBlocks(activeHtml, "nav").find((block) => !hasClass(block.opening, "breadcrumb"));
  const menus = nav ? openingTags(nav.full, "ul").filter((tag) => hasClass(tag, "nav-links")) : [];
  const toggles = nav ? openingTags(nav.full, "button").filter((tag) => hasClass(tag, "nav-hamburger")) : [];
  const hasNewComponent = ["nav-menu", "nav-toggle"].some((id) => openingTags(activeHtml, "[a-z][a-z0-9:-]*")
    .some((tag) => attributeValue(tag, "id") === id));
  if (!nav || menus.length === 0 || toggles.length === 0 || hasNewComponent) {
    error(errors, "legacy-nav", path, "expected legacy nav-links and nav-hamburger without the new navigation component IDs");
  }
}

function verifyBrowserScript(js, errors) {
  const path = "assets/js/main.js";
  const activeJs = stripJsComments(js);
  for (const initializer of ["initNavigation", "initBackToTop", "initChat"]) {
    const definition = new RegExp(`\\bfunction\\s+${initializer}\\s*\\(`).test(activeJs);
    const invocation = new RegExp(`\\b${initializer}\\s*\\(\\s*\\)\\s*;`).test(activeJs);
    if (!definition || !invocation) error(errors, "js-initializer", path, `${initializer} must be declared and invoked`);
  }
  const htmlSinkInspection = inspectJavascriptHtmlSinks(js);
  if (htmlSinkInspection.unsafe || htmlSinkInspection.errors.length > 0) {
    const detail = htmlSinkInspection.errors.length > 0 ? `; lexical errors: ${htmlSinkInspection.errors.join(", ")}` : "";
    error(errors, "js-inner-html", path, `HTML injection sinks are forbidden${detail}`);
  }
  const workerUrl = "https://mamcarz-chat-api.pawel-767.workers.dev";
  if ((activeJs.match(new RegExp(escapeRegExp(workerUrl), "g")) ?? []).length !== 1) {
    error(errors, "js-chat-api", path, "expected the unchanged chat Worker URL exactly once");
  }
  if (/(?:\.reveal|\.timeline-item|js-reveal)/.test(activeJs)) {
    error(errors, "js-animation", path, "reveal and timeline animation behavior must remain removed");
  }
  const guards = [
    /if\s*\(\s*!toggle\s*\|\|\s*!menu\s*\)\s*return\s*;/,
    /if\s*\(\s*!backToTop\s*\)\s*return\s*;/,
    /if\s*\(\s*!chatMessages\s*\|\|\s*!chatInput\s*\|\|\s*!chatSendButton\s*\)\s*return\s*;/
  ];
  if (guards.some((guard) => !guard.test(activeJs))) error(errors, "js-guard", path, "component lookups require initializer-local null guards");
  const navigation = namedFunctionBody(activeJs, "initNavigation");
  const markerPattern = /document\.documentElement\.classList\.add\(\s*["']js["']\s*\)\s*;/g;
  const markerCount = [...activeJs.matchAll(markerPattern)].length;
  const navigationMarker = navigation?.body.search(new RegExp(markerPattern.source));
  const navigationGuard = navigation?.body.search(/if\s*\(\s*!toggle\s*\|\|\s*!menu\s*\)\s*return\s*;/);
  if (!navigation || markerCount !== 1 || navigationMarker === undefined || navigationMarker === -1 || navigationGuard === undefined || navigationGuard === -1 || navigationMarker <= navigationGuard) {
    error(errors, "js-navigation-marker", path, "the only js marker must be inside initNavigation after its new-component guard");
  }
  const safeMessage = /function\s+addChatMessage\s*\(\s*text\s*,\s*role\s*\)[\s\S]*?message\.textContent\s*=\s*text\s*;/.test(activeJs);
  const domMailLink = /document\.createElement\(\s*["']a["']\s*\)/.test(activeJs)
    && /\.href\s*=\s*["']mailto:pawel@mamcarz\.com["']\s*;/.test(activeJs);
  if (!safeMessage || !domMailLink) error(errors, "js-chat-dom", path, "chat messages and fallback email link require safe DOM construction");
}

async function verifyFoundation(context) {
  const [css, js, plHome, enHome, legacyService, notFound] = await Promise.all([
    read(context, "assets/css/style.css"),
    read(context, "assets/js/main.js"),
    read(context, "index.html"),
    read(context, "en/index.html"),
    read(context, "uslugi/wdrozenie-sap-ariba/index.html"),
    read(context, "404.html")
  ]);
  if (plHome !== null) verifyHomepageNavigation(plHome, { path: "index.html", lang: "pl" }, context.errors);
  if (enHome !== null) verifyHomepageNavigation(enHome, { path: "en/index.html", lang: "en" }, context.errors);
  if (legacyService !== null) verifyLegacyNavigation(legacyService, "uslugi/wdrozenie-sap-ariba/index.html", context.errors);
  if (notFound !== null) verifyLegacyNavigation(notFound, "404.html", context.errors);
  if (css !== null && css.length === 0) error(context.errors, "foundation-css", "assets/css/style.css", "stylesheet is empty");
  if (css !== null && gzipSync(Buffer.from(css, "utf8")).byteLength > 75_000) {
    error(context.errors, "budget-css-gzip", "assets/css/style.css", "compressed stylesheet exceeds 75000 bytes");
  }
  if (css !== null) {
    const commentScan = stripCssComments(css);
    const activeCss = commentScan.css;
    if (commentScan.unterminatedCommentAt !== -1) {
      error(context.errors, "css-syntax", "assets/css/style.css", `unterminated comment at offset ${commentScan.unterminatedCommentAt}`);
    }
    const rules = parseCssRules(activeCss);
    const baseRules = rules.filter((rule) => rule.media.length === 0);
    const rootRules = rulesForSelector(rules, ":root");
    if (rootRules.length !== 1) error(context.errors, "css-root", "assets/css/style.css", "expected one :root block");
    if (css.includes("OPERATIONS DOSSIER")) error(context.errors, "css-layer", "assets/css/style.css", "old override layer remains");
    if (activeCss.includes("Playfair Display")) error(context.errors, "css-playfair", "assets/css/style.css", "Playfair remains active");
    if (rules.some((rule) => rule.selectors.some((selector) => selector.startsWith(".hero-plot")))) error(context.errors, "css-dead-hero", "assets/css/style.css", "decorative plot selectors remain");

    const rootDeclarations = rootRules[0]?.declarations ?? new Map();
    const requiredTokens = new Map([
      ["--sky-paper", "#E9EDEF"],
      ["--runway-ink", "#102831"],
      ["--signal", "#D94B2B"],
      ["--panel", "#193D49"],
      ["--boundary", "#8E9CA1"],
      ["--white", "#F7F9F8"],
      ["--muted", "#52707A"]
    ]);
    for (const [property, value] of requiredTokens) {
      if (rootDeclarations.get(property) !== value) error(context.errors, "flight-token", "assets/css/style.css", `missing ${property}: ${value}`);
    }

    const expectedFontFaces = [
      ["'Barlow Semi Condensed'", "normal", "500", "url('/assets/fonts/barlow-semi-condensed-latin-500-normal.woff2') format('woff2')", "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+20AC"],
      ["'Barlow Semi Condensed'", "normal", "500", "url('/assets/fonts/barlow-semi-condensed-latin-ext-500-normal.woff2') format('woff2')", "U+0100-024F, U+1E00-1EFF, U+20A0-20AB"],
      ["'Barlow Semi Condensed'", "normal", "600", "url('/assets/fonts/barlow-semi-condensed-latin-600-normal.woff2') format('woff2')", "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+20AC"],
      ["'Barlow Semi Condensed'", "normal", "600", "url('/assets/fonts/barlow-semi-condensed-latin-ext-600-normal.woff2') format('woff2')", "U+0100-024F, U+1E00-1EFF, U+20A0-20AB"],
      ["'Barlow Semi Condensed'", "normal", "700", "url('/assets/fonts/barlow-semi-condensed-latin-700-normal.woff2') format('woff2')", "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+20AC"],
      ["'Barlow Semi Condensed'", "normal", "700", "url('/assets/fonts/barlow-semi-condensed-latin-ext-700-normal.woff2') format('woff2')", "U+0100-024F, U+1E00-1EFF, U+20A0-20AB"],
      ["'DM Sans'", "normal", "300 500", "url('/assets/fonts/dmsans-latin.woff2') format('woff2')", "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD"],
      ["'DM Sans'", "normal", "300 500", "url('/assets/fonts/dmsans-latext.woff2') format('woff2')", "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF"],
      ["'DM Mono'", "normal", "400", "url('/assets/fonts/dmmono-latin.woff2') format('woff2')", "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD"],
      ["'DM Mono'", "normal", "400", "url('/assets/fonts/dmmono-latext.woff2') format('woff2')", "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF"]
    ].map((tuple) => tuple.join("|"));
    const actualFontFaces = rules.filter((rule) => rule.prelude === "@font-face").map((rule) => [
      rule.declarations.get("font-family"),
      rule.declarations.get("font-style"),
      rule.declarations.get("font-weight"),
      rule.declarations.get("src"),
      rule.declarations.get("unicode-range")
    ].join("|"));
    if (actualFontFaces.length !== expectedFontFaces.length || expectedFontFaces.some((tuple) => !actualFontFaces.includes(tuple))) {
      error(context.errors, "display-font", "assets/css/style.css", "font-face family, style, weight, src or unicode tuple is missing or malformed");
    }

    const sectionComments = [
      "/* 01 Fonts and tokens */",
      "/* 02 Reset and document */",
      "/* 03 Layout primitives */",
      "/* 04 Navigation */",
      "/* 05 Buttons and links */",
      "/* 06 Homepage: hero through contact */",
      "/* 07 Shared subpage compatibility */",
      "/* 08 Chat and footer */",
      "/* 09 Accessibility and reduced motion */",
      "/* 10 Responsive: <=1179, <=759, <=359 */"
    ];
    let previousSection = -1;
    for (const comment of sectionComments) {
      const index = css.indexOf(comment);
      if (index === -1 || index <= previousSection) error(context.errors, "css-order", "assets/css/style.css", `missing or out-of-order ${comment}`);
      previousSection = index;
    }

    const requiredInterfaces = new Map([
      [".site-nav", ["position", "display"]], [".nav-list", ["display"]], [".nav-group", ["position"]],
      [".section-shell", ["width"]], [".section-index", ["font-family"]], [".route-sequence", ["position"]],
      [".evidence-row", ["display", "grid-template-columns"]], [".status-tag", ["display"]],
      [".btn-primary", ["display", "background"]], [".btn-ghost", ["display", "border"]], [".site-footer", ["display"]],
      [".page-hero", ["position", "margin-top"]], [".page-hero-content", ["width"]], [".page-title", ["font-size"]],
      [".page-subtitle", ["color"]], [".page-content", ["width"]], [".page-two-col", ["display"]],
      [".service-cards", ["display", "grid-template-columns"]], [".service-card", ["padding", "border-right"]],
      [".related-links", ["display", "grid-template-columns"]], [".related-link", ["display", "min-height"]],
      [".cta-banner", ["display", "background"]], [".breadcrumb", ["display", "min-height"]],
      [".diag-frame", ["border"]]
    ]);
    for (const [selector, properties] of requiredInterfaces) {
      const selectorRules = rulesForSelector(rules, selector);
      const missingProperty = properties.some((property) => propertyValue(rules, selector, property) === undefined);
      if (selectorRules.length === 0 || selectorRules.every((rule) => rule.declarations.size === 0) || missingProperty) {
        error(context.errors, "css-interface", "assets/css/style.css", `missing or incomplete ${selector}`);
      }
    }

    const decodedRules = parseCssRules(decodeCssEscapes(activeCss));
    const bannedConstructs = new Set();
    for (const rule of decodedRules) {
      for (const [property, rawValue] of rule.declarations) {
        const value = textOutsideCssStrings(rawValue).replace(/\s*!\s*important\s*$/i, "").trim().toLowerCase();
        if (/(?:^|[^a-z-])linear-gradient\s*\(/.test(value)) bannedConstructs.add("linear-gradient");
        if (/(?:^|[^a-z-])radial-gradient\s*\(/.test(value)) bannedConstructs.add("radial-gradient");
        if (property === "backdrop-filter" || property.endsWith("-backdrop-filter")) bannedConstructs.add("backdrop-filter");
        if (property === "box-shadow") bannedConstructs.add("box-shadow");
        if (property === "font-style" && value === "italic") bannedConstructs.add("font-style: italic");
      }
    }
    for (const literal of bannedConstructs) {
      error(context.errors, "css-banned", "assets/css/style.css", `banned literal ${literal}`);
    }

    const definedProperties = new Set(rules.flatMap((rule) => [...rule.declarations.keys()].filter((property) => property.startsWith("--"))));
    for (const legacyProperty of ["--bg", "--bg2", "--bg3", "--gold", "--gold-light", "--text", "--text-secondary", "--border", "--border-strong", "--accent", "--paper", "--night"]) {
      if (definedProperties.has(legacyProperty)) error(context.errors, "css-banned", "assets/css/style.css", `banned legacy property ${legacyProperty}`);
    }
    for (const match of activeCss.matchAll(/var\((--[a-z0-9-]+)/gi)) {
      if (!definedProperties.has(match[1])) error(context.errors, "css-undefined-property", "assets/css/style.css", `undefined ${match[1]}`);
    }
    const openingBraces = activeCss.match(/\{/g)?.length ?? 0;
    const closingBraces = activeCss.match(/\}/g)?.length ?? 0;
    if (openingBraces !== closingBraces) error(context.errors, "css-delimiters", "assets/css/style.css", `${openingBraces} opening braces and ${closingBraces} closing braces`);

    const bodyContract = new Map([["margin", "0"], ["overflow-x", "clip"], ["background", "var(--sky-paper)"], ["color", "var(--runway-ink)"], ["font-family", "var(--font-body)"], ["font-size", "1rem"], ["font-weight", "400"], ["line-height", "1.65"]]);
    const targetsHtmlBody = (rule) => rule.selectors.some(selectorTargetsHtmlBody);
    const canonicalBodyRuleIndex = rules.findIndex((rule) => rule.media.length === 0
      && targetsHtmlBody(rule)
      && [...bodyContract].every(([property, value]) => rule.declarations.get(property) === value));
    const prohibitedBodyTypography = new Set(["font", "font-family", "font-size", "font-weight", "line-height"]);
    const laterBodyReset = canonicalBodyRuleIndex !== -1 && rules.slice(canonicalBodyRuleIndex + 1).some((rule) => targetsHtmlBody(rule)
      && [...prohibitedBodyTypography].some((property) => rule.declarations.has(property)));
    if (canonicalBodyRuleIndex === -1 || laterBodyReset || [...bodyContract].some(([property, value]) => propertyValue(rules, "body", property) !== value)) {
      error(context.errors, "css-body-contract", "assets/css/style.css", "body typography or document contract is overridden");
    }

    const media1179 = ["@media (max-width: 1179px)"];
    const media759 = ["@media (max-width: 759px)"];
    const media359 = ["@media (max-width: 359px)"];
    const reducedMotion = ["@media (prefers-reduced-motion: reduce)"];
    const responsiveContracts = [
      [[], ".layout-grid", "grid-template-columns", "repeat(12, minmax(0, 1fr))"],
      [media1179, ".layout-grid", "grid-template-columns", "repeat(8, minmax(0, 1fr))"],
      [media759, ".nav-list", "display", "block"],
      [media759, ".nav-toggle", "display", "none"],
      [media759, ".js .nav-list", "display", "none"],
      [media759, ".js .nav-toggle", "display", "inline-flex"],
      [media759, ".js .nav-list.is-open", "display", "block"],
      [media759, ".evidence-row", "display", "grid"],
      [media759, ".evidence-row__context", "grid-column", "1"],
      [media359, "body", "overflow-wrap", "anywhere"],
      [media359, "a", "min-width", "44px"],
      [media359, "a", "min-height", "44px"],
      [reducedMotion, "html", "scroll-behavior", "auto"],
      [reducedMotion, "*", "transition-duration", "0.01ms !important"]
    ];
    for (const [media, selector, property, value] of responsiveContracts) {
      if (propertyValue(rules, selector, property, media) !== value) {
        error(context.errors, "css-responsive", "assets/css/style.css", `missing ${selector} ${property}: ${value} in ${media[0] ?? "base scope"}`);
      }
    }

    const legacyNavFallbackContracts = [
      [".nav-links", "display", "block"],
      [".nav-hamburger", "display", "none"],
      ["html:not(.js):not(.js-reveal) body > nav:not(.breadcrumb)", "position", "relative"],
      ["html:not(.js):not(.js-reveal) body > nav:not(.breadcrumb) .nav-links", "position", "static"]
    ];
    for (const [selector, property, value] of legacyNavFallbackContracts) {
      if (propertyValue(rules, selector, property, media759) !== value) {
        error(context.errors, "css-legacy-nav-fallback", "assets/css/style.css", `legacy mobile fallback requires ${selector} ${property}: ${value}`);
      }
    }

    const targetSelectors = [".nav-logo", ".nav-list a", ".nav-links a", ".nav-group > summary", ".nav-lang", ".breadcrumb a", ".footer-links a"];
    for (const selector of targetSelectors) {
      if (propertyValue(rules, selector, "min-width") !== "44px" || propertyValue(rules, selector, "min-height") !== "44px") {
        error(context.errors, "css-target", "assets/css/style.css", `${selector} must be at least 44px by 44px in base scope`);
      }
    }

    const componentContrastContracts = [
      ["::selection", "background", "var(--signal-dark)"],
      [".btn-primary", "background", "var(--signal-dark)"], [".home-cta", "background", "var(--signal-dark)"],
      [".cta-banner", "background", "var(--signal-dark)"], ["#why", "background", "var(--signal-dark)"],
      [".about-badge", "background", "var(--signal-dark)"], [".chat-send", "background", "var(--signal-dark)"],
      [".back-to-top", "background", "var(--signal-dark)"], [".nav-lang:hover", "background", "var(--signal-dark)"],
      [".nav-logo b", "color", "var(--signal-dark)"], [".gold-link", "color", "var(--signal-dark)"],
      [".process-num", "color", "var(--signal-dark)"], [".case-industry", "color", "var(--signal-dark)"],
      [".resume-edu-year", "color", "var(--signal-dark)"], [".timeline-year", "color", "var(--signal-dark)"],
      [".skill-outcome", "color", "var(--signal-dark)"], [".skill-card__link-label", "color", "var(--signal-dark)"],
      [".client-item:hover", "color", "var(--signal-dark)"], [".breadcrumb a", "color", "var(--signal-dark)"],
      [".service-feat::before", "color", "var(--signal-dark)"], [".service-card-title", "color", "var(--signal-dark)"],
      [".related-link-label", "color", "var(--signal-dark)"],
      [".expertise-dot", "background", "var(--signal-light)"],
      [".skill-card--applications .skill-icon", "color", "var(--signal-light)"],
      [".contact-detail-icon .icon-line", "color", "var(--signal-light)"],
      [".contact-availability::before", "background", "var(--signal-light)"]
    ];
    const contrastPairs = [
      ["--signal-dark", "--white", 4.5], ["--signal-dark", "--sky-paper", 4.5], ["--signal-dark", "--sky-band", 4.5],
      ["--ink-secondary", "--white", 4.5], ["--ink-secondary", "--sky-paper", 4.5], ["--ink-secondary", "--sky-band", 4.5],
      ["--signal-light", "--panel", 4.5], ["--signal-light", "--panel-deep", 4.5],
      ["--focus-dark", "--signal-dark", 3], ["--focus-dark", "--sky-paper", 3], ["--focus-dark", "--sky-band", 3], ["--focus-dark", "--white", 3],
      ["--white", "--signal-dark", 4.5], ["--white", "--panel", 3], ["--white", "--panel-deep", 3]
    ];
    for (const [foreground, background, minimum] of contrastPairs) {
      const ratio = contrastRatio(rootDeclarations.get(foreground), rootDeclarations.get(background));
      if (ratio < minimum) error(context.errors, "css-contrast", "assets/css/style.css", `${foreground} on ${background} is ${ratio.toFixed(2)}:1; expected ${minimum}:1`);
    }
    for (const [selector, property, value] of componentContrastContracts) {
      if (propertyValue(rules, selector, property) !== value) error(context.errors, "css-contrast", "assets/css/style.css", `${selector} must use ${property}: ${value}`);
    }

    const focusContracts = [
      [":focus-visible", "outline", "3px solid var(--signal-dark)"],
      ["#about :focus-visible", "outline-color", "var(--white)"],
      ["#contact .contact-info :focus-visible", "outline-color", "var(--white)"],
      ["#contact .chat-widget :focus-visible", "outline-color", "var(--signal-dark)"],
      ["footer :focus-visible", "outline-color", "var(--white)"],
      [".site-footer :focus-visible", "outline-color", "var(--white)"],
      [".home-cta :focus-visible", "outline-color", "var(--focus-dark)"],
      [".cta-banner :focus-visible", "outline-color", "var(--focus-dark)"],
      [".back-to-top", "border", "3px solid var(--signal-dark)"],
      [".back-to-top:focus-visible", "border-color", "var(--white)"],
      [".back-to-top:focus-visible", "outline", "3px solid var(--focus-dark)"]
    ];
    for (const [selector, property, value] of focusContracts) {
      if (propertyValue(rules, selector, property) !== value) error(context.errors, "css-focus", "assets/css/style.css", `${selector} must use ${property}: ${value}`);
    }
  }
  if (js !== null && js.length === 0) error(context.errors, "foundation-js", "assets/js/main.js", "browser script is empty");
  if (js !== null && gzipSync(Buffer.from(js, "utf8")).byteLength > 25_000) {
    error(context.errors, "budget-js-gzip", "assets/js/main.js", "compressed browser script exceeds 25000 bytes");
  }
  if (js !== null && js.length > 0) verifyBrowserScript(js, context.errors);
  const heroAsset = "assets/img/IMG_3284-480.webp";
  try {
    const heroStat = await stat(resolve(context.root, heroAsset));
    if (!heroStat.isFile() || heroStat.size > 220_000) {
      error(context.errors, "budget-hero-image", heroAsset, "hero image must be a file no larger than 220000 bytes");
    }
  } catch (statError) {
    error(context.errors, "budget-hero-image", heroAsset, `unable to stat required hero image: ${statError.code ?? statError.message}`);
  }
}

function candidates(fact, language) {
  const aliases = isPlainObject(fact.aliases) && Array.isArray(fact.aliases[language]) ? fact.aliases[language] : [];
  return [language === "pl" ? fact.display_pl : fact.display_en, ...aliases].filter(nonEmptyString).map(normalize);
}

async function verifyHome(factData, context) {
  const pages = [{ path: "index.html", lang: "pl" }, { path: "en/index.html", lang: "en" }].filter((page) => context.lang === "all" || page.lang === context.lang);
  const activeBodies = new Map();
  const parsedBodies = new Map();
  for (const page of pages) {
    const html = await read(context, page.path);
    if (html === null) continue;
    if ((html.match(/<h1\b/gi) ?? []).length !== 1) error(context.errors, "home-h1", page.path, "expected exactly one h1");
    const parsed = parseStaticHtml(html);
    for (const syntaxError of parsed.errors) error(context.errors, "home-html-syntax", page.path, syntaxError);
    verifyHomepageBaseline(parsed.root, page, context.errors);
    const parsedBody = htmlBodyRoot(parsed.root);
    parsedBodies.set(page.lang, parsedBody);
    const body = homepageBody(html);
    const activeBody = activeHomepageBody(body);
    activeBodies.set(page.lang, activeBody);
    const visible = verifyHomepageContent(body, parsedBody, page, context.errors);
    verifyHomeStructures(activeBody, page, context.errors);
    verifyEnglishHomeContract(activeBody, page, context.errors);
    verifyEnglishPolishOnlyLink(parsedBody, page, context.errors);
    verifyHomeFactPatterns(activeBody, page, context.errors);
    const records = Array.isArray(factData.facts) ? factData.facts : [];
    const byId = new Map(records.filter((fact) => nonEmptyString(fact?.id)).map((fact) => [fact.id, fact]));
    const correctlyAnnotated = new Set();
    for (const element of homeFactElements(activeBody)) {
      const factId = attributeValue(element.opening, "data-fact-id");
      const fact = byId.get(factId);
      if (!fact) {
        error(context.errors, "home-fact-unknown", page.path, `unknown data-fact-id ${factId}`);
        continue;
      }
      if (!Array.isArray(fact.surfaces) || !fact.surfaces.includes(page.path)) {
        error(context.errors, "home-fact-surface", page.path, `${factId} is not approved for this surface`);
        continue;
      }
      if (fact.status !== "approved") {
        error(context.errors, "home-fact-status", page.path, `${factId} has status ${fact.status}`);
        continue;
      }
      const elementText = renderedText(element.content);
      if (!candidates(fact, page.lang).some((candidate) => elementText === candidate)) {
        error(context.errors, "home-fact-value", page.path, `${factId} must equal its localized display or alias`);
        continue;
      }
      correctlyAnnotated.add(factId);
    }

    const unannotatedVisible = renderedText(withoutAnnotatedHomeFacts(activeBody));
    for (const fact of records.filter((item) => Array.isArray(item?.surfaces) && item.surfaces.includes(page.path))) {
      const published = candidates(fact, page.lang).some((candidate) => visible.includes(candidate));
      if (fact.status === "approved" && !correctlyAnnotated.has(fact.id)) error(context.errors, `fact-${fact.id}`, page.path, `missing approved annotated display: ${page.lang === "pl" ? fact.display_pl : fact.display_en}`);
      if (fact.status === "approved" && candidates(fact, page.lang).some((candidate) => unannotatedVisible.includes(candidate))) {
        error(context.errors, "home-fact-annotation", page.path, `${fact.id} is also published without data-fact-id`);
      }
      if (fact.status !== "approved" && published) error(context.errors, `fact-${fact.id}`, page.path, "non-approved fact is still published");
    }
  }
  if (context.lang === "all" && activeBodies.has("pl") && activeBodies.has("en") && parsedBodies.has("pl") && parsedBodies.has("en")) {
    verifyHomepageParity(activeBodies.get("pl"), activeBodies.get("en"), parsedBodies.get("pl"), parsedBodies.get("en"), context.errors);
  }
}

export async function runVerification({ root = defaultRoot, scope = "all", lang = "all" } = {}) {
  const errors = [];
  const context = { root, scope, lang, errors };
  if (!["all", "pl", "en"].includes(lang)) error(errors, "cli-lang", "scripts/verify-site.mjs", `unsupported language ${lang}`);
  if (!["all", "facts", "foundation", "home"].includes(scope)) error(errors, "cli-scope", "scripts/verify-site.mjs", `unsupported scope ${scope}`);
  const facts = await readFacts({ root, onError: (id, path, message) => error(errors, id, path, message) });
  if (scope === "facts" || scope === "all") {
    const publicSurfaces = verifyPublicSurfaceInventory(facts, errors);
    const factIds = verifyFactSchema(facts, publicSurfaces, errors);
    verifyBlockedSchema(facts, factIds, errors);
    await verifyPublicFactSurfaces(facts, publicSurfaces, context);
    await verifyBlockedSurfaces(facts, publicSurfaces, context);
  }
  if (scope === "foundation" || scope === "all") await verifyFoundation(context);
  if (scope === "home" || scope === "all") await verifyHome(facts, context);
  return { facts, errors };
}

async function cli() {
  const scope = process.argv.find((arg) => arg.startsWith("--scope="))?.split("=")[1] ?? "all";
  const lang = process.argv.find((arg) => arg.startsWith("--lang="))?.split("=")[1] ?? "all";
  const result = await runVerification({ scope, lang });
  if (result.errors.length) {
    console.error(result.errors.join("\n"));
    process.exitCode = 1;
  } else {
    console.log(`OK site verification (${scope})`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await cli();
