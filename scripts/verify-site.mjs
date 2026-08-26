import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const defaultRoot = resolve(import.meta.dirname, "..");
const factKeys = ["id", "value", "display_pl", "display_en", "kind", "as_of", "source_type", "source_label", "source_url", "surfaces", "status"];
const kinds = new Set(["constant", "dated"]);
const sourceTypes = new Set(["owner_verified", "public_source", "internal_evidence"]);
const statuses = new Set(["approved", "review", "retired"]);
const blockedKeys = ["id", "pattern", "forbidden_contexts", "reason"];
const requiredPublicClaimSurfaces = ["index.html", "en/index.html", "llms.txt", "llms-full.txt", "worker/index.js", "assets/js/main.js"];

const ROUTE_PAIRS = [
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

const VALID_FAMILIES = new Set([
  "all", "home", "services", "applications", "aviation",
  "projects", "knowledge", "speaking", "artifacts"
]);

const ROUTE_FILE_FAMILIES = new Map(ROUTE_PAIRS.flatMap(([plFile, enFile, , , family]) => [
  [plFile, family],
  [enFile, family]
]));

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

function normalizeExactLiteral(text) {
  return text
    .normalize("NFKC")
    .replace(/\p{Default_Ignorable_Code_Point}+/gu, "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sameExactLiteral(actual, expected) {
  return typeof actual === "string"
    && typeof expected === "string"
    && normalizeExactLiteral(actual) === normalizeExactLiteral(expected);
}

const htmlNamedCharacterReferences = new Map([
  ["AMP", "&"], ["amp", "&"],
  ["LT", "<"], ["lt", "<"],
  ["GT", ">"], ["gt", ">"],
  ["QUOT", '"'], ["quot", '"'],
  ["apos", "'"],
  ["mdash", "—"],
  ["nbsp", "\u00a0"],
  ["sol", "/"], ["bsol", "\\"],
  ["Tab", "\t"], ["NewLine", "\n"],
  ["colon", ":"], ["comma", ","]
]);

function decodeHtmlEntities(text) {
  return text.replace(/&#(?:[xX][0-9a-fA-F]+|\d+);?|&([A-Za-z][A-Za-z0-9]+);/g, (match, named) => {
    if (named !== undefined) return htmlNamedCharacterReferences.get(named) ?? match;
    const entity = match.slice(2).replace(/;$/, "");
    const hexadecimal = entity[0] === "x" || entity[0] === "X";
    const codePoint = Number.parseInt(hexadecimal ? entity.slice(1) : entity, hexadecimal ? 16 : 10);
    return codePoint > 0 && codePoint <= 0x10FFFF ? String.fromCodePoint(codePoint) : "�";
  });
}

function normalizeExactHtmlLiteral(text) {
  return normalizeExactLiteral(decodeHtmlEntities(text));
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
      const rawText = { type: "text", value: html.slice(cursor, match.index), parent: node };
      node.children.push(rawText);
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

function elementHasHiddenInlineStyle(element) {
  const style = elementAttribute(element, "style");
  if (!nonEmptyString(style)) return false;
  const commentScan = stripCssComments(decodeHtmlEntities(style));
  if (commentScan.unterminatedCommentAt !== -1) return true;
  const escapeScan = decodeCssEscapesChecked(commentScan.css);
  if (escapeScan.malformedEscapeAt !== -1 || escapeScan.unterminatedQuoteAt !== -1) return true;
  const declarations = new Map([...parseDeclarations(commentScan.css)].map(([property, value]) => [
    decodeCssEscapes(property).trim().toLowerCase(),
    decodeCssEscapes(value)
  ]));
  const valueWithoutImportant = (property) => normalize(declarations.get(property) ?? "").replace(/\s*!\s*important\s*$/, "");
  return valueWithoutImportant("display") === "none"
    || new Set(["hidden", "collapse"]).has(valueWithoutImportant("visibility"));
}

function elementIsStaticallyHidden(element) {
  return elementHasHiddenState(element) || elementHasHiddenInlineStyle(element) || staticallyHiddenElements.has(element.name);
}

function elementIsVisibleIfDisclosuresOpen(element) {
  for (let current = element; current?.type === "element"; current = current.parent) {
    if (elementIsStaticallyHidden(current)) return false;
  }
  return true;
}

function elementIsStaticallyVisible(element) {
  if (!elementIsVisibleIfDisclosuresOpen(element)) return false;
  for (let current = element; current?.type === "element"; current = current.parent) {
    const parent = current.parent;
    if (parent?.type === "element" && parent.name === "details" && !parent.attributes.has("open")) {
      const firstSummary = parent.children.find((child) => child.type === "element" && child.name === "summary");
      if (current !== firstSummary) return false;
    }
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
    const parent = current.parent;
    const hiddenByClosedDisclosure = parent?.type === "element"
      && parent.name === "details"
      && !parent.attributes.has("open")
      && current !== parent.children.find((child) => child.type === "element" && child.name === "summary");
    const hidden = ancestorHidden
      || hiddenByClosedDisclosure
      || (current.type === "element" && !elementIsStaticallyVisible(current));
    if (current.type === "text") {
      if (!hidden) text += current.value;
      return;
    }
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

function decodeCssEscapesChecked(source) {
  let decoded = "";
  let quote = null;
  let quoteStart = -1;
  let escaped = false;
  let malformedEscapeAt = -1;
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
      quoteStart = index;
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
    if (escapedCharacter === undefined || /[\r\n\f]/.test(escapedCharacter)) {
      if (malformedEscapeAt === -1) malformedEscapeAt = index;
    } else {
      decoded += escapedCharacter;
      index += 1;
    }
  }
  return { decoded, malformedEscapeAt, unterminatedQuoteAt: quote === null ? -1 : quoteStart };
}

function decodeCssEscapes(source) {
  return decodeCssEscapesChecked(source).decoded;
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

async function readRequired(context, relativePath, checkId) {
  try {
    return await readFile(resolve(context.root, relativePath), "utf8");
  } catch (cause) {
    if (cause.code === "ENOENT") error(context.errors, checkId, relativePath, "required file is missing");
    else error(context.errors, checkId, relativePath, `unable to read required file: ${cause.code ?? cause.message}`);
    return "";
  }
}

function pageElementIsActive(element) {
  return elementIsStaticallyVisible(element) && elementIsActiveResource(element);
}

function exactActiveLink(element, expectedAttributes) {
  return element.name === "link"
    && elementHasExactAttributeNames(element, new Set(Object.keys(expectedAttributes)))
    && Object.entries(expectedAttributes).every(([name, value]) => {
      if (name === "rel") {
        const tokens = elementAttributeTokens(element, "rel");
        return tokens.length === 1 && tokens[0] === value;
      }
      return elementAttribute(element, name) === value;
    })
    && elementIsActiveResource(element);
}

function expectedPageNavigation(lang) {
  return lang === "pl" ? [
    "/uslugi/transformacja-zakupow/",
    "/uslugi/wdrozenie-sap-ariba/",
    "/uslugi/doradztwo-zamowienia-publiczne/",
    "/aplikacje-operacyjne/",
    "/lotnictwo/",
    "/case-studies/",
    "/wiedza/",
    "/#about",
    "/#contact"
  ] : [
    "/en/uslugi/transformacja-zakupow/",
    "/en/uslugi/wdrozenie-sap-ariba/",
    "/en/uslugi/doradztwo-zamowienia-publiczne/",
    "/en/aplikacje-operacyjne/",
    "/en/lotnictwo/",
    "/en/case-studies/",
    "/en/wiedza/",
    "/en/#about",
    "/en/#contact"
  ];
}

function verifyPageShell(path, html, lang, route, pairedRoute, errors) {
  const parsed = parseStaticHtml(html);
  for (const syntaxError of parsed.errors) error(errors, "page-html-syntax", path, syntaxError);
  const elements = elementDescendants(parsed.root);
  const activeElements = elements.filter(pageElementIsActive);

  const rootElements = parsed.root.children.filter((child) => child.type === "element");
  const htmlElements = elements.filter((element) => element.name === "html");
  const headElements = elements.filter((element) => element.name === "head");
  const bodyElements = elements.filter((element) => element.name === "body");
  const documentHtml = htmlElements.length === 1 ? htmlElements[0] : null;
  const directDocumentElements = documentHtml?.children.filter((child) => child.type === "element") ?? [];
  const validDocumentTopology = rootElements.length === 1
    && rootElements[0] === documentHtml
    && pageElementIsActive(documentHtml)
    && headElements.length === 1
    && bodyElements.length === 1
    && directDocumentElements.length === 2
    && directDocumentElements[0] === headElements[0]
    && directDocumentElements[1] === bodyElements[0]
    && pageElementIsActive(headElements[0])
    && pageElementIsActive(bodyElements[0]);
  if (!validDocumentTopology) {
    error(errors, "page-document", path, "requires one active html root with one direct head followed by one direct body");
  }

  const heads = activeElements.filter((element) => element.name === "head");
  if (heads.length !== 1) error(errors, "page-head", path, `expected exactly one active head; found ${heads.length}`);
  const headLinks = validDocumentTopology ? elementDescendants(headElements[0], "link") : [];

  const headings = activeElements.filter((element) => element.name === "h1");
  if (headings.length !== 1) error(errors, "page-h1", path, `expected exactly one active h1; found ${headings.length}`);

  const mains = activeElements.filter((element) => element.name === "main");
  if (mains.length !== 1 || elementAttribute(mains[0], "id") !== "main") {
    error(errors, "page-main", path, `expected exactly one active main#main; found ${mains.length}`);
  }

  const expectedCanonical = `https://mamcarz.com${route}`;
  const canonicalCandidates = headLinks.filter((element) => {
    const rel = elementAttributeTokens(element, "rel");
    return rel.includes("canonical")
      || (elementAttribute(element, "href") === expectedCanonical && !rel.includes("alternate") && !element.attributes.has("hreflang"));
  });
  const validCanonicals = canonicalCandidates.filter((element) => exactActiveLink(element, { rel: "canonical", href: expectedCanonical }));
  if (canonicalCandidates.length !== 1 || validCanonicals.length !== 1) {
    error(errors, "page-canonical", path, `requires one active canonical ${expectedCanonical}`);
  }

  const plRoute = lang === "pl" ? route : pairedRoute;
  const enRoute = lang === "en" ? route : pairedRoute;
  const expectedHreflang = new Map([
    ["pl", `https://mamcarz.com${plRoute}`],
    ["en", `https://mamcarz.com${enRoute}`],
    ["x-default", `https://mamcarz.com${plRoute}`]
  ]);
  const hreflangCandidates = headLinks.filter((element) => element.attributes.has("hreflang")
    || elementAttributeTokens(element, "rel").includes("alternate"));
  const validHreflang = hreflangCandidates.filter((element) => {
    const hreflang = normalize(elementAttribute(element, "hreflang") ?? "");
    const href = expectedHreflang.get(hreflang);
    return href !== undefined && exactActiveLink(element, { rel: "alternate", hreflang, href });
  });
  const actualHreflang = new Map(validHreflang.map((element) => [normalize(elementAttribute(element, "hreflang") ?? ""), elementAttribute(element, "href")]));
  if (hreflangCandidates.length !== 3
    || validHreflang.length !== 3
    || actualHreflang.size !== 3
    || [...expectedHreflang].some(([language, href]) => actualHreflang.get(language) !== href)) {
    error(errors, "page-hreflang", path, "requires exact active pl, en and x-default hreflang entries for the real route pair");
  }

  const expectedStylesheet = "/assets/css/style.css?v=20260825-flightplan-2";
  const links = elements.filter((element) => element.name === "link");
  const stylesheetCandidates = links.filter((element) => elementAttributeTokens(element, "rel").includes("stylesheet")
    || (elementAttribute(element, "href") ?? "").startsWith("/assets/css/style.css"));
  const validStylesheets = stylesheetCandidates.filter((element) => exactActiveLink(element, { rel: "stylesheet", href: expectedStylesheet }));
  if (stylesheetCandidates.length !== 1 || validStylesheets.length !== 1) {
    error(errors, "page-stylesheet", path, `requires one active shared stylesheet ${expectedStylesheet}`);
  }

  const expectedScript = "/assets/js/main.js?v=20260825-flightplan-2";
  const scriptCandidates = elements.filter((element) => element.name === "script" && element.attributes.has("src"));
  const validScripts = scriptCandidates.filter((element) => elementHasExactAttributeNames(element, new Set(["src", "defer"]))
    && elementAttribute(element, "src") === expectedScript
    && element.attributes.has("defer")
    && elementIsActiveResource(element));
  if (scriptCandidates.length !== 1 || validScripts.length !== 1) {
    error(errors, "page-script", path, `requires one active deferred shared script ${expectedScript}`);
  }

  const siteNavs = activeElements.filter((element) => element.name === "nav" && elementHasClass(element, "site-nav"));
  if (siteNavs.length !== 1) {
    error(errors, "page-navigation", path, `expected exactly one active nav.site-nav; found ${siteNavs.length}`);
  }
  const nav = siteNavs[0];
  if (nav) {
    const navLinks = elementDescendants(nav, "a")
      .filter((link) => elementIsVisibleIfDisclosuresOpen(link) && elementIsActiveResource(link));
    let previousIndex = -1;
    for (const expectedRoute of expectedPageNavigation(lang)) {
      const indexes = navLinks.flatMap((link, index) => elementAttribute(link, "href") === expectedRoute ? [index] : []);
      if (indexes.length !== 1 || indexes[0] <= previousIndex) {
        error(errors, "page-navigation", path, `missing, duplicate or out-of-order main navigation route ${expectedRoute}`);
      } else {
        previousIndex = indexes[0];
      }
    }
    const languageLinks = navLinks.filter((link) => elementHasClass(link, "nav-lang"));
    const expectedLanguageLabel = lang === "pl" ? "en" : "pl";
    if (languageLinks.length !== 1
      || elementAttribute(languageLinks[0], "href") !== pairedRoute
      || staticVisibleText(languageLinks[0]) !== expectedLanguageLabel) {
      error(errors, "page-language", path, `language switch must visibly say ${expectedLanguageLabel.toUpperCase()} and target ${pairedRoute}`);
    }
  }

  return parsed.root;
}

function verifyFactIds(path, parsedRoot, factData, errors) {
  const records = Array.isArray(factData.facts) ? factData.facts.filter(isPlainObject) : [];
  const byId = new Map(records.filter((fact) => nonEmptyString(fact.id)).map((fact) => [fact.id, fact]));
  for (const element of elementDescendants(parsedRoot)) {
    if (!element.attributes.has("data-fact-ids")) continue;
    const value = element.attributes.get("data-fact-ids");
    const ids = typeof value === "string" ? value.trim().split(/\s+/).filter(Boolean) : [];
    if (ids.length === 0) {
      error(errors, "page-fact-ids", path, "data-fact-ids must contain at least one whitespace-delimited fact ID");
      continue;
    }
    if (new Set(ids).size !== ids.length) {
      error(errors, "page-fact-ids", path, "data-fact-ids must not repeat a fact ID");
    }
    for (const factId of ids) {
      const fact = byId.get(factId);
      if (!fact) error(errors, "page-fact-unknown", path, `unknown data-fact-ids token ${factId}`);
      else if (fact.status !== "approved") error(errors, "page-fact-status", path, `${factId} has status ${fact.status}`);
    }
  }
}

const APPLICATION_PAGE_CONTRACT = {
  pl: {
    path: "aplikacje-operacyjne/index.html",
    title: "Aplikacje operacyjne",
    lead: "Buduję narzędzia wokół rzeczywistego procesu pracy. Zaczynam od decyzji, danych i odpowiedzialności użytkowników, a kończę na rozwiązaniu uruchomionym w codziennej operacji.",
    description: "Projektowanie aplikacji operacyjnych wokół procesu, danych, odpowiedzialności użytkowników i codziennej pracy.",
    url: "https://mamcarz.com/aplikacje-operacyjne/",
    contactHref: "mailto:pawel@mamcarz.com?subject=Aplikacja%20operacyjna",
    deliveryLabels: ["Discovery", "Model danych", "Workflow", "Uruchomienie"]
  },
  en: {
    path: "en/aplikacje-operacyjne/index.html",
    title: "Operational applications",
    lead: "I build tools around the way an operation actually works. The starting point is the decision, data and user responsibility; the endpoint is a solution used in day-to-day work.",
    description: "Operational application design around process, data, user responsibility and day-to-day work.",
    url: "https://mamcarz.com/en/aplikacje-operacyjne/",
    contactHref: "mailto:pawel@mamcarz.com?subject=Operational%20application",
    deliveryLabels: ["Discovery", "Data model", "Workflow", "Launch"]
  }
};

const APPLICATION_EVIDENCE_CONTRACT = Object.freeze([
  Object.freeze({
    ids: Object.freeze(["portfolio.czympojade_pl", "portfolio.czympojade_pl.type"]),
    pl: Object.freeze({ context: "Produkt / 01", name: "czympojade.pl", label: "Funkcja", meaning: "Aplikacja transportowa do pracy z połączeniami i rozkładami." }),
    en: Object.freeze({ context: "Product / 01", name: "czympojade.pl", label: "Function", meaning: "Transport application for working with connections and timetables." })
  }),
  Object.freeze({
    ids: Object.freeze(["portfolio.przypominamy_com", "portfolio.przypominamy_com.type"]),
    pl: Object.freeze({ context: "Produkt / 02", name: "Przypominamy.com", label: "Funkcja", meaning: "Platforma powiadomień dla organizacji." }),
    en: Object.freeze({ context: "Product / 02", name: "Przypominamy.com", label: "Function", meaning: "Notification platform for organisations." })
  }),
  Object.freeze({
    ids: Object.freeze(["portfolio.procuracost", "portfolio.procuracost.type"]),
    pl: Object.freeze({ context: "Produkt / 03", name: "ProcuraCost", label: "Funkcja", meaning: "Kalkulator kosztów procedur zakupowych." }),
    en: Object.freeze({ context: "Product / 03", name: "ProcuraCost", label: "Function", meaning: "Procurement procedure cost calculator." })
  })
]);

const APPLICATION_LITERAL_CONTRACT = Object.freeze({
  pl: Object.freeze({
    documentTitle: "Aplikacje operacyjne · Paweł Mamcarz",
    locale: "pl_PL",
    skip: "Przejdź do treści",
    backLabel: "Wróć na górę",
    navigation: Object.freeze({
      ariaLabel: "Nawigacja główna",
      logoHref: "/",
      advisory: "Doradztwo",
      submenu: Object.freeze([
        Object.freeze(["/uslugi/transformacja-zakupow/", "Transformacja zakupów"]),
        Object.freeze(["/uslugi/wdrozenie-sap-ariba/", "Wdrożenie SAP Ariba"]),
        Object.freeze(["/uslugi/doradztwo-zamowienia-publiczne/", "Zamówienia publiczne"])
      ]),
      primary: Object.freeze([
        Object.freeze(["/aplikacje-operacyjne/", "Aplikacje operacyjne", true]),
        Object.freeze(["/lotnictwo/", "Lotnictwo", false]),
        Object.freeze(["/case-studies/", "Projekty", false]),
        Object.freeze(["/wiedza/", "Wiedza", false]),
        Object.freeze(["/#about", "O mnie", false]),
        Object.freeze(["/#contact", "Kontakt", false])
      ]),
      languageHref: "/en/aplikacje-operacyjne/",
      languageLabel: "EN",
      toggleLabel: "Menu nawigacyjne"
    }),
    hero: Object.freeze([
      "Strona główna", "/", "Aplikacje operacyjne", "Aplikacje operacyjne",
      "Buduję narzędzia wokół rzeczywistego procesu pracy. Zaczynam od decyzji, danych i odpowiedzialności użytkowników, a kończę na rozwiązaniu uruchomionym w codziennej operacji."
    ]),
    sections: Object.freeze({
      problem: Object.freeze([
        "01 / Problem", "Interfejs zaczyna się od procesu.",
        "Punktem wyjścia są decyzje, dane, role i wyjątki. Dopiero ich układ pokazuje, jakiego narzędzia potrzebuje operacja.",
        "Procurement", "Decyzje zakupowe, reguły, dane dostawców i odpowiedzialność za kolejne kroki.",
        "Field service", "Zlecenia, zasoby, dokumenty i przekazanie pracy między rolami.",
        "Lotnictwo", "Kwalifikacje, planowanie, dokumentacja i odpowiedzialność operacyjna."
      ]),
      delivery: Object.freeze([
        "02 / Delivery", "Od rozpoznania do uruchomienia.",
        "Kolejność pracy jest częścią rozwiązania. Każdy etap zamyka konkretną decyzję potrzebną do następnego kroku.",
        "01 / Rozpoznanie", "Discovery", "Problem, użytkownicy, decyzje i ograniczenia.",
        "02 / Struktura", "Model danych", "Obiekty, źródła, reguły jakości i odpowiedzialność.",
        "03 / Przepływ", "Workflow", "Stany, role, wyjątki i ślad decyzji.",
        "04 / Operacja", "Uruchomienie", "Przygotowanie danych, odbiór procesu i wejście do codziennej pracy."
      ]),
      evidence: Object.freeze([
        "03 / Evidence", "Wybrane produkty.", "Trzy różne zakresy pokazane przez ich zatwierdzone znaczenie produktowe.",
        "Produkt / 01", "czympojade.pl", "Funkcja", "Aplikacja transportowa do pracy z połączeniami i rozkładami.",
        "Produkt / 02", "Przypominamy.com", "Funkcja", "Platforma powiadomień dla organizacji.",
        "Produkt / 03", "ProcuraCost", "Funkcja", "Kalkulator kosztów procedur zakupowych."
      ]),
      fit: Object.freeze([
        "04 / Fit", "Warunki dobrego dopasowania.",
        "Najlepszym początkiem jest konkretny proces oraz osoby, które znają jego codzienny przebieg i wyjątki.",
        "Właściciel procesu", "Nazwana osoba podejmuje decyzje dotyczące reguł i priorytetów.",
        "Wiedza domenowa", "Dostęp do użytkowników i osób odpowiedzialnych za wyjątki w procesie.",
        "Dane źródłowe", "Możliwość rozpoznania źródeł, definicji oraz odpowiedzialności za jakość.",
        "Odpowiedzialność za uruchomienie", "Ustalony sposób odbioru procesu i przekazania narzędzia do codziennej pracy."
      ]),
      contact: Object.freeze([
        "05 / Kontakt", "Zacznijmy od procesu.",
        "Opisz decyzję, przepływ pracy albo dane, które wymagają uporządkowania. To wystarczy, żeby rozpocząć rozmowę.",
        "Opisz aplikację operacyjną"
      ])
    }),
    footer: Object.freeze([
      "© Paweł Mamcarz · mamcarz.com", "Strona główna", "Doradztwo", "Aplikacje", "Lotnictwo", "Projekty", "Kontakt"
    ]),
    footerLinks: Object.freeze([
      Object.freeze(["/", "Strona główna"]),
      Object.freeze(["/uslugi/transformacja-zakupow/", "Doradztwo"]),
      Object.freeze(["/aplikacje-operacyjne/", "Aplikacje"]),
      Object.freeze(["/lotnictwo/", "Lotnictwo"]),
      Object.freeze(["/case-studies/", "Projekty"]),
      Object.freeze(["/#contact", "Kontakt"])
    ])
  }),
  en: Object.freeze({
    documentTitle: "Operational applications · Paweł Mamcarz",
    locale: "en_US",
    skip: "Skip to content",
    backLabel: "Back to top",
    navigation: Object.freeze({
      ariaLabel: "Main navigation",
      logoHref: "/en/",
      advisory: "Advisory",
      submenu: Object.freeze([
        Object.freeze(["/en/uslugi/transformacja-zakupow/", "Procurement transformation"]),
        Object.freeze(["/en/uslugi/wdrozenie-sap-ariba/", "SAP Ariba implementation"]),
        Object.freeze(["/en/uslugi/doradztwo-zamowienia-publiczne/", "Public procurement"])
      ]),
      primary: Object.freeze([
        Object.freeze(["/en/aplikacje-operacyjne/", "Operational applications", true]),
        Object.freeze(["/en/lotnictwo/", "Aviation", false]),
        Object.freeze(["/en/case-studies/", "Projects", false]),
        Object.freeze(["/en/wiedza/", "Knowledge", false]),
        Object.freeze(["/en/#about", "About", false]),
        Object.freeze(["/en/#contact", "Contact", false])
      ]),
      languageHref: "/aplikacje-operacyjne/",
      languageLabel: "PL",
      toggleLabel: "Navigation menu"
    }),
    hero: Object.freeze([
      "Home", "/", "Operational applications", "Operational applications",
      "I build tools around the way an operation actually works. The starting point is the decision, data and user responsibility; the endpoint is a solution used in day-to-day work."
    ]),
    sections: Object.freeze({
      problem: Object.freeze([
        "01 / Problem", "The interface starts with the process.",
        "Decisions, data, roles and exceptions come first. Their arrangement shows what kind of tool the operation needs.",
        "Procurement", "Procurement decisions, rules, supplier data and responsibility for each next step.",
        "Field service", "Work orders, resources, documents and the handover of work between roles.",
        "Aviation", "Qualifications, planning, documentation and operational responsibility."
      ]),
      delivery: Object.freeze([
        "02 / Delivery", "From discovery to launch.",
        "The order of work is part of the solution. Each stage closes a specific decision needed for the next step.",
        "01 / Discovery", "Discovery", "The problem, users, decisions and constraints.",
        "02 / Structure", "Data model", "Objects, sources, quality rules and responsibility.",
        "03 / Flow", "Workflow", "States, roles, exceptions and a decision trail.",
        "04 / Operation", "Launch", "Data preparation, process acceptance and entry into day-to-day work."
      ]),
      evidence: Object.freeze([
        "03 / Evidence", "Selected products.", "Three different scopes, shown through their approved product meaning.",
        "Product / 01", "czympojade.pl", "Function", "Transport application for working with connections and timetables.",
        "Product / 02", "Przypominamy.com", "Function", "Notification platform for organisations.",
        "Product / 03", "ProcuraCost", "Function", "Procurement procedure cost calculator."
      ]),
      fit: Object.freeze([
        "04 / Fit", "Conditions for a good fit.",
        "A useful starting point is a specific process and the people who know its daily flow and exceptions.",
        "Process owner", "A named person decides on rules and priorities.",
        "Domain knowledge", "Access to users and the people responsible for process exceptions.",
        "Source data", "The ability to identify sources, definitions and responsibility for quality.",
        "Launch responsibility", "An agreed way to accept the process and hand the tool into day-to-day work."
      ]),
      contact: Object.freeze([
        "05 / Contact", "Start with the process.",
        "Describe the decision, workflow or data that needs structure. That is enough to begin the conversation.",
        "Describe the operational application"
      ])
    }),
    footer: Object.freeze([
      "© Paweł Mamcarz · mamcarz.com", "Home", "Advisory", "Applications", "Aviation", "Projects", "Contact"
    ]),
    footerLinks: Object.freeze([
      Object.freeze(["/en/", "Home"]),
      Object.freeze(["/en/uslugi/transformacja-zakupow/", "Advisory"]),
      Object.freeze(["/en/aplikacje-operacyjne/", "Applications"]),
      Object.freeze(["/en/lotnictwo/", "Aviation"]),
      Object.freeze(["/en/case-studies/", "Projects"]),
      Object.freeze(["/en/#contact", "Contact"])
    ])
  })
});

function freezeApplicationManifest(entries) {
  return Object.freeze(entries.map((entry) => Object.freeze({
    ...entry,
    attributes: Object.freeze({ ...entry.attributes })
  })));
}

const APPLICATION_ANCHOR_MANIFEST = Object.freeze({
  pl: freezeApplicationManifest([
    { role: "skip", href: "#main", label: "Przejdź do treści", kind: "text", attributes: { href: "#main", class: "skip-link" } },
    { role: "nav-logo", href: "/", label: "PM · Mamcarz.com", kind: "logo", attributes: { href: "/", class: "nav-logo" } },
    { role: "nav-advisory-0", href: "/uslugi/transformacja-zakupow/", label: "Transformacja zakupów", kind: "text", attributes: { href: "/uslugi/transformacja-zakupow/" } },
    { role: "nav-advisory-1", href: "/uslugi/wdrozenie-sap-ariba/", label: "Wdrożenie SAP Ariba", kind: "text", attributes: { href: "/uslugi/wdrozenie-sap-ariba/" } },
    { role: "nav-advisory-2", href: "/uslugi/doradztwo-zamowienia-publiczne/", label: "Zamówienia publiczne", kind: "text", attributes: { href: "/uslugi/doradztwo-zamowienia-publiczne/" } },
    { role: "nav-primary-0", href: "/aplikacje-operacyjne/", label: "Aplikacje operacyjne", kind: "text", attributes: { href: "/aplikacje-operacyjne/", "aria-current": "page" } },
    { role: "nav-primary-1", href: "/lotnictwo/", label: "Lotnictwo", kind: "text", attributes: { href: "/lotnictwo/" } },
    { role: "nav-primary-2", href: "/case-studies/", label: "Projekty", kind: "text", attributes: { href: "/case-studies/" } },
    { role: "nav-primary-3", href: "/wiedza/", label: "Wiedza", kind: "text", attributes: { href: "/wiedza/" } },
    { role: "nav-primary-4", href: "/#about", label: "O mnie", kind: "text", attributes: { href: "/#about" } },
    { role: "nav-primary-5", href: "/#contact", label: "Kontakt", kind: "text", attributes: { href: "/#contact" } },
    { role: "nav-language", href: "/en/aplikacje-operacyjne/", label: "EN", kind: "text", attributes: { href: "/en/aplikacje-operacyjne/", class: "nav-lang" } },
    { role: "breadcrumb-home", href: "/", label: "Strona główna", kind: "text", attributes: { href: "/" } },
    { role: "contact-cta", href: "mailto:pawel@mamcarz.com?subject=Aplikacja%20operacyjna", label: "Opisz aplikację operacyjną", kind: "text", attributes: { class: "btn-primary", href: "mailto:pawel@mamcarz.com?subject=Aplikacja%20operacyjna" } },
    { role: "footer-sign", href: "/", label: "", kind: "signature", attributes: { class: "footer-sign", href: "/", "aria-label": "Paweł Mamcarz, strona główna" } },
    { role: "footer-link-0", href: "/", label: "Strona główna", kind: "text", attributes: { href: "/" } },
    { role: "footer-link-1", href: "/uslugi/transformacja-zakupow/", label: "Doradztwo", kind: "text", attributes: { href: "/uslugi/transformacja-zakupow/" } },
    { role: "footer-link-2", href: "/aplikacje-operacyjne/", label: "Aplikacje", kind: "text", attributes: { href: "/aplikacje-operacyjne/" } },
    { role: "footer-link-3", href: "/lotnictwo/", label: "Lotnictwo", kind: "text", attributes: { href: "/lotnictwo/" } },
    { role: "footer-link-4", href: "/case-studies/", label: "Projekty", kind: "text", attributes: { href: "/case-studies/" } },
    { role: "footer-link-5", href: "/#contact", label: "Kontakt", kind: "text", attributes: { href: "/#contact" } }
  ]),
  en: freezeApplicationManifest([
    { role: "skip", href: "#main", label: "Skip to content", kind: "text", attributes: { href: "#main", class: "skip-link" } },
    { role: "nav-logo", href: "/en/", label: "PM · Mamcarz.com", kind: "logo", attributes: { href: "/en/", class: "nav-logo" } },
    { role: "nav-advisory-0", href: "/en/uslugi/transformacja-zakupow/", label: "Procurement transformation", kind: "text", attributes: { href: "/en/uslugi/transformacja-zakupow/" } },
    { role: "nav-advisory-1", href: "/en/uslugi/wdrozenie-sap-ariba/", label: "SAP Ariba implementation", kind: "text", attributes: { href: "/en/uslugi/wdrozenie-sap-ariba/" } },
    { role: "nav-advisory-2", href: "/en/uslugi/doradztwo-zamowienia-publiczne/", label: "Public procurement", kind: "text", attributes: { href: "/en/uslugi/doradztwo-zamowienia-publiczne/" } },
    { role: "nav-primary-0", href: "/en/aplikacje-operacyjne/", label: "Operational applications", kind: "text", attributes: { href: "/en/aplikacje-operacyjne/", "aria-current": "page" } },
    { role: "nav-primary-1", href: "/en/lotnictwo/", label: "Aviation", kind: "text", attributes: { href: "/en/lotnictwo/" } },
    { role: "nav-primary-2", href: "/en/case-studies/", label: "Projects", kind: "text", attributes: { href: "/en/case-studies/" } },
    { role: "nav-primary-3", href: "/en/wiedza/", label: "Knowledge", kind: "text", attributes: { href: "/en/wiedza/" } },
    { role: "nav-primary-4", href: "/en/#about", label: "About", kind: "text", attributes: { href: "/en/#about" } },
    { role: "nav-primary-5", href: "/en/#contact", label: "Contact", kind: "text", attributes: { href: "/en/#contact" } },
    { role: "nav-language", href: "/aplikacje-operacyjne/", label: "PL", kind: "text", attributes: { href: "/aplikacje-operacyjne/", class: "nav-lang" } },
    { role: "breadcrumb-home", href: "/en/", label: "Home", kind: "text", attributes: { href: "/en/" } },
    { role: "contact-cta", href: "mailto:pawel@mamcarz.com?subject=Operational%20application", label: "Describe the operational application", kind: "text", attributes: { class: "btn-primary", href: "mailto:pawel@mamcarz.com?subject=Operational%20application" } },
    { role: "footer-sign", href: "/en/", label: "", kind: "signature", attributes: { class: "footer-sign", href: "/en/", "aria-label": "Paweł Mamcarz, home" } },
    { role: "footer-link-0", href: "/en/", label: "Home", kind: "text", attributes: { href: "/en/" } },
    { role: "footer-link-1", href: "/en/uslugi/transformacja-zakupow/", label: "Advisory", kind: "text", attributes: { href: "/en/uslugi/transformacja-zakupow/" } },
    { role: "footer-link-2", href: "/en/aplikacje-operacyjne/", label: "Applications", kind: "text", attributes: { href: "/en/aplikacje-operacyjne/" } },
    { role: "footer-link-3", href: "/en/lotnictwo/", label: "Aviation", kind: "text", attributes: { href: "/en/lotnictwo/" } },
    { role: "footer-link-4", href: "/en/case-studies/", label: "Projects", kind: "text", attributes: { href: "/en/case-studies/" } },
    { role: "footer-link-5", href: "/en/#contact", label: "Contact", kind: "text", attributes: { href: "/en/#contact" } }
  ])
});

const APPLICATION_SEMANTIC_ATTRIBUTE_MANIFEST = Object.freeze({
  pl: freezeApplicationManifest([
    { role: "site-nav", tag: "nav", attributes: { "aria-label": "Nawigacja główna" } },
    { role: "nav-current", tag: "a", attributes: { "aria-current": "page" } },
    { role: "nav-toggle", tag: "button", attributes: { "aria-label": "Menu nawigacyjne", "aria-controls": "nav-menu", "aria-expanded": "false" } },
    { role: "back-to-top", tag: "button", attributes: { "aria-label": "Wróć na górę" } },
    { role: "breadcrumb", tag: "nav", attributes: { "aria-label": "Okruszki" } },
    { role: "breadcrumb-separator", tag: "span", attributes: { "aria-hidden": "true" } },
    { role: "breadcrumb-current", tag: "span", attributes: { "aria-current": "page" } },
    { role: "problem-ledger", tag: "dl", attributes: { "aria-label": "Obszary metody" } },
    { role: "delivery-route", tag: "div", attributes: { "aria-label": "Droga do uruchomienia" } },
    { role: "fit-ledger", tag: "dl", attributes: { "aria-label": "Warunki współpracy" } },
    { role: "footer-sign", tag: "a", attributes: { "aria-label": "Paweł Mamcarz, strona główna" } },
    { role: "footer-signature", tag: "img", attributes: { alt: "" } }
  ]),
  en: freezeApplicationManifest([
    { role: "site-nav", tag: "nav", attributes: { "aria-label": "Main navigation" } },
    { role: "nav-current", tag: "a", attributes: { "aria-current": "page" } },
    { role: "nav-toggle", tag: "button", attributes: { "aria-label": "Navigation menu", "aria-controls": "nav-menu", "aria-expanded": "false" } },
    { role: "back-to-top", tag: "button", attributes: { "aria-label": "Back to top" } },
    { role: "breadcrumb", tag: "nav", attributes: { "aria-label": "Breadcrumb" } },
    { role: "breadcrumb-separator", tag: "span", attributes: { "aria-hidden": "true" } },
    { role: "breadcrumb-current", tag: "span", attributes: { "aria-current": "page" } },
    { role: "problem-ledger", tag: "dl", attributes: { "aria-label": "Method domains" } },
    { role: "delivery-route", tag: "div", attributes: { "aria-label": "Route to launch" } },
    { role: "fit-ledger", tag: "dl", attributes: { "aria-label": "Working conditions" } },
    { role: "footer-sign", tag: "a", attributes: { "aria-label": "Paweł Mamcarz, home" } },
    { role: "footer-signature", tag: "img", attributes: { alt: "" } }
  ])
});

const APPLICATION_SECTIONS = ["problem", "delivery", "evidence", "fit", "contact"];
const APPLICATION_DELIVERY_STEPS = ["discovery", "data-model", "workflow", "launch"];
const APPLICATION_SURFACES = ["aplikacje-operacyjne/index.html", "en/aplikacje-operacyjne/index.html"];

function directElementChildren(node, name = null) {
  return (node?.children ?? []).filter((child) => child.type === "element" && (name === null || child.name === name));
}

function elementIsWithin(element, ancestor) {
  for (let current = element; current?.type === "element"; current = current.parent) {
    if (current === ancestor) return true;
  }
  return false;
}

function rawElementText(element) {
  let text = "";
  const visit = (node) => {
    if (node.type === "text") text += node.value;
    else for (const child of node.children ?? []) visit(child);
  };
  visit(element);
  return text;
}

function publishedStaticText(node) {
  let text = "";
  const excluded = new Set(["script", "style", "template", "noscript"]);
  const visit = (current) => {
    if (current.type === "text") {
      text += ` ${current.value}`;
      return;
    }
    if (current.type === "element" && excluded.has(current.name)) return;
    for (const child of current.children ?? []) visit(child);
  };
  visit(node);
  return normalizeExactHtmlLiteral(text);
}

function exactStaticVisibleText(node) {
  let text = "";
  const visit = (current, ancestorHidden = false) => {
    const parent = current.parent;
    const hiddenByClosedDisclosure = parent?.type === "element"
      && parent.name === "details"
      && !parent.attributes.has("open")
      && current !== parent.children.find((child) => child.type === "element" && child.name === "summary");
    const hidden = ancestorHidden
      || hiddenByClosedDisclosure
      || (current.type === "element" && !elementIsStaticallyVisible(current));
    if (current.type === "text") {
      if (!hidden) text += current.value;
      return;
    }
    const block = current.type === "element" && blockTextElements.has(current.name);
    if (!hidden && block) text += " ";
    for (const child of current.children ?? []) visit(child, hidden);
    if (!hidden && block) text += " ";
  };
  visit(node);
  return normalizeExactHtmlLiteral(text);
}

function sameStringSet(actual, expected) {
  return actual.length === expected.length && expected.every((key) => actual.includes(key));
}

function literalContractText(parts) {
  return normalizeExactLiteral(parts.join(" "));
}

function exactElementAttributes(element, expected) {
  return element !== undefined
    && elementHasExactAttributeNames(element, new Set(Object.keys(expected)))
    && Object.entries(expected).every(([name, value]) => elementAttribute(element, name) === value);
}

const APPLICATION_USER_FACING_ATTRIBUTES = new Set([
  "alt", "label", "placeholder", "srcdoc", "title", "value"
]);

const APPLICATION_NORMALIZED_SEMANTIC_TEXT_ATTRIBUTES = new Set([
  "alt", "aria-description", "aria-label", "aria-placeholder", "aria-roledescription", "aria-valuetext",
  "label", "placeholder", "title", "value"
]);

function isApplicationSemanticAttribute(name) {
  return name.startsWith("aria-") || APPLICATION_USER_FACING_ATTRIBUTES.has(name);
}

function exactApplicationAttributes(element, expected, normalizedNames = new Set()) {
  return element !== undefined
    && elementHasExactAttributeNames(element, new Set(Object.keys(expected)))
    && Object.entries(expected).every(([name, value]) => {
      const actual = elementAttribute(element, name);
      return normalizedNames.has(name)
        ? actual !== null && normalizeExactHtmlLiteral(actual) === normalizeExactLiteral(value)
        : actual === value;
    });
}

function exactApplicationSemanticAttributes(element, expected) {
  const actual = new Map([...element.attributes].filter(([name]) => isApplicationSemanticAttribute(name)));
  return actual.size === Object.keys(expected).length
    && Object.entries(expected).every(([name, value]) => {
      if (!actual.has(name)) return false;
      const actualValue = actual.get(name) ?? "";
      return APPLICATION_NORMALIZED_SEMANTIC_TEXT_ATTRIBUTES.has(name)
        ? normalizeExactHtmlLiteral(actualValue) === normalizeExactLiteral(value)
        : decodeHtmlEntities(actualValue) === value;
    });
}

function expectedApplicationNavigationText(navigation) {
  return [
    "PM · Mamcarz.com",
    navigation.advisory,
    ...navigation.submenu.map(([, label]) => label),
    ...navigation.primary.map(([, label]) => label),
    navigation.languageLabel
  ];
}

function expectedApplicationMainText(literals) {
  return [
    ...literals.hero,
    ...APPLICATION_SECTIONS.flatMap((section) => literals.sections[section])
  ];
}

function firstDescendantWithClass(node, name, className) {
  return node === undefined || node === null
    ? undefined
    : elementDescendants(node, name).find((element) => elementHasClass(element, className));
}

function applicationAnchorRoleNodes(body, nav, main, footer) {
  const bodyChildren = directElementChildren(body);
  const navChildren = directElementChildren(nav);
  const menu = navChildren.find((element) => element.name === "ul" && elementHasClass(element, "nav-list"));
  const menuItems = directElementChildren(menu, "li");
  const advisory = directElementChildren(menuItems[0], "details")[0];
  const submenu = directElementChildren(advisory, "ul")[0];
  const submenuLinks = directElementChildren(submenu, "li").map((item) => directElementChildren(item, "a")[0]);
  const primaryLinks = menuItems.slice(1).map((item) => directElementChildren(item, "a")[0]);
  const breadcrumb = firstDescendantWithClass(main, "nav", "breadcrumb");
  const contact = main === undefined || main === null
    ? undefined
    : elementDescendants(main, "section").find((section) => elementAttribute(section, "data-section") === "contact");
  const footerLinksList = firstDescendantWithClass(footer, "ul", "footer-links");
  const footerLinks = directElementChildren(footerLinksList, "li").map((item) => directElementChildren(item, "a")[0]);
  return [
    ["skip", bodyChildren.find((element) => element.name === "a" && elementHasClass(element, "skip-link"))],
    ["nav-logo", navChildren.find((element) => element.name === "a" && elementHasClass(element, "nav-logo"))],
    ...submenuLinks.map((node, index) => [`nav-advisory-${index}`, node]),
    ...primaryLinks.map((node, index) => [`nav-primary-${index}`, node]),
    ["nav-language", navChildren.find((element) => element.name === "a" && elementHasClass(element, "nav-lang"))],
    ["breadcrumb-home", directElementChildren(breadcrumb, "a")[0]],
    ["contact-cta", contact === undefined ? undefined : elementDescendants(contact, "a").find((element) => elementHasClass(element, "btn-primary"))],
    ["footer-sign", footer === undefined || footer === null ? undefined : elementDescendants(footer, "a").find((element) => elementHasClass(element, "footer-sign"))],
    ...footerLinks.map((node, index) => [`footer-link-${index}`, node])
  ].map(([role, node]) => ({ role, node }));
}

function validApplicationAnchorLeaf(anchor, expected) {
  const semanticNames = new Set(Object.keys(expected.attributes).filter((name) => APPLICATION_NORMALIZED_SEMANTIC_TEXT_ATTRIBUTES.has(name)));
  if (anchor?.name !== "a"
    || !elementIsActiveResource(anchor)
    || !elementIsVisibleIfDisclosuresOpen(anchor)
    || elementAttribute(anchor, "href") !== expected.href
    || !exactApplicationAttributes(anchor, expected.attributes, semanticNames)
    || publishedStaticText(anchor) !== normalizeExactLiteral(expected.label)) return false;
  const children = directElementChildren(anchor);
  if (expected.kind === "text") return children.length === 0;
  if (expected.kind === "logo") {
    return children.length === 1
      && children[0].name === "b"
      && exactElementAttributes(children[0], {})
      && directElementChildren(children[0]).length === 0
      && publishedStaticText(children[0]) === "PM";
  }
  if (expected.kind === "signature") {
    const image = children[0];
    return children.length === 1
      && image?.name === "img"
      && exactApplicationAttributes(image, {
        src: "/assets/img/signature.png",
        alt: "",
        width: "160",
        loading: "lazy"
      }, new Set(["alt"]));
  }
  return false;
}

function verifyApplicationAnchorManifest(path, parsedRoot, lang, body, nav, main, footer, errors) {
  const manifest = APPLICATION_ANCHOR_MANIFEST[lang];
  const roleNodes = applicationAnchorRoleNodes(body, nav, main, footer);
  const evidenceRows = elementDescendants(parsedRoot).filter((element) => elementHasClass(element, "evidence-row"));
  const evidenceAnchors = new Set(elementDescendants(parsedRoot, "a")
    .filter((anchor) => evidenceRows.some((row) => elementIsWithin(anchor, row))));
  const actual = elementDescendants(parsedRoot, "a").filter((anchor) => !evidenceAnchors.has(anchor));
  const valid = actual.length === manifest.length
    && roleNodes.length === manifest.length
    && manifest.every((expected, index) => expected.role === roleNodes[index]?.role
      && actual[index] === roleNodes[index]?.node
      && validApplicationAnchorLeaf(actual[index], expected));
  if (!valid) {
    error(errors, "application-anchor-manifest", path, "every document anchor must match the immutable localized role, order, href, attributes and case-preserving label manifest");
  }
}

function applicationSemanticRoleNodes(body, nav, main, footer, anchorRoleNodes) {
  const navCurrent = anchorRoleNodes.find(({ role }) => role === "nav-primary-0")?.node;
  const navToggle = directElementChildren(nav, "button").find((element) => elementAttribute(element, "id") === "nav-toggle");
  const backToTop = directElementChildren(body, "button").find((element) => elementAttribute(element, "id") === "backToTop");
  const breadcrumb = firstDescendantWithClass(main, "nav", "breadcrumb");
  const breadcrumbSpans = directElementChildren(breadcrumb, "span");
  const mainSections = main === undefined || main === null ? [] : elementDescendants(main, "section");
  const problem = mainSections.find((section) => elementAttribute(section, "data-section") === "problem");
  const delivery = mainSections.find((section) => elementAttribute(section, "data-section") === "delivery");
  const fit = mainSections.find((section) => elementAttribute(section, "data-section") === "fit");
  const footerSign = anchorRoleNodes.find(({ role }) => role === "footer-sign")?.node;
  return [
    ["site-nav", nav],
    ["nav-current", navCurrent],
    ["nav-toggle", navToggle],
    ["back-to-top", backToTop],
    ["breadcrumb", breadcrumb],
    ["breadcrumb-separator", breadcrumbSpans[0]],
    ["breadcrumb-current", breadcrumbSpans[1]],
    ["problem-ledger", firstDescendantWithClass(problem, "dl", "applications-ledger")],
    ["delivery-route", firstDescendantWithClass(delivery, "div", "route-sequence")],
    ["fit-ledger", firstDescendantWithClass(fit, "dl", "applications-ledger")],
    ["footer-sign", footerSign],
    ["footer-signature", directElementChildren(footerSign, "img")[0]]
  ].map(([role, node]) => ({ role, node }));
}

function verifyApplicationSemanticAttributes(path, parsedRoot, lang, body, nav, main, footer, errors) {
  const manifest = APPLICATION_SEMANTIC_ATTRIBUTE_MANIFEST[lang];
  const anchorRoleNodes = applicationAnchorRoleNodes(body, nav, main, footer);
  const roleNodes = applicationSemanticRoleNodes(body, nav, main, footer, anchorRoleNodes);
  const actual = elementDescendants(parsedRoot).filter((element) => [...element.attributes.keys()].some(isApplicationSemanticAttribute));
  const valid = actual.length === manifest.length
    && roleNodes.length === manifest.length
    && manifest.every((expected, index) => expected.role === roleNodes[index]?.role
      && actual[index] === roleNodes[index]?.node
      && actual[index]?.name === expected.tag
      && exactApplicationSemanticAttributes(actual[index], expected.attributes));
  if (!valid) {
    error(errors, "application-semantic-attributes", path, "every user-facing, accessibility, reference and state attribute must match the immutable localized semantic manifest");
  }
}

function verifyApplicationMetadata(path, parsedRoot, lang, errors) {
  const page = APPLICATION_PAGE_CONTRACT[lang];
  const literals = APPLICATION_LITERAL_CONTRACT[lang];
  const heads = elementDescendants(parsedRoot, "head");
  const head = heads.length === 1 ? heads[0] : null;
  const expectedMetas = [
    { charset: "UTF-8" },
    { name: "viewport", content: "width=device-width, initial-scale=1.0" },
    { name: "description", content: page.description },
    { name: "author", content: "Paweł Mamcarz" },
    { name: "robots", content: "index, follow" },
    { property: "og:title", content: literals.documentTitle },
    { property: "og:description", content: page.description },
    { property: "og:type", content: "website" },
    { property: "og:url", content: page.url },
    { property: "og:image", content: "https://mamcarz.com/assets/img/og.jpg" },
    { property: "og:image:alt", content: literals.documentTitle },
    { property: "og:locale", content: literals.locale },
    { property: "og:site_name", content: "Paweł Mamcarz" }
  ];
  const titles = head === null ? [] : directElementChildren(head, "title").filter(elementIsActiveResource);
  const metas = head === null ? [] : directElementChildren(head, "meta").filter(elementIsActiveResource);
  const valid = head !== null
    && titles.length === 1
    && normalizeExactHtmlLiteral(rawElementText(titles[0])) === normalizeExactLiteral(literals.documentTitle)
    && metas.length === expectedMetas.length
    && metas.every((meta, index) => exactApplicationAttributes(meta, expectedMetas[index], new Set(["content"])));
  if (!valid) {
    error(errors, "application-metadata", path, "requires the exact claim-safe Task 2 title and metadata set");
  }
}

function verifyApplicationNavigation(path, parsedRoot, lang, errors) {
  const expected = APPLICATION_LITERAL_CONTRACT[lang].navigation;
  const elements = elementDescendants(parsedRoot);
  const navs = elements.filter((element) => element.name === "nav" && elementHasClass(element, "site-nav") && pageElementIsActive(element));
  const nav = navs.length === 1 ? navs[0] : null;
  const overlays = elements.filter((element) => element.name === "div" && elementHasClass(element, "nav-overlay") && pageElementIsActive(element));
  const children = directElementChildren(nav);
  const logo = children[0];
  const menu = children[1];
  const language = children[2];
  const toggle = children[3];
  const menuItems = directElementChildren(menu, "li");
  const advisoryDetails = directElementChildren(menuItems[0], "details");
  const advisory = advisoryDetails.length === 1 ? advisoryDetails[0] : null;
  const summaries = directElementChildren(advisory, "summary");
  const submenus = directElementChildren(advisory, "ul");
  const submenu = submenus.length === 1 ? submenus[0] : null;
  const submenuItems = directElementChildren(submenu, "li");
  const submenuLinks = submenuItems.map((item) => directElementChildren(item, "a"));
  const primaryLinks = menuItems.slice(1).map((item) => directElementChildren(item, "a"));
  const toggleSpans = directElementChildren(toggle, "span");
  const validSubmenu = submenuItems.length === expected.submenu.length
    && submenuLinks.every((links, index) => links.length === 1
      && elementIsVisibleIfDisclosuresOpen(links[0])
      && elementIsActiveResource(links[0])
      && exactElementAttributes(links[0], { href: expected.submenu[index][0] })
      && publishedStaticText(links[0]) === normalizeExactLiteral(expected.submenu[index][1]));
  const validPrimary = primaryLinks.length === expected.primary.length
    && primaryLinks.every((links, index) => {
      if (links.length !== 1 || !elementIsVisibleIfDisclosuresOpen(links[0]) || !elementIsActiveResource(links[0])) return false;
      const [href, label, current] = expected.primary[index];
      const attributes = current ? { href, "aria-current": "page" } : { href };
      return exactApplicationAttributes(links[0], attributes)
        && exactStaticVisibleText(links[0]) === normalizeExactLiteral(label);
    });
  const valid = nav !== null
    && overlays.length === 1
    && exactElementAttributes(overlays[0], { class: "nav-overlay", id: "nav-overlay" })
    && exactApplicationAttributes(nav, { class: "site-nav", "aria-label": expected.ariaLabel }, new Set(["aria-label"]))
    && children.length === 4
    && logo?.name === "a"
    && pageElementIsActive(logo)
    && exactElementAttributes(logo, { href: expected.logoHref, class: "nav-logo" })
    && exactStaticVisibleText(logo) === normalizeExactLiteral("PM · Mamcarz.com")
    && menu?.name === "ul"
    && elementIsVisibleIfDisclosuresOpen(menu)
    && elementIsActiveResource(menu)
    && exactElementAttributes(menu, { class: "nav-list", id: "nav-menu" })
    && menuItems.length === expected.primary.length + 1
    && advisory !== null
    && elementIsVisibleIfDisclosuresOpen(advisory)
    && elementIsActiveResource(advisory)
    && exactElementAttributes(advisory, { class: "nav-group" })
    && summaries.length === 1
    && exactElementAttributes(summaries[0], {})
    && exactStaticVisibleText(summaries[0]) === normalizeExactLiteral(expected.advisory)
    && submenu !== null
    && exactElementAttributes(submenu, { class: "nav-submenu" })
    && validSubmenu
    && validPrimary
    && language?.name === "a"
    && pageElementIsActive(language)
    && exactElementAttributes(language, { href: expected.languageHref, class: "nav-lang" })
    && exactStaticVisibleText(language) === normalizeExactLiteral(expected.languageLabel)
    && toggle?.name === "button"
    && pageElementIsActive(toggle)
    && exactApplicationAttributes(toggle, {
      class: "nav-toggle",
      id: "nav-toggle",
      "aria-label": expected.toggleLabel,
      "aria-controls": "nav-menu",
      "aria-expanded": "false"
    }, new Set(["aria-label"]))
    && directElementChildren(toggle).length === 3
    && toggleSpans.length === 3
    && toggleSpans.every((span) => exactElementAttributes(span, {}) && exactStaticVisibleText(span) === "")
    && publishedStaticText(nav) === literalContractText(expectedApplicationNavigationText(expected));
  if (!valid) {
    error(errors, "application-navigation", path, "requires the exact localized v2 application navigation, native Advisory disclosure, active route and mobile toggle");
  }
  return nav;
}

function verifyApplicationShellCopy(path, parsedRoot, lang, main, nav, errors) {
  const literals = APPLICATION_LITERAL_CONTRACT[lang];
  const all = elementDescendants(parsedRoot);
  const bodies = all.filter((element) => element.name === "body");
  const body = bodies.length === 1 ? bodies[0] : null;
  const children = directElementChildren(body);
  const [skip, shellNav, overlay, back, shellMain, footer, script] = children;
  const footerLinks = footer === undefined ? [] : elementDescendants(footer, "a").filter(pageElementIsActive);
  const validFooter = footer?.name === "footer"
    && pageElementIsActive(footer)
    && exactElementAttributes(footer, { class: "site-footer" })
    && footerLinks.length === literals.footerLinks.length + 1
    && footerLinks.slice(1).every((link, index) => exactElementAttributes(link, { href: literals.footerLinks[index][0] })
      && exactStaticVisibleText(link) === normalizeExactLiteral(literals.footerLinks[index][1]))
    && publishedStaticText(footer) === literalContractText(literals.footer);
  const expectedBodyText = [
    literals.skip,
    ...expectedApplicationNavigationText(literals.navigation),
    "↑",
    ...expectedApplicationMainText(literals),
    ...literals.footer
  ];
  const valid = body !== null
    && exactElementAttributes(body, { class: "applications-page", "data-page": "applications" })
    && children.length === 7
    && skip?.name === "a"
    && pageElementIsActive(skip)
    && exactElementAttributes(skip, { href: "#main", class: "skip-link" })
    && exactStaticVisibleText(skip) === normalizeExactLiteral(literals.skip)
    && shellNav === nav
    && overlay?.name === "div"
    && pageElementIsActive(overlay)
    && exactElementAttributes(overlay, { class: "nav-overlay", id: "nav-overlay" })
    && publishedStaticText(overlay) === ""
    && back?.name === "button"
    && pageElementIsActive(back)
    && exactApplicationAttributes(back, { class: "back-to-top", id: "backToTop", "aria-label": literals.backLabel }, new Set(["aria-label"]))
    && exactStaticVisibleText(back) === normalizeExactLiteral("↑")
    && shellMain === main
    && validFooter
    && script?.name === "script"
    && elementIsActiveResource(script)
    && publishedStaticText(body) === literalContractText(expectedBodyText);
  if (!valid) {
    error(errors, "application-shell-copy", path, "requires the exact claim-safe v2 body and footer shell with no additional page-owned copy");
  }
}

function validApplicationLiteralLeaf(element, literal, approvedUrls) {
  if (element === undefined || publishedStaticText(element) !== normalizeExactLiteral(literal)) return false;
  const children = directElementChildren(element);
  if (children.length === 0) return true;
  if (children.length !== 1 || children[0].name !== "a") return false;
  const link = children[0];
  return pageElementIsActive(link)
    && exactElementAttributes(link, { href: elementAttribute(link, "href") })
    && approvedUrls.has(elementAttribute(link, "href"))
    && directElementChildren(link).length === 0
    && publishedStaticText(link) === normalizeExactLiteral(literal);
}

function verifyApplicationSchema(path, parsedRoot, lang, errors) {
  const expected = APPLICATION_PAGE_CONTRACT[lang];
  const scripts = elementDescendants(parsedRoot, "script")
    .filter((script) => normalize(elementAttribute(script, "type") ?? "") === "application/ld+json");
  const heads = elementDescendants(parsedRoot, "head");
  const script = scripts[0];
  const validLocation = scripts.length === 1
    && heads.length === 1
    && script?.parent === heads[0]
    && elementIsActiveResource(script)
    && elementHasExactAttributeNames(script, new Set(["type"]));
  let schema = null;
  if (validLocation) {
    try {
      schema = JSON.parse(rawElementText(script));
    } catch {
      schema = null;
    }
  }
  const keys = isPlainObject(schema) ? Object.keys(schema) : [];
  const provider = isPlainObject(schema?.provider) ? schema.provider : null;
  const valid = validLocation
    && isPlainObject(schema)
    && sameStringSet(keys, ["@context", "@type", "name", "url", "description", "provider"])
    && schema["@context"] === "https://schema.org"
    && schema["@type"] === "Service"
    && sameExactLiteral(schema.name, expected.title)
    && schema.url === expected.url
    && sameExactLiteral(schema.description, expected.description)
    && provider !== null
    && sameStringSet(Object.keys(provider), ["@type", "name"])
    && provider["@type"] === "Person"
    && sameExactLiteral(provider.name, "Paweł Mamcarz");
  if (!valid) {
    error(errors, "application-schema", path, "requires one direct purpose-only Service JSON-LD object with the localized page identity and Paweł Mamcarz as provider");
  }
}

function verifyApplicationPage(path, parsedRoot, lang, factData, errors) {
  const expected = APPLICATION_PAGE_CONTRACT[lang];
  const literals = APPLICATION_LITERAL_CONTRACT[lang];
  const all = elementDescendants(parsedRoot);
  const active = all.filter(pageElementIsActive);
  verifyApplicationMetadata(path, parsedRoot, lang, errors);
  const applicationNav = verifyApplicationNavigation(path, parsedRoot, lang, errors);
  if (active.some((element) => element.attributes.has("style"))) {
    error(errors, "application-inline-style", path, "active application-page elements must not use inline style");
  }
  const bodies = all.filter((element) => element.name === "body");
  const body = bodies.length === 1 ? bodies[0] : null;
  if (body === null || elementAttribute(body, "data-page") !== "applications") {
    error(errors, "application-data-page", path, 'body must use data-page="applications"');
  }

  const mains = active.filter((element) => element.name === "main" && elementAttribute(element, "id") === "main");
  const main = mains.length === 1 ? mains[0] : null;
  const skipLinks = active.filter((element) => element.name === "a" && elementHasClass(element, "skip-link") && elementAttribute(element, "href") === "#main");
  const overlays = active.filter((element) => element.name === "div" && elementHasClass(element, "nav-overlay") && elementAttribute(element, "id") === "nav-overlay");
  const footers = active.filter((element) => element.name === "footer" && elementHasClass(element, "site-footer"));
  if (main === null
    || elementAttribute(main, "tabindex") !== "-1"
    || skipLinks.length !== 1
    || overlays.length !== 1
    || footers.length !== 1) {
    error(errors, "application-shell", path, "requires the shared skip link, main focus target, nav overlay and site footer");
  }
  const applicationFooter = footers.length === 1 ? footers[0] : null;
  verifyApplicationAnchorManifest(path, parsedRoot, lang, body, applicationNav, main, applicationFooter, errors);
  verifyApplicationSemanticAttributes(path, parsedRoot, lang, body, applicationNav, main, applicationFooter, errors);

  const heroes = main === null
    ? []
    : directElementChildren(main, "header").filter((element) => elementHasClass(element, "page-hero") && pageElementIsActive(element));
  const hero = heroes.length === 1 ? heroes[0] : null;
  const headings = main === null ? [] : elementDescendants(main, "h1").filter(pageElementIsActive);
  if (hero === null
    || headings.length !== 1
    || !elementIsWithin(headings[0], hero)
    || exactStaticVisibleText(headings[0]) !== normalizeExactLiteral(expected.title)) {
    error(errors, "application-h1", path, `requires exact localized h1: ${expected.title}`);
  }
  const leads = main === null
    ? []
    : elementDescendants(main).filter((element) => elementHasClass(element, "page-lead") && pageElementIsActive(element));
  if (hero === null
    || leads.length !== 1
    || !elementIsWithin(leads[0], hero)
    || exactStaticVisibleText(leads[0]) !== normalizeExactLiteral(expected.lead)) {
    error(errors, "application-lead", path, "requires the exact localized opening lead in the page hero");
  }

  const sectionMarkers = main === null
    ? []
    : elementDescendants(main).filter((element) => element.attributes.has("data-section"));
  const directSections = main === null ? [] : directElementChildren(main, "section");
  const sectionNames = sectionMarkers.map((section) => elementAttribute(section, "data-section"));
  const validSections = sectionMarkers.length === APPLICATION_SECTIONS.length
    && directSections.length === APPLICATION_SECTIONS.length
    && sectionMarkers.every((section) => section.name === "section" && section.parent === main && pageElementIsActive(section))
    && sectionMarkers.every((section, index) => section === directSections[index])
    && sectionNames.every((name, index) => name === APPLICATION_SECTIONS[index]);
  if (!validSections) {
    error(errors, "application-sections", path, `requires exactly these five direct visible sections in order: ${APPLICATION_SECTIONS.join(", ")}`);
  }
  const sectionByName = new Map(sectionMarkers.map((section) => [elementAttribute(section, "data-section"), section]));
  const directMainElements = directElementChildren(main);
  const exactSectionCopy = APPLICATION_SECTIONS.every((section) => {
    const element = sectionByName.get(section);
    return element !== undefined && publishedStaticText(element) === literalContractText(literals.sections[section]);
  });
  const validContent = hero !== null
    && publishedStaticText(hero) === literalContractText(literals.hero)
    && directMainElements.length === APPLICATION_SECTIONS.length + 1
    && directMainElements[0] === hero
    && APPLICATION_SECTIONS.every((section, index) => directMainElements[index + 1] === sectionByName.get(section))
    && exactSectionCopy
    && publishedStaticText(main) === literalContractText(expectedApplicationMainText(literals));
  if (!validContent) {
    error(errors, "application-content", path, "requires the exact owner-approved Task 2 main copy and direct structure with no additions");
  }

  const delivery = sectionByName.get("delivery");
  const routeSequences = active.filter((element) => elementHasClass(element, "route-sequence"));
  const routeSequence = routeSequences.length === 1 ? routeSequences[0] : null;
  const deliverySteps = routeSequence === null
    ? []
    : elementDescendants(routeSequence).filter((element) => elementHasClass(element, "route-sequence__step"));
  const validDelivery = delivery !== undefined
    && routeSequence !== null
    && elementIsWithin(routeSequence, delivery)
    && pageElementIsActive(routeSequence)
    && deliverySteps.length === APPLICATION_DELIVERY_STEPS.length
    && deliverySteps.every((step, index) => step.parent === routeSequence
      && pageElementIsActive(step)
      && elementAttribute(step, "data-step") === APPLICATION_DELIVERY_STEPS[index]
      && elementDescendants(step, "h3").filter(pageElementIsActive).length === 1
      && exactStaticVisibleText(elementDescendants(step, "h3").filter(pageElementIsActive)[0]) === normalizeExactLiteral(expected.deliveryLabels[index]));
  if (!validDelivery) {
    error(errors, "application-delivery", path, "route sequence must be Discovery, data model, workflow and launch");
  }

  verifyApplicationSchema(path, parsedRoot, lang, errors);

  const records = Array.isArray(factData.facts) ? factData.facts.filter(isPlainObject) : [];
  const factsById = new Map(records.filter((fact) => nonEmptyString(fact.id)).map((fact) => [fact.id, fact]));
  const evidenceSection = sectionByName.get("evidence");
  const evidenceRows = main === null
    ? []
    : elementDescendants(main).filter((element) => elementHasClass(element, "evidence-row"));
  const orderedEvidence = [];
  const usedEvidenceIds = new Set();
  let exactEvidenceContract = evidenceRows.length === APPLICATION_EVIDENCE_CONTRACT.length;
  let validEvidenceLinks = true;
  if (evidenceRows.length === 0
    || evidenceSection === undefined
    || evidenceRows.some((row) => !pageElementIsActive(row) || !elementIsWithin(row, evidenceSection))) {
    error(errors, "application-evidence-ids", path, "requires visible evidence rows inside the evidence section");
  }
  for (const [index, row] of evidenceRows.entries()) {
    const immutable = APPLICATION_EVIDENCE_CONTRACT[index];
    const immutableCopy = immutable?.[lang];
    const rawIds = elementAttribute(row, "data-fact-ids");
    const ids = nonEmptyString(rawIds) ? rawIds.trim().split(/\s+/).filter(Boolean) : [];
    orderedEvidence.push(ids);
    if (ids.length === 0
      || new Set(ids).size !== ids.length
      || ids.some((factId) => usedEvidenceIds.has(factId))) {
      error(errors, "application-evidence-ids", path, "every evidence row needs unique exact data-fact-ids tokens");
    }
    for (const factId of ids) usedEvidenceIds.add(factId);
    const rowText = exactStaticVisibleText(row);
    for (const factId of ids) {
      const fact = factsById.get(factId);
      if (!fact || fact.status !== "approved") {
        error(errors, "application-evidence-ids", path, `${factId} must identify an approved fact`);
        continue;
      }
      if (!Array.isArray(fact.surfaces) || APPLICATION_SURFACES.some((surface) => !fact.surfaces.includes(surface))) {
        error(errors, "application-evidence-surface", path, `${factId} must approve both application page surfaces`);
      }
      const display = lang === "pl" ? fact.display_pl : fact.display_en;
      if (!nonEmptyString(display) || !rowText.includes(normalizeExactLiteral(display))) {
        error(errors, "application-evidence-value", path, `${factId} must render its exact localized display meaning in the annotated row`);
      }
    }
    const approvedUrls = new Set(ids.flatMap((factId) => records
      .filter((fact) => fact.id === factId && fact.status === "approved" && isHttpUrl(fact.source_url))
      .map((fact) => fact.source_url)));
    const rowLinks = elementDescendants(row, "a");
    if (rowLinks.some((link) => !pageElementIsActive(link) || !approvedUrls.has(elementAttribute(link, "href")))) {
      validEvidenceLinks = false;
    }
    const rowChildren = directElementChildren(row);
    const context = rowChildren[0];
    const title = rowChildren[1];
    const ledger = rowChildren[2];
    const ledgerRows = directElementChildren(ledger, "div");
    const ledgerLeaves = directElementChildren(ledgerRows[0]);
    const registryName = immutable === undefined ? [] : records.filter((fact) => fact.id === immutable.ids[0]);
    const registryMeaning = immutable === undefined ? [] : records.filter((fact) => fact.id === immutable.ids[1]);
    const exactRegistry = immutable !== undefined
      && registryName.length === 1
      && registryMeaning.length === 1
      && registryName[0].status === "approved"
      && registryMeaning[0].status === "approved"
      && sameExactLiteral(registryName[0].display_pl, immutable.pl.name)
      && sameExactLiteral(registryName[0].display_en, immutable.en.name)
      && sameExactLiteral(registryMeaning[0].display_pl, immutable.pl.meaning)
      && sameExactLiteral(registryMeaning[0].display_en, immutable.en.meaning)
      && APPLICATION_SURFACES.every((surface) => registryName[0].surfaces?.includes(surface) && registryMeaning[0].surfaces?.includes(surface));
    exactEvidenceContract = exactEvidenceContract
      && immutable !== undefined
      && immutableCopy !== undefined
      && rawIds === immutable.ids.join(" ")
      && exactElementAttributes(row, { class: "evidence-row", "data-fact-ids": immutable.ids.join(" ") })
      && rowChildren.length === 3
      && context?.name === "p"
      && exactElementAttributes(context, { class: "evidence-row__context" })
      && directElementChildren(context).length === 0
      && publishedStaticText(context) === normalizeExactLiteral(immutableCopy.context)
      && title?.name === "h3"
      && exactElementAttributes(title, { class: "evidence-row__title" })
      && validApplicationLiteralLeaf(title, immutableCopy.name, approvedUrls)
      && ledger?.name === "dl"
      && exactElementAttributes(ledger, { class: "evidence-row__ledger" })
      && ledgerRows.length === 1
      && exactElementAttributes(ledgerRows[0], {})
      && ledgerLeaves.length === 2
      && ledgerLeaves[0].name === "dt"
      && exactElementAttributes(ledgerLeaves[0], {})
      && directElementChildren(ledgerLeaves[0]).length === 0
      && publishedStaticText(ledgerLeaves[0]) === normalizeExactLiteral(immutableCopy.label)
      && ledgerLeaves[1].name === "dd"
      && exactElementAttributes(ledgerLeaves[1], {})
      && validApplicationLiteralLeaf(ledgerLeaves[1], immutableCopy.meaning, approvedUrls)
      && exactRegistry;
  }
  if (!exactEvidenceContract) {
    error(errors, "application-evidence-contract", path, "requires the immutable ordered three-row, six-ID Task 2 evidence contract and exact registry literals");
  }
  if (!validEvidenceLinks) {
    error(errors, "application-evidence-link", path, "evidence links must exactly match a non-null approved source_url on an associated fact");
  }

  const contactSection = sectionByName.get("contact");
  const primaryCtas = active.filter((element) => elementHasClass(element, "btn-primary"));
  if (contactSection === undefined
    || primaryCtas.length !== 1
    || primaryCtas[0].name !== "a"
    || !elementIsWithin(primaryCtas[0], contactSection)
    || elementAttribute(primaryCtas[0], "href") !== expected.contactHref) {
    error(errors, "application-contact", path, "requires one localized primary mailto CTA inside contact");
  }

  const published = body === null ? "" : publishedStaticText(body);
  const publishedForScan = normalize(published);
  const genericPositioning = ["software house", "dom programistycz", "zespół programistycz", "team of developers", "development agency"];
  if (genericPositioning.some((candidate) => publishedForScan.includes(candidate))) {
    error(errors, "application-positioning", path, "must not position the service as a generic software house");
  }
  const forbiddenCopy = ["—", "nie tylko", "not just", "kompleksow", "comprehensive", "innowacyjn", "innovative", "realnie", "seamless", "unlock", "leverage", "polpharma"];
  if (forbiddenCopy.some((candidate) => publishedForScan.includes(candidate))) {
    error(errors, "application-copy", path, "contains forbidden review, client or generic AI-style copy");
  }
  for (const fact of records.filter((record) => record.status === "review" || record.status === "retired")) {
    const candidate = factStatusCandidates(fact, path).find((value) => publishedForScan.includes(normalize(value)));
    if (candidate) error(errors, "application-fact-status", path, `${fact.id} has status ${fact.status} but publishes ${candidate}`);
  }

  verifyApplicationShellCopy(path, parsedRoot, lang, main, applicationNav, errors);

  return orderedEvidence;
}

function verifyApplicationParity(plEvidence, enEvidence, errors) {
  if (JSON.stringify(plEvidence) !== JSON.stringify(enEvidence)) {
    error(errors, "application-evidence-parity", "aplikacje-operacyjne/index.html", "PL and EN must use the same ordered evidence fact IDs");
  }
}

function routeToFile(urlPath) {
  const clean = urlPath.split(/[?#]/)[0];
  if (clean === "/") return "index.html";
  if (clean.endsWith("/")) return `${clean.slice(1)}index.html`;
  return clean.slice(1);
}

function trimBrowserUrlWhitespace(value) {
  if (typeof value !== "string") return null;
  return value.replace(/^[\u0009-\u000d\u0020]+|[\u0009-\u000d\u0020]+$/g, "");
}

function browserNormalizedUrl(value) {
  return typeof value === "string" ? trimBrowserUrlWhitespace(decodeHtmlEntities(value)) : null;
}

function srcsetCandidateUrls(value) {
  const input = decodeHtmlEntities(value);
  const urls = [];
  let cursor = 0;
  const isWhitespace = (character) => character !== undefined && /[\u0009-\u000d\u0020]/.test(character);
  while (cursor < input.length) {
    while (cursor < input.length && (isWhitespace(input[cursor]) || input[cursor] === ",")) cursor += 1;
    if (cursor >= input.length) break;

    const urlStart = cursor;
    while (cursor < input.length && !isWhitespace(input[cursor])) cursor += 1;
    let url = input.slice(urlStart, cursor);
    if (url.endsWith(",")) {
      url = url.replace(/,+$/, "");
      if (url.length > 0) urls.push(url);
      continue;
    }
    urls.push(url);

    let parentheses = 0;
    while (cursor < input.length) {
      const character = input[cursor];
      if (character === "(") parentheses += 1;
      else if (character === ")" && parentheses > 0) parentheses -= 1;
      else if (character === "," && parentheses === 0) {
        cursor += 1;
        break;
      }
      cursor += 1;
    }
  }
  return urls;
}

function rootRelativeReference(value) {
  return nonEmptyString(value) && value.startsWith("/") && !value.startsWith("//");
}

function elementLocalReferences(element) {
  const references = [];
  for (const attribute of ["href", "src"]) {
    const value = browserNormalizedUrl(elementAttribute(element, attribute));
    if (rootRelativeReference(value)) references.push({ attribute, url: value });
  }
  const srcset = elementAttribute(element, "srcset");
  if (nonEmptyString(srcset)) {
    for (const value of srcsetCandidateUrls(srcset)) {
      if (rootRelativeReference(value)) references.push({ attribute: "srcset", url: value });
    }
  }
  return references;
}

function defersMissingRoute(targetFile, family) {
  const ownerFamily = ROUTE_FILE_FAMILIES.get(targetFile);
  return family !== "all" && ownerFamily !== undefined && ownerFamily !== family;
}

async function verifyLocalLinks(path, parsedRoot, family, context) {
  const references = elementDescendants(parsedRoot)
    .filter(elementIsActiveResource)
    .flatMap(elementLocalReferences);
  const checked = new Set();
  for (const reference of references) {
    const targetFile = routeToFile(reference.url);
    if (!nonEmptyString(targetFile) || checked.has(targetFile)) continue;
    checked.add(targetFile);
    const targetPath = resolve(context.root, targetFile);
    const relativeTarget = relative(context.root, targetPath);
    if (relativeTarget.startsWith("..") || isAbsolute(relativeTarget)) {
      error(context.errors, "local-target", path, `${reference.attribute} ${reference.url} escapes the site root`);
      continue;
    }
    try {
      const targetStat = await stat(targetPath);
      if (!targetStat.isFile()) throw Object.assign(new Error("target is not a file"), { code: "NOT_FILE" });
    } catch (cause) {
      if (cause.code === "ENOENT" && defersMissingRoute(targetFile, family)) continue;
      error(context.errors, "local-target", path, `${reference.attribute} ${reference.url} maps to missing ${targetFile} (${cause.code ?? cause.message})`);
    }
  }
}

function addDeferred(context, contract) {
  if (!context.deferred.includes(contract)) context.deferred.push(contract);
}

async function verifyProcurementParent(_factData, context) {
  // Task 7 owns the substantive PL-only parent-page contract.
  addDeferred(context, "procurement-parent-contract");
}

async function verifyArtifacts(_factData, context) {
  // Task 8 owns the five artifact files and their substantive contract.
  addDeferred(context, "artifacts-contract");
}

async function verifyPages(factData, family, context) {
  const selectedPairs = ROUTE_PAIRS.filter((pair) => family === "all" || pair[4] === family);
  for (const [plFile, enFile, plRoute, enRoute, routeFamily] of selectedPairs) {
    const pl = await readRequired(context, plFile, "route-file");
    const en = await readRequired(context, enFile, "route-file");
    const plRoot = verifyPageShell(plFile, pl, "pl", plRoute, enRoute, context.errors);
    const enRoot = verifyPageShell(enFile, en, "en", enRoute, plRoute, context.errors);
    verifyFactIds(plFile, plRoot, factData, context.errors);
    verifyFactIds(enFile, enRoot, factData, context.errors);
    if (routeFamily === "applications") {
      const plEvidence = verifyApplicationPage(plFile, plRoot, "pl", factData, context.errors);
      const enEvidence = verifyApplicationPage(enFile, enRoot, "en", factData, context.errors);
      verifyApplicationParity(plEvidence, enEvidence, context.errors);
    }
    await verifyLocalLinks(plFile, plRoot, family, context);
    await verifyLocalLinks(enFile, enRoot, family, context);
  }
  if (family === "speaking" || family === "all") await verifyProcurementParent(factData, context);
  if (family === "artifacts" || family === "all") await verifyArtifacts(factData, context);
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

export async function runVerification({ root = defaultRoot, scope = "all", lang = "all", family = "all", familyOptionCount = 1 } = {}) {
  const errors = [];
  const deferred = [];
  const context = { root, scope, lang, family, errors, deferred };
  if (!["all", "pl", "en"].includes(lang)) error(errors, "cli-lang", "scripts/verify-site.mjs", `unsupported language ${lang}`);
  if (!["all", "facts", "foundation", "home", "pages"].includes(scope)) error(errors, "cli-scope", "scripts/verify-site.mjs", `unsupported scope ${scope}`);
  const repeatedFamilyOption = !Number.isInteger(familyOptionCount) || familyOptionCount < 0 || familyOptionCount > 1;
  const validFamily = !repeatedFamilyOption && typeof family === "string" && VALID_FAMILIES.has(family);
  if (repeatedFamilyOption) error(errors, "cli-family", "scripts/verify-site.mjs", `family option must be supplied at most once; found ${familyOptionCount}`);
  else if (!validFamily) error(errors, "cli-family", "scripts/verify-site.mjs", `unsupported family ${family}`);
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
  if (scope === "pages" && validFamily) await verifyPages(facts, family, context);
  return { facts, errors, deferred };
}

async function cli() {
  const scope = process.argv.find((arg) => arg.startsWith("--scope="))?.split("=")[1] ?? "all";
  const lang = process.argv.find((arg) => arg.startsWith("--lang="))?.split("=")[1] ?? "all";
  const familyPrefix = "--family=";
  const familyArgs = process.argv.filter((arg) => arg === "--family" || arg.startsWith(familyPrefix));
  const family = familyArgs.length === 0 ? "all" : familyArgs[0].startsWith(familyPrefix) ? familyArgs[0].slice(familyPrefix.length) : "";
  const result = await runVerification({ scope, lang, family, familyOptionCount: familyArgs.length });
  const deferredLabel = result.deferred.length > 0 ? `; deferred: ${result.deferred.join(", ")}` : "";
  if (result.errors.length) {
    console.error(result.errors.join("\n"));
    if (result.deferred.length > 0) console.error(`DEFERRED ${result.deferred.join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log(`OK site verification (${scope}${deferredLabel})`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await cli();
