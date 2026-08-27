import { readFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
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
const unsupportedLlmsFullClauses = Object.freeze([
  "CEE's largest insurer",
  "spend analytics, category strategies, TOM, IT platform selection",
  "currently Cloudflare, React, and custom web projects"
]);
// These exact stylesheet bytes received the Task 10 browser, viewport and interaction review.
// Without a browser engine, a partial cascade model is unsound: any CSS byte change must trigger
// renewed visual/cascade review followed by an explicit digest baseline refresh.
const TASK10_REVIEWED_CSS_SHA256 = "139ad09341eb2c4160622391a79eab7ca6c6896d141eef4022396d17b450055d";
const PROJECT_SURFACES = Object.freeze(["case-studies/index.html", "en/case-studies/index.html"]);
const SPEAKING_SURFACES = Object.freeze(["wystapienia/index.html", "en/wystapienia/index.html"]);

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
  let sourceAttributeCount = 0;
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
    sourceAttributeCount += 1;
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
  Object.defineProperty(attributes, "sourceAttributeCount", { value: sourceAttributeCount });
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

function inspectHtmlStartTagSyntax(source) {
  const tagName = /^<([a-z][a-z0-9:-]*)/i.exec(source);
  if (!tagName) return { valid: false, selfClosing: false };
  let cursor = tagName[0].length;
  while (cursor < source.length) {
    const whitespaceStart = cursor;
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;
    if (source[cursor] === ">") return { valid: cursor === source.length - 1, selfClosing: false };
    if (source[cursor] === "/" && source[cursor + 1] === ">") {
      return { valid: cursor + 2 === source.length, selfClosing: true };
    }
    if (cursor === whitespaceStart) return { valid: false, selfClosing: false };

    const nameStart = cursor;
    while (cursor < source.length && !/[\s"'<>/=]/.test(source[cursor])) cursor += 1;
    if (cursor === nameStart) return { valid: false, selfClosing: false };
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;
    if (source[cursor] !== "=") continue;

    cursor += 1;
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;
    const quote = source[cursor];
    if (quote === "\"" || quote === "'") {
      cursor += 1;
      while (cursor < source.length && source[cursor] !== quote) {
        if (source[cursor] === "<") return { valid: false, selfClosing: false };
        cursor += 1;
      }
      if (source[cursor] !== quote) return { valid: false, selfClosing: false };
      cursor += 1;
      continue;
    }

    const valueStart = cursor;
    while (cursor < source.length && !/[\s"'`=<>]/.test(source[cursor])) cursor += 1;
    if (cursor === valueStart) return { valid: false, selfClosing: false };
  }
  return { valid: false, selfClosing: false };
}

function parsedTag(openingTag) {
  const match = /^<(\/?)([a-z][a-z0-9:-]*)\b/i.exec(openingTag);
  if (!match) return null;
  const name = match[2].toLowerCase();
  const closing = match[1] === "/";
  const startTagSyntax = closing ? null : inspectHtmlStartTagSyntax(openingTag);
  const sourceSelfClosing = closing ? /\/\s*>$/.test(openingTag) : startTagSyntax.selfClosing;
  const isVoid = voidHtmlElements.has(name);
  return {
    name,
    closing,
    isVoid,
    sourceSelfClosing,
    validSyntax: closing || startTagSyntax.valid,
    selfClosing: isVoid,
    attributes: closing ? new Map() : openingTagAttributes(openingTag)
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
      if (cursor < html.length) append({ type: "text", value: html.slice(cursor), offset: cursor });
      break;
    }
    if (opening > cursor) append({ type: "text", value: html.slice(cursor, opening), offset: cursor });
    if (html.startsWith("<!--", opening)) {
      const commentEnd = html.indexOf("-->", opening + 4);
      if (commentEnd === -1) {
        errors.push(`unterminated comment at offset ${opening}`);
        cursor = html.length;
        break;
      }
      append({
        type: "comment",
        value: html.slice(opening + 4, commentEnd),
        source: html.slice(opening, commentEnd + 3),
        offset: opening
      });
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
      append({ type: "doctype", source, offset: opening });
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
      if (tag.sourceSelfClosing || !/^<\/[a-z][a-z0-9:-]*\s*>$/i.test(source)) {
        errors.push(`malformed closing tag </${tag.name}> at offset ${opening}`);
      }
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
    if (!tag.validSyntax) errors.push(`malformed opening tag <${tag.name}> at offset ${opening}`);
    if (tag.sourceSelfClosing && !tag.isVoid) {
      errors.push(`non-void element <${tag.name}> cannot use self-closing syntax at offset ${opening}`);
    }
    const node = {
      type: "element",
      name: tag.name,
      attributes: tag.attributes,
      children: [],
      parent: null,
      source,
      offset: opening
    };
    append(node);
    cursor = tagEnd + 1;
    if (rawTextElements.has(tag.name) && !tag.selfClosing) {
      const closing = new RegExp(`<\\/${escapeRegExp(tag.name)}\\s*>`, "ig");
      closing.lastIndex = cursor;
      const match = closing.exec(html);
      if (!match) {
        errors.push(`unterminated raw-text element <${tag.name}> at offset ${opening}`);
        cursor = html.length;
        break;
      }
      const rawText = { type: "text", value: html.slice(cursor, match.index), parent: node, offset: cursor };
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
    ["/en/aplikacje-operacyjne/", "Applications"],
    ["/en/lotnictwo/", "Aviation"],
    ["/en/case-studies/", "Projects"],
    ["/en/wiedza/", "Insights"],
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
    ? { navPath: "/case-studies/", footerPath: "/case-studies/", label: "Projekty", errorId: "home-pl-ia", language: "Polish" }
    : { navPath: "/en/case-studies/", footerPath: "/en/case-studies/", label: "Projects", errorId: "home-en-ia", language: "English" };
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

  const expectedCss = "/assets/css/style.css?v=20260825-flightplan-2";
  const expectedJs = "/assets/js/main.js?v=20260825-flightplan-2";
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
    if (surface === "llms-full.txt") {
      for (const clause of unsupportedLlmsFullClauses) {
        if (surfaceContains(searchData.texts, clause)) {
          error(context.errors, "fact-llms-full-unsupported", surface, `unsupported legacy clause remains: ${clause}`);
        }
      }
    }
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

function cssStructureIsBalanced(source) {
  const commentScan = stripCssComments(source);
  if (commentScan.unterminatedCommentAt !== -1) return false;
  const stack = [];
  const matchingOpening = new Map([["}", "{"], [")", "("], ["]", "["]]);
  let quote = null;
  let escaped = false;
  for (const character of commentScan.css) {
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
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (new Set(["{", "(", "["]).has(character)) {
      stack.push(character);
      continue;
    }
    if (matchingOpening.has(character) && stack.pop() !== matchingOpening.get(character)) return false;
  }
  return quote === null && !escaped && stack.length === 0;
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
    const atRuleName = atRule?.[1].toLowerCase();
    if (atRuleName === "media") {
      const mediaPrelude = `@media${normalizedPrelude.slice(atRule[0].length)}`;
      parseCssRules(body, [...media, mediaPrelude], rules);
    } else if (atRuleName === "supports") {
      parseCssRules(body, media, rules);
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
  const [css, js, plHome, enHome, notFound] = await Promise.all([
    read(context, "assets/css/style.css"),
    read(context, "assets/js/main.js"),
    read(context, "index.html"),
    read(context, "en/index.html"),
    read(context, "404.html")
  ]);
  if (plHome !== null) verifyHomepageNavigation(plHome, { path: "index.html", lang: "pl" }, context.errors);
  if (enHome !== null) verifyHomepageNavigation(enHome, { path: "en/index.html", lang: "en" }, context.errors);
  if (notFound !== null) verifyLegacyNavigation(notFound, "404.html", context.errors);
  if (css !== null && css.length === 0) error(context.errors, "foundation-css", "assets/css/style.css", "stylesheet is empty");
  if (css !== null && gzipSync(Buffer.from(css, "utf8")).byteLength > 75_000) {
    error(context.errors, "budget-css-gzip", "assets/css/style.css", "compressed stylesheet exceeds 75000 bytes");
  }
  if (css !== null) {
    const cssDigest = createHash("sha256").update(css).digest("hex");
    if (cssDigest !== TASK10_REVIEWED_CSS_SHA256) {
      error(
        context.errors,
        "task10-css-reviewed-artifact",
        "assets/css/style.css",
        `SHA-256 ${cssDigest} differs from reviewed ${TASK10_REVIEWED_CSS_SHA256}; any CSS byte change requires renewed visual/cascade review and an explicit baseline refresh`
      );
    }
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

    const footerClearanceContracts = [
      [[], ".site-footer", "padding-inline-end", "calc(var(--page-gutter) + 64px)"],
      [[], ".back-to-top", "right", "max(16px, var(--page-gutter))"],
      [[], ".back-to-top", "width", "48px"],
      [media759, ".site-footer", "padding-inline-end", "var(--page-gutter)"]
    ];
    for (const [media, selector, property, value] of footerClearanceContracts) {
      if (propertyValue(rules, selector, property, media) !== value) {
        error(context.errors, "css-footer-clearance", "assets/css/style.css", `${selector} must use ${property}: ${value} in ${media[0] ?? "base scope"}`);
      }
    }
    const semanticCurrentRouteContracts = [
      [".nav-logo[aria-current=\"page\"]", "color", "var(--signal-dark)"],
      [".nav-list a[aria-current=\"page\"]", "color", "var(--signal-dark)"],
      [".nav-links a[aria-current=\"page\"]", "color", "var(--signal-dark)"],
      [".nav-group:not([open]):has(.nav-submenu a[aria-current=\"page\"]) > summary", "color", "var(--signal-dark)"]
    ];
    for (const [selector, property, value] of semanticCurrentRouteContracts) {
      if (propertyValue(rules, selector, property) !== value) {
        error(context.errors, "css-current-route", "assets/css/style.css", `${selector} must use ${property}: ${value} in base scope`);
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
  for (const syntaxError of parsed.errors) {
    const id = syntaxError.startsWith("non-void element <")
      ? "page-html-self-closing"
      : "page-html-syntax";
    error(errors, id, path, syntaxError);
  }
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
        Object.freeze(["/aplikacje-operacyjne/", "Aplikacje", true]),
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
      "© 2026 Paweł Mamcarz · mamcarz.com", "Strona główna", "Doradztwo", "Aplikacje", "Lotnictwo", "Projekty", "Wiedza", "Kontakt"
    ]),
    footerLinks: Object.freeze([
      Object.freeze(["/", "Strona główna"]),
      Object.freeze(["/uslugi/transformacja-zakupow/", "Doradztwo"]),
      Object.freeze(["/aplikacje-operacyjne/", "Aplikacje"]),
      Object.freeze(["/lotnictwo/", "Lotnictwo"]),
      Object.freeze(["/case-studies/", "Projekty"]),
      Object.freeze(["/wiedza/", "Wiedza"]),
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
        Object.freeze(["/en/aplikacje-operacyjne/", "Applications", true]),
        Object.freeze(["/en/lotnictwo/", "Aviation", false]),
        Object.freeze(["/en/case-studies/", "Projects", false]),
        Object.freeze(["/en/wiedza/", "Insights", false]),
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
      "© 2026 Paweł Mamcarz · mamcarz.com", "Home", "Advisory", "Applications", "Aviation", "Projects", "Insights", "Contact"
    ]),
    footerLinks: Object.freeze([
      Object.freeze(["/en/", "Home"]),
      Object.freeze(["/en/uslugi/transformacja-zakupow/", "Advisory"]),
      Object.freeze(["/en/aplikacje-operacyjne/", "Applications"]),
      Object.freeze(["/en/lotnictwo/", "Aviation"]),
      Object.freeze(["/en/case-studies/", "Projects"]),
      Object.freeze(["/en/wiedza/", "Insights"]),
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
    { role: "nav-primary-0", href: "/aplikacje-operacyjne/", label: "Aplikacje", kind: "text", attributes: { href: "/aplikacje-operacyjne/", "aria-current": "page" } },
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
    { role: "footer-link-5", href: "/wiedza/", label: "Wiedza", kind: "text", attributes: { href: "/wiedza/" } },
    { role: "footer-link-6", href: "/#contact", label: "Kontakt", kind: "text", attributes: { href: "/#contact" } }
  ]),
  en: freezeApplicationManifest([
    { role: "skip", href: "#main", label: "Skip to content", kind: "text", attributes: { href: "#main", class: "skip-link" } },
    { role: "nav-logo", href: "/en/", label: "PM · Mamcarz.com", kind: "logo", attributes: { href: "/en/", class: "nav-logo" } },
    { role: "nav-advisory-0", href: "/en/uslugi/transformacja-zakupow/", label: "Procurement transformation", kind: "text", attributes: { href: "/en/uslugi/transformacja-zakupow/" } },
    { role: "nav-advisory-1", href: "/en/uslugi/wdrozenie-sap-ariba/", label: "SAP Ariba implementation", kind: "text", attributes: { href: "/en/uslugi/wdrozenie-sap-ariba/" } },
    { role: "nav-advisory-2", href: "/en/uslugi/doradztwo-zamowienia-publiczne/", label: "Public procurement", kind: "text", attributes: { href: "/en/uslugi/doradztwo-zamowienia-publiczne/" } },
    { role: "nav-primary-0", href: "/en/aplikacje-operacyjne/", label: "Applications", kind: "text", attributes: { href: "/en/aplikacje-operacyjne/", "aria-current": "page" } },
    { role: "nav-primary-1", href: "/en/lotnictwo/", label: "Aviation", kind: "text", attributes: { href: "/en/lotnictwo/" } },
    { role: "nav-primary-2", href: "/en/case-studies/", label: "Projects", kind: "text", attributes: { href: "/en/case-studies/" } },
    { role: "nav-primary-3", href: "/en/wiedza/", label: "Insights", kind: "text", attributes: { href: "/en/wiedza/" } },
    { role: "nav-primary-4", href: "/en/#about", label: "About", kind: "text", attributes: { href: "/en/#about" } },
    { role: "nav-primary-5", href: "/en/#contact", label: "Contact", kind: "text", attributes: { href: "/en/#contact" } },
    { role: "nav-language", href: "/aplikacje-operacyjne/", label: "PL", kind: "text", attributes: { href: "/aplikacje-operacyjne/", class: "nav-lang" } },
    { role: "breadcrumb-home", href: "/en/", label: "Home", kind: "text", attributes: { href: "/en/" } },
    { role: "contact-cta", href: "mailto:pawel@mamcarz.com?subject=Operational%20application", label: "Describe the operational application", kind: "text", attributes: { class: "btn-primary", href: "mailto:pawel@mamcarz.com?subject=Operational%20application" } },
    { role: "footer-sign", href: "/en/", label: "", kind: "signature", attributes: { class: "footer-sign", href: "/en/", "aria-label": "Paweł Mamcarz, homepage" } },
    { role: "footer-link-0", href: "/en/", label: "Home", kind: "text", attributes: { href: "/en/" } },
    { role: "footer-link-1", href: "/en/uslugi/transformacja-zakupow/", label: "Advisory", kind: "text", attributes: { href: "/en/uslugi/transformacja-zakupow/" } },
    { role: "footer-link-2", href: "/en/aplikacje-operacyjne/", label: "Applications", kind: "text", attributes: { href: "/en/aplikacje-operacyjne/" } },
    { role: "footer-link-3", href: "/en/lotnictwo/", label: "Aviation", kind: "text", attributes: { href: "/en/lotnictwo/" } },
    { role: "footer-link-4", href: "/en/case-studies/", label: "Projects", kind: "text", attributes: { href: "/en/case-studies/" } },
    { role: "footer-link-5", href: "/en/wiedza/", label: "Insights", kind: "text", attributes: { href: "/en/wiedza/" } },
    { role: "footer-link-6", href: "/en/#contact", label: "Contact", kind: "text", attributes: { href: "/en/#contact" } }
  ])
});

const APPLICATION_SEMANTIC_ATTRIBUTE_MANIFEST = Object.freeze({
  pl: freezeApplicationManifest([
    { role: "site-nav", tag: "nav", attributes: { "aria-label": "Nawigacja główna" } },
    { role: "nav-menu", tag: "ul", attributes: { id: "nav-menu" } },
    { role: "nav-current", tag: "a", attributes: { "aria-current": "page" } },
    { role: "nav-toggle", tag: "button", attributes: { id: "nav-toggle", "aria-label": "Menu nawigacyjne", "aria-controls": "nav-menu", "aria-expanded": "false" } },
    { role: "nav-overlay", tag: "div", attributes: { id: "nav-overlay" } },
    { role: "back-to-top", tag: "button", attributes: { id: "backToTop", "aria-label": "Wróć na górę" } },
    { role: "main", tag: "main", attributes: { id: "main", tabindex: "-1" } },
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
    { role: "nav-menu", tag: "ul", attributes: { id: "nav-menu" } },
    { role: "nav-current", tag: "a", attributes: { "aria-current": "page" } },
    { role: "nav-toggle", tag: "button", attributes: { id: "nav-toggle", "aria-label": "Navigation menu", "aria-controls": "nav-menu", "aria-expanded": "false" } },
    { role: "nav-overlay", tag: "div", attributes: { id: "nav-overlay" } },
    { role: "back-to-top", tag: "button", attributes: { id: "backToTop", "aria-label": "Back to top" } },
    { role: "main", tag: "main", attributes: { id: "main", tabindex: "-1" } },
    { role: "breadcrumb", tag: "nav", attributes: { "aria-label": "Breadcrumb" } },
    { role: "breadcrumb-separator", tag: "span", attributes: { "aria-hidden": "true" } },
    { role: "breadcrumb-current", tag: "span", attributes: { "aria-current": "page" } },
    { role: "problem-ledger", tag: "dl", attributes: { "aria-label": "Method domains" } },
    { role: "delivery-route", tag: "div", attributes: { "aria-label": "Route to launch" } },
    { role: "fit-ledger", tag: "dl", attributes: { "aria-label": "Working conditions" } },
    { role: "footer-sign", tag: "a", attributes: { "aria-label": "Paweł Mamcarz, homepage" } },
    { role: "footer-signature", tag: "img", attributes: { alt: "" } }
  ])
});

const APPLICATION_SECTIONS = ["problem", "delivery", "evidence", "fit", "contact"];
const APPLICATION_DELIVERY_STEPS = ["discovery", "data-model", "workflow", "launch"];
const APPLICATION_SURFACES = ["aplikacje-operacyjne/index.html", "en/aplikacje-operacyjne/index.html"];
const APPLICATION_DOCUMENT_MANIFEST = Object.freeze({
  pl: Object.freeze({ elementCount: 188, digest: "0030be7e27f7fde6f7320dbc86686c01fd4863e5843d574b9ea2fc65577f9446" }),
  en: Object.freeze({ elementCount: 188, digest: "c5b2ca2065f213a1b086c65c672757876a08cb02aa648b02a594f724594d44d3" })
});
const APPLICATION_RESOURCE_LINK_MANIFEST = Object.freeze({
  pl: Object.freeze([
    Object.freeze({ rel: "canonical", href: "https://mamcarz.com/aplikacje-operacyjne/" }),
    Object.freeze({ rel: "alternate", hreflang: "pl", href: "https://mamcarz.com/aplikacje-operacyjne/" }),
    Object.freeze({ rel: "alternate", hreflang: "en", href: "https://mamcarz.com/en/aplikacje-operacyjne/" }),
    Object.freeze({ rel: "alternate", hreflang: "x-default", href: "https://mamcarz.com/aplikacje-operacyjne/" }),
    Object.freeze({ rel: "icon", type: "image/svg+xml", href: "/favicon.svg" }),
    Object.freeze({ rel: "preload", as: "font", type: "font/woff2", href: "/assets/fonts/barlow-semi-condensed-latin-600-normal.woff2", crossorigin: null }),
    Object.freeze({ rel: "preload", as: "font", type: "font/woff2", href: "/assets/fonts/barlow-semi-condensed-latin-ext-600-normal.woff2", crossorigin: null }),
    Object.freeze({ rel: "stylesheet", href: "/assets/css/style.css?v=20260825-flightplan-2" })
  ]),
  en: Object.freeze([
    Object.freeze({ rel: "canonical", href: "https://mamcarz.com/en/aplikacje-operacyjne/" }),
    Object.freeze({ rel: "alternate", hreflang: "pl", href: "https://mamcarz.com/aplikacje-operacyjne/" }),
    Object.freeze({ rel: "alternate", hreflang: "en", href: "https://mamcarz.com/en/aplikacje-operacyjne/" }),
    Object.freeze({ rel: "alternate", hreflang: "x-default", href: "https://mamcarz.com/aplikacje-operacyjne/" }),
    Object.freeze({ rel: "icon", type: "image/svg+xml", href: "/favicon.svg" }),
    Object.freeze({ rel: "preload", as: "font", type: "font/woff2", href: "/assets/fonts/barlow-semi-condensed-latin-600-normal.woff2", crossorigin: null }),
    Object.freeze({ rel: "preload", as: "font", type: "font/woff2", href: "/assets/fonts/barlow-semi-condensed-latin-ext-600-normal.woff2", crossorigin: null }),
    Object.freeze({ rel: "stylesheet", href: "/assets/css/style.css?v=20260825-flightplan-2" })
  ])
});
const APPLICATION_ZERO_RESOURCE_TAGS = new Set([
  "applet", "audio", "base", "embed", "form", "frame", "frameset", "iframe", "object",
  "picture", "portal", "source", "track", "video"
]);
const APPLICATION_RESOURCE_ATTRIBUTE_NAMES = new Set([
  "action", "archive", "background", "cite", "codebase", "data", "formaction", "href", "longdesc",
  "manifest", "ping", "poster", "profile", "src", "srcdoc", "srcset", "usemap", "xlink:href"
]);
const APPLICATION_HUMAN_METADATA_FIELDS = new Set([
  "name:description", "name:author", "property:og:title", "property:og:description",
  "property:og:image:alt", "property:og:site_name"
]);

function directElementChildren(node, name = null) {
  return (node?.children ?? []).filter((child) => child.type === "element" && (name === null || child.name === name));
}

function documentNodeDescendants(node) {
  const descendants = [];
  const visit = (current) => {
    for (const child of current?.children ?? []) {
      descendants.push(child);
      visit(child);
    }
  };
  visit(node);
  return descendants;
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

function applicationElementSuppressesOwnedCopy(element) {
  return element.attributes.has("hidden")
    || element.attributes.has("inert")
    || elementHasHiddenInlineStyle(element)
    || staticallyHiddenElements.has(element.name);
}

function publishedStaticText(node) {
  let text = "";
  const excluded = new Set(["script", "style", "template", "noscript"]);
  const visit = (current, ancestorUnavailable = false) => {
    const unavailable = ancestorUnavailable
      || (current.type === "element" && applicationElementSuppressesOwnedCopy(current));
    if (current.type === "text") {
      if (!unavailable) text += ` ${current.value}`;
      return;
    }
    if (current.type === "element" && excluded.has(current.name)) return;
    for (const child of current.children ?? []) visit(child, unavailable);
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
      || (current.type === "element" && (current.attributes.has("inert") || !elementIsStaticallyVisible(current)));
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

const APPLICATION_BEHAVIOR_STATE_ATTRIBUTES = new Set([
  "accesskey", "autofocus", "autoplay", "checked", "contenteditable", "controls", "disabled", "download",
  "draggable", "form", "formaction", "hidden", "id", "inert", "loop", "multiple", "muted", "open",
  "popover", "readonly", "required", "selected", "spellcheck", "style", "tabindex", "target", "translate"
]);

const APPLICATION_NORMALIZED_SEMANTIC_TEXT_ATTRIBUTES = new Set([
  "alt", "aria-description", "aria-label", "aria-placeholder", "aria-roledescription", "aria-valuetext",
  "label", "placeholder", "title", "value"
]);

function isApplicationSemanticAttribute(name) {
  return name.startsWith("aria-")
    || /^on[a-z]/.test(name)
    || APPLICATION_USER_FACING_ATTRIBUTES.has(name)
    || APPLICATION_BEHAVIOR_STATE_ATTRIBUTES.has(name)
    || name === "role";
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
        : actualValue === value;
    });
}

function applicationAttributeUsesHumanNormalization(element, name) {
  if (APPLICATION_NORMALIZED_SEMANTIC_TEXT_ATTRIBUTES.has(name)) return true;
  if (element.name !== "meta" || name !== "content") return false;
  const discriminator = element.attributes.has("name")
    ? `name:${elementAttribute(element, "name")}`
    : `property:${elementAttribute(element, "property")}`;
  return APPLICATION_HUMAN_METADATA_FIELDS.has(discriminator);
}

function applicationApprovedEvidenceAnchors(evidenceRows, factData) {
  const records = Array.isArray(factData.facts) ? factData.facts.filter(isPlainObject) : [];
  const approved = new Set();
  for (const row of evidenceRows) {
    const ids = (elementAttribute(row, "data-fact-ids") ?? "").trim().split(/\s+/).filter(Boolean);
    const approvedUrls = new Set(ids.flatMap((factId) => records
      .filter((fact) => fact.id === factId && fact.status === "approved" && isHttpUrl(fact.source_url))
      .map((fact) => fact.source_url)));
    const rowChildren = directElementChildren(row);
    const ledgerRows = directElementChildren(rowChildren[2], "div");
    const ledgerLeaves = directElementChildren(ledgerRows[0]);
    const allowedParents = new Set([rowChildren[1], ledgerLeaves[1]].filter(Boolean));
    for (const anchor of elementDescendants(row, "a")) {
      const href = elementAttribute(anchor, "href");
      if (allowedParents.has(anchor.parent)
        && directElementChildren(anchor.parent).length === 1
        && (anchor.attributes.sourceAttributeCount ?? anchor.attributes.size) === anchor.attributes.size
        && exactElementAttributes(anchor, { href })
        && approvedUrls.has(href)
        && directElementChildren(anchor).length === 0
        && elementIsActiveResource(anchor)
        && elementIsVisibleIfDisclosuresOpen(anchor)) {
        approved.add(anchor);
      }
    }
  }
  return approved;
}

function verifyApplicationDocumentBoundary(path, parsedRoot, errors) {
  const nodes = documentNodeDescendants(parsedRoot);
  const doctypes = nodes.filter((node) => node.type === "doctype");
  const significantRootNodes = parsedRoot.children.filter((node) => {
    if (node.type === "comment") return false;
    if (node.type === "text") return node.value.trim().length > 0;
    return true;
  });
  const html = significantRootNodes.find((node) => node.type === "element" && node.name === "html");
  const valid = doctypes.length === 1
    && doctypes[0].parent === parsedRoot
    && /^<!doctype\s+html\s*>$/i.test(doctypes[0].source)
    && significantRootNodes.length === 2
    && significantRootNodes[0] === doctypes[0]
    && significantRootNodes[1] === html;
  if (!valid) {
    error(errors, "application-document-boundary", path, "requires one HTML5 doctype before the sole html root, with only comments or whitespace outside that boundary");
  }
}

function applicationTextHasBlockedContainer(textNode) {
  const blockedContainers = new Set([
    "audio", "embed", "form", "iframe", "noscript", "object", "picture", "script", "style", "template", "video"
  ]);
  for (let current = textNode.parent; current?.type === "element"; current = current.parent) {
    if (blockedContainers.has(current.name)
      || current.attributes.has("hidden")
      || current.attributes.has("inert")
      || elementHasHiddenInlineStyle(current)) return true;
  }
  return false;
}

function verifyApplicationDocumentText(path, parsedRoot, body, nav, main, footer, errors) {
  const all = elementDescendants(parsedRoot);
  const heads = all.filter((element) => element.name === "head");
  const titles = all.filter((element) => element.name === "title");
  const schemaScripts = all.filter((element) => element.name === "script" && elementAttribute(element, "type") === "application/ld+json");
  const bodyChildren = directElementChildren(body);
  const skip = bodyChildren.find((element) => element.name === "a" && elementHasClass(element, "skip-link"));
  const back = bodyChildren.find((element) => element.name === "button" && elementHasClass(element, "back-to-top"));
  const approvedOwners = new Set([skip, nav, back, main, footer].filter(Boolean));
  const nonWhitespace = documentNodeDescendants(parsedRoot)
    .filter((node) => node.type === "text" && node.value.trim().length > 0);
  const invalid = nonWhitespace.filter((textNode) => {
    const title = titles.length === 1 ? titles[0] : null;
    if (title !== null && textNode.parent === title && title.parent === heads[0]) return false;
    const schema = schemaScripts.length === 1 ? schemaScripts[0] : null;
    if (schema !== null && textNode.parent === schema && schema.parent === heads[0]) return false;
    for (const owner of approvedOwners) {
      if (elementIsWithin(textNode.parent, owner) && !applicationTextHasBlockedContainer(textNode)) return false;
    }
    return true;
  });
  const externalScripts = directElementChildren(body, "script")
    .filter((script) => script.attributes.has("src"));
  const externalScriptBodiesAreEmpty = externalScripts.length === 1
    && rawElementText(externalScripts[0]).trim() === "";
  if (invalid.length > 0 || !externalScriptBodiesAreEmpty) {
    error(
      errors,
      "application-document-text",
      path,
      `all non-whitespace text must belong to an owned title, schema, shell, navigation, main or footer location; found ${invalid.length} unowned node(s)`
    );
  }
}

function exactApplicationResourceAttributes(element, expected) {
  return exactElementAttributes(element, expected)
    && (element.attributes.sourceAttributeCount ?? element.attributes.size) === Object.keys(expected).length;
}

function verifyApplicationResourceCensus(path, parsedRoot, lang, body, footer, evidenceRows, factData, errors) {
  const all = elementDescendants(parsedRoot);
  const heads = all.filter((element) => element.name === "head");
  const head = heads.length === 1 ? heads[0] : null;
  const links = all.filter((element) => element.name === "link");
  const expectedLinks = APPLICATION_RESOURCE_LINK_MANIFEST[lang];
  const linksAreExact = links.length === expectedLinks.length
    && links.every((link, index) => link.parent === head && exactApplicationResourceAttributes(link, expectedLinks[index]));

  const scripts = all.filter((element) => element.name === "script");
  const schema = scripts[0];
  const external = scripts[1];
  const bodyChildren = directElementChildren(body);
  const scriptsAreExact = scripts.length === 2
    && schema?.parent === head
    && exactApplicationResourceAttributes(schema, { type: "application/ld+json" })
    && external?.parent === body
    && bodyChildren.at(-1) === external
    && exactApplicationResourceAttributes(external, { src: "/assets/js/main.js?v=20260825-flightplan-2", defer: null })
    && rawElementText(external).trim() === "";

  const footerSigns = all.filter((element) => element.name === "a" && elementHasClass(element, "footer-sign"));
  const images = all.filter((element) => element.name === "img");
  const imageIsExact = footerSigns.length === 1
    && footerSigns[0].parent !== null
    && elementIsWithin(footerSigns[0], footer)
    && images.length === 1
    && images[0].parent === footerSigns[0]
    && exactApplicationResourceAttributes(images[0], {
      src: "/assets/img/signature.png",
      alt: "",
      width: "160",
      height: "50",
      loading: "lazy",
      decoding: "async"
    });

  const approvedEvidenceAnchors = applicationApprovedEvidenceAnchors(evidenceRows, factData);
  const externalAnchors = all.filter((element) => element.name === "a" && isHttpUrl(elementAttribute(element, "href")));
  const externalAnchorsAreApproved = externalAnchors.every((anchor) => approvedEvidenceAnchors.has(anchor));
  const zeroResourceTags = all.filter((element) => APPLICATION_ZERO_RESOURCE_TAGS.has(element.name));
  const styleElements = all.filter((element) => element.name === "style");
  const styleAttributes = all.filter((element) => element.attributes.has("style"));
  const resourceAttributeOwnersAreExact = all.every((element) => {
    const resourceAttributes = [...element.attributes.keys()].filter((name) => APPLICATION_RESOURCE_ATTRIBUTE_NAMES.has(name));
    if (resourceAttributes.length === 0) return true;
    return element.name === "a" || element.name === "link" || element.name === "script" || element.name === "img";
  });
  const valid = linksAreExact
    && scriptsAreExact
    && imageIsExact
    && externalAnchorsAreApproved
    && zeroResourceTags.length === 0
    && styleElements.length === 0
    && styleAttributes.length === 0
    && resourceAttributeOwnersAreExact;
  if (!valid) {
    error(
      errors,
      "application-resource-census",
      path,
      "requires the exact approved head links, JSON-LD and external script, signature image and evidence URLs, with zero other executable, style, form or resource surfaces"
    );
  }
}

function applicationDocumentManifestDigest(parsedRoot, transparentElements = new Set()) {
  const entries = [];
  const visit = (node, parentPath) => {
    const children = (node.children ?? [])
      .filter((child) => child.type === "element" && !transparentElements.has(child));
    children.forEach((element, index) => {
      const path = `${parentPath}/${index}`;
      const attributes = [...element.attributes]
        .sort(([first], [second]) => first < second ? -1 : (first > second ? 1 : 0))
        .map(([name, value]) => [
          name,
          applicationAttributeUsesHumanNormalization(element, name)
            ? normalizeExactHtmlLiteral(value ?? "")
            : value
        ]);
      entries.push([path, element.name, element.attributes.sourceAttributeCount ?? element.attributes.size, attributes]);
      visit(element, path);
    });
  };
  visit(parsedRoot, "");
  return {
    elementCount: entries.length,
    digest: createHash("sha256").update(JSON.stringify(entries)).digest("hex")
  };
}

function verifyApplicationDocumentManifest(path, parsedRoot, lang, evidenceRows, factData, errors) {
  const transparentEvidenceAnchors = applicationApprovedEvidenceAnchors(evidenceRows, factData);
  const actual = applicationDocumentManifestDigest(parsedRoot, transparentEvidenceAnchors);
  const expected = APPLICATION_DOCUMENT_MANIFEST[lang];
  if (actual.elementCount !== expected.elementCount || actual.digest !== expected.digest) {
    error(
      errors,
      "application-document-manifest",
      path,
      `actual-manifest=${lang}:${actual.elementCount}:${actual.digest}; requires the exact ${expected.elementCount}-element Task 2 tag, position and complete attribute manifest`
    );
  }
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

function applicationOwnedEvidenceRows(main) {
  if (main === undefined || main === null) return [];
  const evidenceSections = directElementChildren(main, "section")
    .filter((section) => elementAttribute(section, "data-section") === "evidence");
  if (evidenceSections.length !== 1) return [];
  const shells = directElementChildren(evidenceSections[0], "div")
    .filter((element) => elementHasClass(element, "section-shell"));
  if (shells.length !== 1) return [];
  const lists = directElementChildren(shells[0], "div")
    .filter((element) => elementHasClass(element, "applications-evidence-list"));
  if (lists.length !== 1) return [];
  const rows = directElementChildren(lists[0], "article");
  return rows.length === APPLICATION_EVIDENCE_CONTRACT.length
    && rows.every((row) => elementHasClass(row, "evidence-row"))
    ? rows
    : [];
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
      height: "50",
      loading: "lazy",
      decoding: "async"
      }, new Set(["alt"]));
  }
  return false;
}

function verifyApplicationAnchorManifest(path, parsedRoot, lang, body, nav, main, footer, evidenceRows, errors) {
  const manifest = APPLICATION_ANCHOR_MANIFEST[lang];
  const roleNodes = applicationAnchorRoleNodes(body, nav, main, footer);
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
  const navMenu = directElementChildren(nav, "ul").find((element) => elementHasClass(element, "nav-list"));
  const navToggle = directElementChildren(nav, "button").find((element) => elementHasClass(element, "nav-toggle"));
  const navOverlay = directElementChildren(body, "div").find((element) => elementHasClass(element, "nav-overlay"));
  const backToTop = directElementChildren(body, "button").find((element) => elementHasClass(element, "back-to-top"));
  const breadcrumb = firstDescendantWithClass(main, "nav", "breadcrumb");
  const breadcrumbSpans = directElementChildren(breadcrumb, "span");
  const mainSections = main === undefined || main === null ? [] : elementDescendants(main, "section");
  const problem = mainSections.find((section) => elementAttribute(section, "data-section") === "problem");
  const delivery = mainSections.find((section) => elementAttribute(section, "data-section") === "delivery");
  const fit = mainSections.find((section) => elementAttribute(section, "data-section") === "fit");
  const footerSign = anchorRoleNodes.find(({ role }) => role === "footer-sign")?.node;
  return [
    ["site-nav", nav],
    ["nav-menu", navMenu],
    ["nav-current", navCurrent],
    ["nav-toggle", navToggle],
    ["nav-overlay", navOverlay],
    ["back-to-top", backToTop],
    ["main", main],
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
  const all = elementDescendants(parsedRoot);
  const htmls = all.filter((element) => element.name === "html");
  const heads = all.filter((element) => element.name === "head");
  const bodies = all.filter((element) => element.name === "body");
  const titles = all.filter((element) => element.name === "title");
  const metas = all.filter((element) => element.name === "meta");
  const links = all.filter((element) => element.name === "link");
  const bases = all.filter((element) => element.name === "base");
  const html = htmls.length === 1 ? htmls[0] : null;
  const head = heads.length === 1 ? heads[0] : null;
  const body = bodies.length === 1 ? bodies[0] : null;
  const expectedMetas = [
    { attributes: { charset: "UTF-8" }, contentType: "token" },
    { attributes: { name: "viewport", content: "width=device-width, initial-scale=1.0" }, contentType: "token" },
    { attributes: { name: "description", content: page.description }, contentType: "human" },
    { attributes: { name: "author", content: "Paweł Mamcarz" }, contentType: "human" },
    { attributes: { name: "robots", content: "index, follow" }, contentType: "token" },
    { attributes: { property: "og:title", content: literals.documentTitle }, contentType: "human" },
    { attributes: { property: "og:description", content: page.description }, contentType: "human" },
    { attributes: { property: "og:type", content: "website" }, contentType: "token" },
    { attributes: { property: "og:url", content: page.url }, contentType: "token" },
    { attributes: { property: "og:image", content: "https://mamcarz.com/assets/img/og.jpg" }, contentType: "token" },
    { attributes: { property: "og:image:alt", content: literals.documentTitle }, contentType: "human" },
    { attributes: { property: "og:locale", content: literals.locale }, contentType: "token" },
    { attributes: { property: "og:site_name", content: "Paweł Mamcarz" }, contentType: "human" }
  ];
  const expectedResources = [
    { rel: "canonical", href: page.url },
    { rel: "alternate", hreflang: "pl", href: APPLICATION_PAGE_CONTRACT.pl.url },
    { rel: "alternate", hreflang: "en", href: APPLICATION_PAGE_CONTRACT.en.url },
    { rel: "alternate", hreflang: "x-default", href: APPLICATION_PAGE_CONTRACT.pl.url }
  ];
  const expectedAssets = [
    { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
    { rel: "preload", as: "font", type: "font/woff2", href: "/assets/fonts/barlow-semi-condensed-latin-600-normal.woff2", crossorigin: null },
    { rel: "preload", as: "font", type: "font/woff2", href: "/assets/fonts/barlow-semi-condensed-latin-ext-600-normal.woff2", crossorigin: null },
    { rel: "stylesheet", href: "/assets/css/style.css?v=20260825-flightplan-2" }
  ];
  const expectedHeadTags = [
    "meta", "meta", "title", "meta", "meta", "meta",
    "link", "link", "link", "link",
    "meta", "meta", "meta", "meta", "meta", "meta", "meta", "meta",
    "script", "link", "link", "link", "link"
  ];
  const rootElements = directElementChildren(parsedRoot);
  const htmlChildren = directElementChildren(html);
  const headChildren = directElementChildren(head);
  const validDocument = html !== null
    && head !== null
    && body !== null
    && rootElements.length === 1
    && rootElements[0] === html
    && html.parent === parsedRoot
    && htmlChildren.length === 2
    && htmlChildren[0] === head
    && htmlChildren[1] === body
    && head.parent === html
    && body.parent === html
    && bases.length === 0
    && titles.every((element) => element.parent === head)
    && metas.every((element) => element.parent === head)
    && links.every((element) => element.parent === head)
    && headChildren.length === expectedHeadTags.length
    && headChildren.every((element, index) => element.name === expectedHeadTags[index]);
  const valid = validDocument
    && titles.length === 1
    && exactElementAttributes(titles[0], {})
    && elementIsActiveResource(titles[0])
    && normalizeExactHtmlLiteral(rawElementText(titles[0])) === normalizeExactLiteral(literals.documentTitle)
    && metas.length === expectedMetas.length
    && metas.every((meta, index) => elementIsActiveResource(meta) && exactApplicationAttributes(
      meta,
      expectedMetas[index].attributes,
      expectedMetas[index].contentType === "human" ? new Set(["content"]) : new Set()
    ))
    && links.length === expectedResources.length + expectedAssets.length
    && links.every((link, index) => elementIsActiveResource(link)
      && exactApplicationAttributes(link, index < expectedResources.length
        ? expectedResources[index]
        : expectedAssets[index - expectedResources.length]));
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
  verifyApplicationDocumentBoundary(path, parsedRoot, errors);
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
  const evidenceRows = applicationOwnedEvidenceRows(main);
  verifyApplicationDocumentText(path, parsedRoot, body, applicationNav, main, applicationFooter, errors);
  verifyApplicationResourceCensus(path, parsedRoot, lang, body, applicationFooter, evidenceRows, factData, errors);
  verifyApplicationDocumentManifest(path, parsedRoot, lang, evidenceRows, factData, errors);
  verifyApplicationAnchorManifest(path, parsedRoot, lang, body, applicationNav, main, applicationFooter, evidenceRows, errors);
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

const AVIATION_PAGE_CONTRACT = Object.freeze({
  pl: Object.freeze({
    title: "Lotnictwo",
    lead: "Lotnictwo jest jednym z głównych obszarów mojej działalności. Łączę operacje, sprzedaż, szkolenie, bezpieczeństwo, media i software w projektach, które wymagają jasnych procedur oraz odpowiedzialności.",
    description: "Operacje, sprzedaż, szkolenie, bezpieczeństwo, media i software w projektach lotniczych opartych na jasnych procedurach oraz odpowiedzialności.",
    url: "https://mamcarz.com/lotnictwo/",
    contactHref: "mailto:pawel@mamcarz.com?subject=Projekt%20lotniczy"
  }),
  en: Object.freeze({
    title: "Aviation",
    lead: "Aviation is one of the core areas of my business. I connect operations, sales, training, safety, media and software in work that depends on clear procedures and accountability.",
    description: "Operations, sales, training, safety, media and software in aviation work built around clear procedures and accountability.",
    url: "https://mamcarz.com/en/lotnictwo/",
    contactHref: "mailto:pawel@mamcarz.com?subject=Aviation%20project"
  })
});

const AVIATION_SECTION_ORDER = Object.freeze(["operations", "training-safety", "media", "software", "ventures", "contact"]);
const AVIATION_FACT_ORDER = Object.freeze([
  "aviation.ppl_h",
  "aviation.ppl_a",
  "aviation.aerobatics_rating",
  "aviation.diverse_extreme_team",
  "aviation.forum_photographer",
  "aviation.air_to_air_media",
  "portfolio.akrobacja_com",
  "portfolio.akrobacja_com.current_status",
  "portfolio.akrobacja_com.type",
  "portfolio.filmolot_pl",
  "portfolio.filmolot_pl.type"
]);

const AVIATION_SURFACES = Object.freeze(["lotnictwo/index.html", "en/lotnictwo/index.html"]);
const AVIATION_FACT_CONTRACT = Object.freeze([
  Object.freeze({ id: "aviation.ppl_h", value: "PPL(H)", display_pl: "PPL(H)", display_en: "PPL(H)", kind: "constant", as_of: null, source_type: "owner_verified", source_label: "Owner confirmed aviation fact, 2026-08-25", source_url: null, surfaces: ["index.html", "en/index.html", ...AVIATION_SURFACES, "llms-full.txt", "worker/index.js"], status: "approved" }),
  Object.freeze({ id: "aviation.ppl_a", value: "PPL(A)", display_pl: "PPL(A)", display_en: "PPL(A)", kind: "constant", as_of: null, source_type: "owner_verified", source_label: "Owner confirmed aviation fact, 2026-08-25", source_url: null, surfaces: ["index.html", "en/index.html", ...AVIATION_SURFACES, "llms-full.txt", "worker/index.js"], status: "approved" }),
  Object.freeze({ id: "aviation.aerobatics_rating", value: "aerobatics rating", display_pl: "uprawnienia do akrobacji", display_en: "aerobatics rating", kind: "constant", as_of: null, source_type: "owner_verified", source_label: "Owner confirmed aviation fact, 2026-08-25", source_url: null, surfaces: ["index.html", "en/index.html", ...AVIATION_SURFACES, "llms-full.txt", "worker/index.js"], status: "approved" }),
  Object.freeze({ id: "aviation.diverse_extreme_team", value: "Demonstration pilot, Diverse Extreme Team, 2013", display_pl: "pilot pokazowy Diverse Extreme Team (2013)", display_en: "display pilot for the Diverse Extreme Team (2013)", kind: "constant", as_of: null, source_type: "owner_verified", source_label: "Owner confirmed aviation fact, 2026-08-25", source_url: null, surfaces: ["index.html", "en/index.html", ...AVIATION_SURFACES, "llms-full.txt"], status: "approved" }),
  Object.freeze({ id: "aviation.forum_photographer", value: "Press photographer for Forum Agency", display_pl: "fotograf prasowy agencji Forum", display_en: "Press photographer with Forum Agency", kind: "constant", as_of: null, source_type: "owner_verified", source_label: "Owner confirmed aviation fact, 2026-08-25", source_url: null, surfaces: ["index.html", "en/index.html", ...AVIATION_SURFACES, "llms-full.txt"], status: "approved" }),
  Object.freeze({ id: "aviation.air_to_air_media", value: "air-to-air, video and drone production", display_pl: "sesje air-to-air, realizacje wideo i dronem", display_en: "air-to-air shoots, video and drone production", kind: "constant", as_of: null, source_type: "owner_verified", source_label: "Owner-confirmed pre-Task-5 aviation history, 2026-08-26", source_url: null, surfaces: ["index.html", "en/index.html", ...AVIATION_SURFACES], status: "approved" }),
  Object.freeze({ id: "portfolio.akrobacja_com", value: "akrobacja.com", display_pl: "akrobacja.com", display_en: "akrobacja.com", kind: "constant", as_of: null, source_type: "owner_verified", source_label: "Owner correction, 2026-08-26: akrobacja.com is the active aviation venture and succeeds the former WarsawFlightSafety name", source_url: null, surfaces: ["index.html", "en/index.html", ...AVIATION_SURFACES, "llms-full.txt", "worker/index.js", ...PROJECT_SURFACES], status: "approved" }),
  Object.freeze({ id: "portfolio.akrobacja_com.current_status", value: "active aviation venture as of 2026-08-26", display_pl: "Aktualna marka działalności lotniczej", display_en: "Current aviation venture", kind: "dated", as_of: "2026-08-26", source_type: "owner_verified", source_label: "Owner correction, 2026-08-26: akrobacja.com is the active aviation venture", source_url: null, surfaces: ["index.html", "en/index.html", ...AVIATION_SURFACES, "llms-full.txt", "worker/index.js", ...PROJECT_SURFACES], status: "approved" }),
  Object.freeze({ id: "portfolio.akrobacja_com.type", value: "aerobatic-flight voucher sales platform", display_pl: "Platforma sprzedaży voucherów na loty akrobacyjne.", display_en: "Voucher sales platform for aerobatic flights.", kind: "constant", as_of: null, source_type: "owner_verified", source_label: "Owner-confirmed pre-Task-5 portfolio description, 2026-08-26", source_url: null, surfaces: ["index.html", "en/index.html", ...AVIATION_SURFACES, "llms-full.txt", "worker/index.js", ...PROJECT_SURFACES], status: "approved" }),
  Object.freeze({ id: "portfolio.filmolot_pl", value: "FilmoLot.pl aviation photography and video project", display_pl: "FilmoLot.pl", display_en: "FilmoLot.pl", kind: "constant", as_of: null, source_type: "owner_verified", source_label: "Owner confirmed portfolio project, 2026-08-25", source_url: null, surfaces: ["index.html", "en/index.html", ...AVIATION_SURFACES, ...PROJECT_SURFACES], status: "approved" }),
  Object.freeze({ id: "portfolio.filmolot_pl.type", value: "aviation photography and video", display_pl: "Lotnictwo · fotografia i wideo", display_en: "Aviation · photography and video", kind: "constant", as_of: null, source_type: "owner_verified", source_label: "Owner-confirmed pre-Task-5 portfolio description, 2026-08-26", source_url: null, surfaces: ["index.html", "en/index.html", ...AVIATION_SURFACES, ...PROJECT_SURFACES], status: "approved" })
]);

const AVIATION_NAVIGATION_CONTRACT = Object.freeze({
  pl: Object.freeze({
    ariaLabel: "Nawigacja główna", logoHref: "/", advisory: "Doradztwo",
    submenu: [["/uslugi/transformacja-zakupow/", "Transformacja zakupów"], ["/uslugi/wdrozenie-sap-ariba/", "Wdrożenie SAP Ariba"], ["/uslugi/doradztwo-zamowienia-publiczne/", "Zamówienia publiczne"]],
    primary: [["/aplikacje-operacyjne/", "Aplikacje", false], ["/lotnictwo/", "Lotnictwo", true], ["/case-studies/", "Projekty", false], ["/wiedza/", "Wiedza", false], ["/#about", "O mnie", false], ["/#contact", "Kontakt", false]],
    languageHref: "/en/lotnictwo/", languageLabel: "EN", toggleLabel: "Menu nawigacyjne"
  }),
  en: Object.freeze({
    ariaLabel: "Main navigation", logoHref: "/en/", advisory: "Advisory",
    submenu: [["/en/uslugi/transformacja-zakupow/", "Procurement transformation"], ["/en/uslugi/wdrozenie-sap-ariba/", "SAP Ariba implementation"], ["/en/uslugi/doradztwo-zamowienia-publiczne/", "Public procurement"]],
    primary: [["/en/aplikacje-operacyjne/", "Applications", false], ["/en/lotnictwo/", "Aviation", true], ["/en/case-studies/", "Projects", false], ["/en/wiedza/", "Insights", false], ["/en/#about", "About", false], ["/en/#contact", "Contact", false]],
    languageHref: "/lotnictwo/", languageLabel: "PL", toggleLabel: "Navigation menu"
  })
});

const AVIATION_RESOURCE_LINKS = Object.freeze({
  pl: Object.freeze([
    { rel: "canonical", href: "https://mamcarz.com/lotnictwo/" },
    { rel: "alternate", hreflang: "pl", href: "https://mamcarz.com/lotnictwo/" },
    { rel: "alternate", hreflang: "en", href: "https://mamcarz.com/en/lotnictwo/" },
    { rel: "alternate", hreflang: "x-default", href: "https://mamcarz.com/lotnictwo/" },
    { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
    { rel: "preload", as: "font", type: "font/woff2", href: "/assets/fonts/barlow-semi-condensed-latin-600-normal.woff2", crossorigin: null },
    { rel: "preload", as: "font", type: "font/woff2", href: "/assets/fonts/barlow-semi-condensed-latin-ext-600-normal.woff2", crossorigin: null },
    { rel: "stylesheet", href: "/assets/css/style.css?v=20260825-flightplan-2" }
  ]),
  en: Object.freeze([
    { rel: "canonical", href: "https://mamcarz.com/en/lotnictwo/" },
    { rel: "alternate", hreflang: "pl", href: "https://mamcarz.com/lotnictwo/" },
    { rel: "alternate", hreflang: "en", href: "https://mamcarz.com/en/lotnictwo/" },
    { rel: "alternate", hreflang: "x-default", href: "https://mamcarz.com/lotnictwo/" },
    { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
    { rel: "preload", as: "font", type: "font/woff2", href: "/assets/fonts/barlow-semi-condensed-latin-600-normal.woff2", crossorigin: null },
    { rel: "preload", as: "font", type: "font/woff2", href: "/assets/fonts/barlow-semi-condensed-latin-ext-600-normal.woff2", crossorigin: null },
    { rel: "stylesheet", href: "/assets/css/style.css?v=20260825-flightplan-2" }
  ])
});

const AVIATION_DOCUMENT_MANIFEST = Object.freeze({
  pl: Object.freeze({ elementCount: 190, digest: "e14c132c6b5af56bd13909c60fdefb0a37e62604de261b143c68ee2933d03117" }),
  en: Object.freeze({ elementCount: 190, digest: "6e31b5ca03ae114affc63f534ee6e80550f75339c25430a0e26c87203be20d7a" })
});

const AVIATION_BODY_TEXT_LEAVES = Object.freeze({
  pl: Object.freeze([
    "Przejdź do treści", "PM", "· Mamcarz.com", "Doradztwo", "Transformacja zakupów", "Wdrożenie SAP Ariba", "Zamówienia publiczne", "Aplikacje", "Lotnictwo", "Projekty", "Wiedza", "O mnie", "Kontakt", "EN", "↑",
    "Strona główna", "/", "Lotnictwo", "FLIGHT PLAN / CORE ROUTE 03", "Lotnictwo", AVIATION_PAGE_CONTRACT.pl.lead,
    "01", "OPS", "Operacje", "Decyzje zapisane w procedurze.", "Zakres zaczyna się od ról, warunków i punktów decyzyjnych. Ich kolejność wyznacza sposób pracy.", "Licencja", "PPL(H)", "Licencja", "PPL(A)",
    "02", "SAFE", "Szkolenie i bezpieczeństwo", "Standard przed wykonaniem.", "Przygotowanie obejmuje kryteria, komunikację i odpowiedzialność za każdy etap pracy.", "Zakres", "uprawnienia do akrobacji", "Doświadczenie", "pilot pokazowy Diverse Extreme Team (2013)",
    "03", "MEDIA", "Media", "Obraz podporządkowany zadaniu.", "Plan ujęć, podział odpowiedzialności i wykonanie tworzą jeden przebieg pracy.", "Fotografia", "fotograf prasowy agencji Forum", "Realizacja", "sesje air-to-air, realizacje wideo i dronem",
    "04", "DATA", "Software", "Proces przeniesiony do narzędzia.", "Software porządkuje dane, kolejne stany i odpowiedzialność. Interfejs wynika z przebiegu pracy.", "WEJŚCIE", "Procedura", "PRZEPŁYW", "Dane i decyzje", "WYJŚCIE", "Ślad działania",
    "05", "LOG", "Projekty", "Rejestr przedsięwzięć lotniczych.", "PROJECT / A01", "akrobacja.com", "Aktualna marka działalności lotniczej", "Stan na 2026-08-26", "Platforma sprzedaży voucherów na loty akrobacyjne.", "PROJECT / M02", "FilmoLot.pl", "Lotnictwo · fotografia i wideo",
    "06", "COMMS", "Kontakt", "Ustalmy zakres i odpowiedzialność.", "Opisz projekt, proces albo decyzję, od której ma zacząć się rozmowa.", "Porozmawiaj o projekcie lotniczym",
    "© 2026 Paweł Mamcarz · mamcarz.com", "Strona główna", "Doradztwo", "Aplikacje", "Lotnictwo", "Projekty", "Wiedza", "Kontakt"
  ]),
  en: Object.freeze([
    "Skip to content", "PM", "· Mamcarz.com", "Advisory", "Procurement transformation", "SAP Ariba implementation", "Public procurement", "Applications", "Aviation", "Projects", "Insights", "About", "Contact", "PL", "↑",
    "Home", "/", "Aviation", "FLIGHT PLAN / CORE ROUTE 03", "Aviation", AVIATION_PAGE_CONTRACT.en.lead,
    "01", "OPS", "Operations", "Decisions recorded in procedure.", "The scope starts with roles, conditions and decision points. Their sequence determines the working method.", "Licence", "PPL(H)", "Licence", "PPL(A)",
    "02", "SAFE", "Training and safety", "The standard comes before execution.", "Preparation covers criteria, communication and responsibility for each stage of work.", "Scope", "aerobatics rating", "Experience", "display pilot for the Diverse Extreme Team (2013)",
    "03", "MEDIA", "Media", "The image follows the task.", "Shot planning, assigned responsibility and execution form one working sequence.", "Photography", "Press photographer with Forum Agency", "Production", "air-to-air shoots, video and drone production",
    "04", "DATA", "Software", "The process transferred into a tool.", "Software organises data, consecutive states and responsibility. The interface follows the working process.", "INPUT", "Procedure", "FLOW", "Data and decisions", "OUTPUT", "Action trail",
    "05", "LOG", "Projects", "Aviation venture register.", "PROJECT / A01", "akrobacja.com", "Current aviation venture", "As of 2026-08-26", "Voucher sales platform for aerobatic flights.", "PROJECT / M02", "FilmoLot.pl", "Aviation · photography and video",
    "06", "COMMS", "Contact", "Set the scope and responsibility.", "Describe the project, process or decision that should begin the conversation.", "Discuss an aviation project",
    "© 2026 Paweł Mamcarz · mamcarz.com", "Home", "Advisory", "Applications", "Aviation", "Projects", "Insights", "Contact"
  ])
});

const AVIATION_COMMENTS = Object.freeze(["NAV", "HERO", "OPERATIONS", "TRAINING AND SAFETY", "MEDIA", "SOFTWARE", "VENTURES", "CONTACT", "FOOTER"]);

function verifyAviationFactContract(path, factData, errors) {
  const records = Array.isArray(factData.facts) ? factData.facts.filter(isPlainObject) : [];
  const immutableKeys = ["id", "value", "display_pl", "display_en", "kind", "as_of", "source_type", "source_label", "source_url", "surfaces", "status"];
  const valid = AVIATION_FACT_CONTRACT.every((expected) => {
    const matches = records.filter((record) => record.id === expected.id);
    if (matches.length !== 1) return false;
    const actual = matches[0];
    return immutableKeys.every((key) => Array.isArray(expected[key])
      ? JSON.stringify(actual[key]) === JSON.stringify(expected[key])
      : actual[key] === expected[key]);
  });
  if (!valid) {
    error(errors, "aviation-fact-contract", path, "requires the immutable owner-approved values, provenance, state and exact surfaces for all eleven Task 3 facts");
  }
}

function aviationBodyTextLeaves(body) {
  return documentNodeDescendants(body)
    .filter((node) => node.type === "text" && node.value.trim().length > 0)
    .filter((node) => {
      for (let current = node.parent; current?.type === "element"; current = current.parent) {
        if (current.name === "script" || current.name === "style") return false;
      }
      return true;
    })
    .map((node) => normalizeExactHtmlLiteral(node.value));
}

function aviationCanonicalScanCorpus(parsedRoot) {
  let structuralText = "";
  const rawSurfaces = [];
  const visit = (node) => {
    if (node.type === "text") {
      structuralText += node.value;
      return;
    }
    if (node.type === "comment") {
      rawSurfaces.push(node.value);
      return;
    }
    const block = node.type === "element" && blockTextElements.has(node.name);
    if (block) structuralText += " ";
    if (node.type === "element") {
      for (const value of node.attributes.values()) if (typeof value === "string") rawSurfaces.push(value);
    }
    for (const child of node.children ?? []) visit(child);
    if (block) structuralText += " ";
  };
  visit(parsedRoot);
  return [structuralText, ...rawSurfaces].map((value) => normalize(decodeHtmlEntities(value)));
}

function verifyAviationTextContract(path, parsedRoot, lang, body, errors) {
  const leaves = aviationBodyTextLeaves(body);
  const expectedLeaves = AVIATION_BODY_TEXT_LEAVES[lang].map(normalizeExactLiteral);
  const comments = documentNodeDescendants(parsedRoot)
    .filter((node) => node.type === "comment")
    .map((node) => normalizeExactHtmlLiteral(node.value));
  if (JSON.stringify(leaves) !== JSON.stringify(expectedLeaves)
    || JSON.stringify(comments) !== JSON.stringify(AVIATION_COMMENTS)) {
    error(errors, "aviation-text-contract", path, "requires the complete localized Task 3 text-leaf and comment inventory with no unowned factual copy");
  }
}

function verifyAviationNavigation(path, parsedRoot, lang, errors) {
  const expected = AVIATION_NAVIGATION_CONTRACT[lang];
  const elements = elementDescendants(parsedRoot);
  const navs = elements.filter((element) => element.name === "nav" && elementHasClass(element, "site-nav") && pageElementIsActive(element));
  const nav = navs.length === 1 ? navs[0] : null;
  const children = directElementChildren(nav);
  const [logo, menu, language, toggle] = children;
  const menuItems = directElementChildren(menu, "li");
  const advisory = directElementChildren(menuItems[0], "details")[0];
  const summary = directElementChildren(advisory, "summary")[0];
  const submenu = directElementChildren(advisory, "ul")[0];
  const submenuItems = directElementChildren(submenu, "li");
  const submenuLinks = submenuItems.map((item) => directElementChildren(item, "a"));
  const primaryLinks = menuItems.slice(1).map((item) => directElementChildren(item, "a"));
  const toggleSpans = directElementChildren(toggle, "span");
  const submenuValid = submenuItems.length === expected.submenu.length
    && submenuLinks.every((links, index) => links.length === 1
      && exactElementAttributes(links[0], { href: expected.submenu[index][0] })
      && publishedStaticText(links[0]) === normalizeExactLiteral(expected.submenu[index][1]));
  const primaryValid = primaryLinks.length === expected.primary.length
    && primaryLinks.every((links, index) => {
      const [href, label, current] = expected.primary[index];
      return links.length === 1
        && exactApplicationAttributes(links[0], current ? { href, "aria-current": "page" } : { href })
        && exactStaticVisibleText(links[0]) === normalizeExactLiteral(label);
    });
  const valid = nav !== null
    && exactApplicationAttributes(nav, { class: "site-nav", "aria-label": expected.ariaLabel }, new Set(["aria-label"]))
    && children.length === 4
    && logo?.name === "a"
    && exactElementAttributes(logo, { href: expected.logoHref, class: "nav-logo" })
    && exactStaticVisibleText(logo) === normalizeExactLiteral("PM · Mamcarz.com")
    && menu?.name === "ul"
    && exactElementAttributes(menu, { class: "nav-list", id: "nav-menu" })
    && menuItems.length === expected.primary.length + 1
    && advisory?.name === "details"
    && exactElementAttributes(advisory, { class: "nav-group" })
    && summary?.name === "summary"
    && exactElementAttributes(summary, {})
    && exactStaticVisibleText(summary) === normalizeExactLiteral(expected.advisory)
    && submenu?.name === "ul"
    && exactElementAttributes(submenu, { class: "nav-submenu" })
    && submenuValid
    && primaryValid
    && language?.name === "a"
    && exactElementAttributes(language, { href: expected.languageHref, class: "nav-lang" })
    && exactStaticVisibleText(language) === normalizeExactLiteral(expected.languageLabel)
    && toggle?.name === "button"
    && exactApplicationAttributes(toggle, { class: "nav-toggle", id: "nav-toggle", "aria-label": expected.toggleLabel, "aria-controls": "nav-menu", "aria-expanded": "false" }, new Set(["aria-label"]))
    && directElementChildren(toggle).length === 3
    && toggleSpans.length === 3
    && toggleSpans.every((span) => exactElementAttributes(span, {}) && exactStaticVisibleText(span) === "");
  if (!valid) {
    error(errors, "aviation-shell", path, "requires the exact localized navigation, current aviation route and closed mobile disclosure semantics");
  }
  return nav;
}

function verifyAviationDocumentBoundary(path, parsedRoot, errors) {
  const nodes = documentNodeDescendants(parsedRoot);
  const doctypes = nodes.filter((node) => node.type === "doctype");
  const significant = parsedRoot.children.filter((node) => node.type !== "comment" && (node.type !== "text" || node.value.trim().length > 0));
  const html = significant.find((node) => node.type === "element" && node.name === "html");
  if (doctypes.length !== 1
    || doctypes[0].parent !== parsedRoot
    || !/^<!doctype\s+html\s*>$/i.test(doctypes[0].source)
    || significant.length !== 2
    || significant[0] !== doctypes[0]
    || significant[1] !== html) {
    error(errors, "aviation-document-boundary", path, "requires one HTML5 doctype and one owned html root with no published nodes outside it");
  }
}

function aviationExpectedAnchorHrefs(lang) {
  const navigation = AVIATION_NAVIGATION_CONTRACT[lang];
  const home = navigation.logoHref;
  const footer = lang === "pl"
    ? ["/", "/uslugi/transformacja-zakupow/", "/aplikacje-operacyjne/", "/lotnictwo/", "/case-studies/", "/wiedza/", "/#contact"]
    : ["/en/", "/en/uslugi/transformacja-zakupow/", "/en/aplikacje-operacyjne/", "/en/lotnictwo/", "/en/case-studies/", "/en/wiedza/", "/en/#contact"];
  return [
    "#main", home,
    ...navigation.submenu.map(([href]) => href),
    ...navigation.primary.map(([href]) => href),
    navigation.languageHref,
    home,
    AVIATION_PAGE_CONTRACT[lang].contactHref,
    home,
    ...footer
  ];
}

function verifyAviationResourceCensus(path, parsedRoot, lang, body, footer, errors) {
  const all = elementDescendants(parsedRoot);
  const head = all.filter((element) => element.name === "head")[0] ?? null;
  const links = all.filter((element) => element.name === "link");
  const expectedLinks = AVIATION_RESOURCE_LINKS[lang];
  const linksValid = links.length === expectedLinks.length
    && links.every((link, index) => link.parent === head && exactApplicationResourceAttributes(link, expectedLinks[index]));
  const scripts = all.filter((element) => element.name === "script");
  const bodyChildren = directElementChildren(body);
  const scriptsValid = scripts.length === 2
    && scripts[0]?.parent === head
    && exactApplicationResourceAttributes(scripts[0], { type: "application/ld+json" })
    && scripts[1]?.parent === body
    && bodyChildren.at(-1) === scripts[1]
    && exactApplicationResourceAttributes(scripts[1], { src: "/assets/js/main.js?v=20260825-flightplan-2", defer: null })
    && rawElementText(scripts[1]).trim() === "";
  const pictures = all.filter((element) => element.name === "picture");
  const sources = all.filter((element) => element.name === "source");
  const images = all.filter((element) => element.name === "img");
  const venturePicture = pictures[0];
  const ventureImage = images.find((image) => elementHasClass(image.parent, "aviation-venture-image"));
  const footerSign = all.find((element) => element.name === "a" && elementHasClass(element, "footer-sign"));
  const signature = images.find((image) => image.parent === footerSign);
  const mediaValid = pictures.length === 1
    && exactApplicationResourceAttributes(venturePicture, { class: "aviation-venture-image" })
    && sources.length === 1
    && sources[0].parent === venturePicture
    && exactApplicationResourceAttributes(sources[0], { type: "image/webp", srcset: "/assets/img/portfolio/akrobacja.webp" })
    && images.length === 2
    && ventureImage?.parent === venturePicture
    && exactApplicationResourceAttributes(ventureImage, { src: "/assets/img/portfolio/akrobacja.jpg", alt: lang === "pl" ? "Widok projektu akrobacja.com" : "View of the akrobacja.com project", width: "1400", height: "492", loading: "lazy", decoding: "async" })
    && footerSign !== undefined
    && elementIsWithin(footerSign, footer)
    && exactApplicationResourceAttributes(signature, { src: "/assets/img/signature.png", alt: "", width: "160", height: "50", loading: "lazy", decoding: "async" });
  const anchors = all.filter((element) => element.name === "a");
  const anchorsValid = JSON.stringify(anchors.map((anchor) => browserNormalizedUrl(elementAttribute(anchor, "href")))) === JSON.stringify(aviationExpectedAnchorHrefs(lang));
  const forbiddenTags = new Set([...APPLICATION_ZERO_RESOURCE_TAGS].filter((name) => name !== "picture" && name !== "source"));
  const resourceAttributesValid = all.every((element) => {
    const names = [...element.attributes.keys()].filter((name) => APPLICATION_RESOURCE_ATTRIBUTE_NAMES.has(name));
    return names.length === 0 || new Set(["a", "link", "script", "img", "source"]).has(element.name);
  });
  const valid = linksValid
    && scriptsValid
    && mediaValid
    && anchorsValid
    && all.filter((element) => forbiddenTags.has(element.name)).length === 0
    && all.filter((element) => element.name === "style").length === 0
    && all.filter((element) => element.attributes.has("style")).length === 0
    && resourceAttributesValid;
  if (!valid) {
    error(errors, "aviation-resource-census", path, "requires the exact local links, scripts, Akrobacja picture, signature image and zero other resource or inline-style surfaces");
  }
}

function verifyAviationShell(path, parsedRoot, lang, body, main, nav, errors) {
  const children = directElementChildren(body);
  const [skip, shellNav, overlay, back, shellMain, footer, script] = children;
  const valid = exactElementAttributes(body, { class: "aviation-page", "data-page": "aviation" })
    && children.length === 7
    && skip?.name === "a"
    && exactElementAttributes(skip, { href: "#main", class: "skip-link" })
    && shellNav === nav
    && overlay?.name === "div"
    && exactElementAttributes(overlay, { class: "nav-overlay", id: "nav-overlay" })
    && back?.name === "button"
    && exactApplicationAttributes(back, { class: "back-to-top", id: "backToTop", "aria-label": lang === "pl" ? "Wróć na górę" : "Back to top" }, new Set(["aria-label"]))
    && shellMain === main
    && exactElementAttributes(main, { id: "main", tabindex: "-1" })
    && footer?.name === "footer"
    && exactElementAttributes(footer, { class: "site-footer" })
    && script?.name === "script";
  if (!valid) error(errors, "aviation-shell", path, "requires the exact localized seven-part Flight Plan body shell");
  verifyAviationTextContract(path, parsedRoot, lang, body, errors);
  verifyAviationResourceCensus(path, parsedRoot, lang, body, footer, errors);
}

function verifyAviationDocumentManifest(path, parsedRoot, lang, errors) {
  const actual = applicationDocumentManifestDigest(parsedRoot);
  const expected = AVIATION_DOCUMENT_MANIFEST[lang];
  if (actual.elementCount !== expected.elementCount || actual.digest !== expected.digest) {
    error(errors, "aviation-document-manifest", path, `requires the exact Task 3 element and attribute manifest; actual-manifest=${lang}:${actual.elementCount}:${actual.digest}`);
  }
}

function verifyAviationPage(path, parsedRoot, lang, factData, errors) {
  const expected = AVIATION_PAGE_CONTRACT[lang];
  const all = elementDescendants(parsedRoot);
  const body = htmlBodyRoot(parsedRoot);
  const main = all.find((element) => element.name === "main" && elementAttribute(element, "id") === "main");
  verifyAviationFactContract(path, factData, errors);
  verifyAviationDocumentBoundary(path, parsedRoot, errors);
  const aviationNav = verifyAviationNavigation(path, parsedRoot, lang, errors);
  if (body === null || elementAttribute(body, "data-page") !== "aviation") {
    error(errors, "aviation-data-page", path, 'body must use data-page="aviation"');
  }
  const h1s = all.filter((element) => element.name === "h1" && pageElementIsActive(element));
  if (h1s.length !== 1 || publishedStaticText(h1s[0]) !== normalizeExactLiteral(expected.title)) {
    error(errors, "aviation-h1", path, "requires the exact localized aviation h1");
  }
  const leads = all.filter((element) => elementHasClass(element, "page-lead") && pageElementIsActive(element));
  if (leads.length !== 1 || publishedStaticText(leads[0]) !== normalizeExactLiteral(expected.lead)) {
    error(errors, "aviation-lead", path, "requires the exact owner-approved aviation lead");
  }
  const directSections = directElementChildren(main, "section");
  const sectionMarkers = all.filter((element) => element.attributes.has("data-section"));
  const sectionNames = sectionMarkers.map((section) => elementAttribute(section, "data-section"));
  if (JSON.stringify(sectionNames) !== JSON.stringify(AVIATION_SECTION_ORDER)
    || sectionMarkers.length !== directSections.length
    || sectionMarkers.some((section, index) => section !== directSections[index] || !pageElementIsActive(section))) {
    error(errors, "aviation-sections", path, "requires six direct visible operating sectors exactly once and in order");
  }

  const byId = new Map(AVIATION_FACT_CONTRACT.map((record) => [record.id, record]));
  const factElements = all.filter((element) => element.attributes.has("data-fact-id"));
  const factIds = factElements.map((element) => elementAttribute(element, "data-fact-id"));
  let factsValid = JSON.stringify(factIds) === JSON.stringify(AVIATION_FACT_ORDER);
  for (const [index, factId] of factIds.entries()) {
    const record = byId.get(factId);
    const display = lang === "pl" ? record?.display_pl : record?.display_en;
    factsValid = factsValid
      && AVIATION_FACT_ORDER[index] === factId
      && record?.status === "approved"
      && record?.source_url === null
      && Array.isArray(record?.surfaces)
      && record.surfaces.includes(path)
      && publishedStaticText(factElements[index]) === normalizeExactLiteral(display ?? "")
      && directElementChildren(factElements[index], "a").length === 0;
  }
  if (!factsValid) {
    error(errors, "aviation-facts", path, "requires the exact ordered approved aviation fact surfaces and localized registry values as plain text");
  }
  const status = factElements.find((element) => elementAttribute(element, "data-fact-id") === "portfolio.akrobacja_com.current_status");
  if (status?.name !== "time" || elementAttribute(status, "datetime") !== "2026-08-26" || elementAttribute(status, "data-as-of") !== "2026-08-26") {
    error(errors, "aviation-status-date", path, "akrobacja.com current status requires the visible approved as-of date 2026-08-26");
  }

  const pictures = all.filter((element) => elementHasClass(element, "aviation-venture-image"));
  const sources = pictures.length === 1 ? elementDescendants(pictures[0], "source") : [];
  const images = pictures.length === 1 ? elementDescendants(pictures[0], "img") : [];
  if (pictures.length !== 1 || sources.length !== 1 || images.length !== 1
    || elementAttribute(sources[0], "srcset") !== "/assets/img/portfolio/akrobacja.webp"
    || elementAttribute(images[0], "src") !== "/assets/img/portfolio/akrobacja.jpg") {
    error(errors, "aviation-image", path, "requires the single approved local Akrobacja webp/jpg image pair");
  }

  const schemaScripts = all.filter((element) => element.name === "script" && elementAttribute(element, "type") === "application/ld+json");
  let schema = null;
  try { schema = schemaScripts.length === 1 ? JSON.parse(rawElementText(schemaScripts[0])) : null; } catch { schema = null; }
  const provider = isPlainObject(schema?.provider) ? schema.provider : null;
  if (!isPlainObject(schema)
    || !sameStringSet(Object.keys(schema), ["@context", "@type", "name", "url", "description", "provider"])
    || schema["@context"] !== "https://schema.org"
    || schema["@type"] !== "Service"
    || schema.name !== expected.title
    || schema.url !== expected.url
    || schema.description !== expected.description
    || !isPlainObject(provider)
    || !sameStringSet(Object.keys(provider), ["@type", "name"])
    || provider["@type"] !== "Person"
    || provider.name !== "Paweł Mamcarz") {
    error(errors, "aviation-schema", path, "requires one localized claim-safe Service schema with provider only");
  }

  const ctas = all.filter((element) => elementHasClass(element, "btn-primary") && pageElementIsActive(element));
  const mailtoAnchors = all.filter((element) => element.name === "a" && /^mailto:/i.test(browserNormalizedUrl(elementAttribute(element, "href")) ?? ""));
  const conversionControls = all.filter((element) => (element.name === "a" || element.name === "button")
    && ["btn-primary", "btn-secondary", "btn-ghost", "cta-link"].some((className) => elementHasClass(element, className)));
  const contact = directSections.find((section) => elementAttribute(section, "data-section") === "contact");
  if (ctas.length !== 1
    || mailtoAnchors.length !== 1
    || conversionControls.length !== 1
    || ctas[0] !== mailtoAnchors[0]
    || ctas[0] !== conversionControls[0]
    || ctas[0].name !== "a"
    || !exactElementAttributes(ctas[0], { class: "btn-primary", href: expected.contactHref })
    || publishedStaticText(ctas[0]) !== normalizeExactLiteral(lang === "pl" ? "Porozmawiaj o projekcie lotniczym" : "Discuss an aviation project")
    || !elementIsWithin(ctas[0], contact)) {
    error(errors, "aviation-contact", path, "requires exactly one localized mailto CTA inside contact");
  }

  const forbidden = /warsaw[\s-]*flight[\s-]*safety|pasja\s+po\s+godzinach|po\s+godzinach|outside\s+work|beyond\s+work|after[ -]?hours?|side[ -]?project|\binstruktor\b|\binstructor\b|\bato\b|\boperator\b|commercial[ -]?pilot|pilot\s+komercyjny|\bszko(?:ła|ły|le)\b|\bschool\b|\bavailab(?:le|ility)\b|\bdostępn|\bpric(?:e|es|ing)\b|\bcen(?:a|y|nik)\b|market[ -]?leader|lider\s+rynku/;
  if (aviationCanonicalScanCorpus(parsedRoot).some((surface) => forbidden.test(surface))) {
    error(errors, "aviation-forbidden-copy", path, "contains retired, side-activity or unsupported aviation claim language");
  }
  const anchors = all.filter((element) => element.name === "a");
  if (anchors.some((anchor) => /^https?:\/\//i.test(browserNormalizedUrl(elementAttribute(anchor, "href")) ?? ""))) {
    error(errors, "aviation-external-link", path, "aviation pages may not invent or publish an external venture URL");
  }
  verifyAviationShell(path, parsedRoot, lang, body, main, aviationNav, errors);
  verifyAviationDocumentManifest(path, parsedRoot, lang, errors);
}

const KNOWLEDGE_CONTRACT = Object.freeze({
  pl: Object.freeze({
    title: "Wiedza",
    purpose: "Analizy, wystąpienia i narzędzia, które porządkują decyzje w procurement, technologii i operacjach.",
    url: "https://mamcarz.com/wiedza/",
    ctaHref: "/#contact",
    ctaLabel: "Przejdź do kontaktu",
    breadcrumbLabel: "Okruszki", breadcrumbHomeHref: "/", breadcrumbHome: "Strona główna",
    kicker: "RESEARCH INDEX / 02 ENTRIES", catalogue: "Katalog", catalogueCopy: "Materiały dostępne bezpośrednio w tym serwisie.",
    contactLabel: "KONTAKT / NASTĘPNY KROK", contactCopy: "Jeśli materiał dotyczy decyzji, nad którą pracujesz, przejdź do rozmowy.",
    ogLocale: "pl_PL", skip: "Przejdź do treści", navLabel: "Nawigacja główna", home: "/", logoLabel: "Paweł Mamcarz, strona główna",
    advisory: "Doradztwo", paired: "/en/wiedza/", pairedLabel: "EN", toggle: "Menu nawigacyjne", back: "Wróć na górę",
    submenu: Object.freeze([["/uslugi/transformacja-zakupow/", "Transformacja zakupów"], ["/uslugi/wdrozenie-sap-ariba/", "Wdrożenie SAP Ariba"], ["/uslugi/doradztwo-zamowienia-publiczne/", "Zamówienia publiczne"]]),
    primary: Object.freeze([["/aplikacje-operacyjne/", "Aplikacje"], ["/lotnictwo/", "Lotnictwo"], ["/case-studies/", "Projekty"], ["/wiedza/", "Wiedza", true], ["/#about", "O mnie"], ["/#contact", "Kontakt"]]),
    footer: Object.freeze([["/", "Strona główna"], ["/uslugi/transformacja-zakupow/", "Doradztwo"], ["/aplikacje-operacyjne/", "Aplikacje"], ["/lotnictwo/", "Lotnictwo"], ["/case-studies/", "Projekty"], ["/wiedza/", "Wiedza"], ["/#contact", "Kontakt"]]),
    resources: Object.freeze([
      Object.freeze({ href: "/procurement-2026/", title: "Procurement Process 2026", type: "Model interaktywny", language: "Polski", status: "Zasób w serwisie", inLanguage: "pl", lang: null }),
      Object.freeze({ href: "/wystapienia/", title: "Wystąpienia i wykłady", type: "Wystąpienia i wykłady", language: "Polski", status: "Zasób w serwisie", inLanguage: "pl", lang: null })
    ])
  }),
  en: Object.freeze({
    title: "Insights",
    purpose: "Analysis, talks and tools that clarify decisions in procurement, technology and operations.",
    url: "https://mamcarz.com/en/wiedza/",
    ctaHref: "/en/#contact",
    ctaLabel: "Go to contact",
    breadcrumbLabel: "Breadcrumb", breadcrumbHomeHref: "/en/", breadcrumbHome: "Home",
    kicker: "RESEARCH INDEX / 03 ENTRIES", catalogue: "Catalogue", catalogueCopy: "Materials available directly on this site.",
    contactLabel: "CONTACT / NEXT STEP", contactCopy: "If a resource relates to a decision you are working on, continue to the conversation.",
    ogLocale: "en_US", skip: "Skip to content", navLabel: "Main navigation", home: "/en/", logoLabel: "Paweł Mamcarz, homepage",
    advisory: "Advisory", paired: "/wiedza/", pairedLabel: "PL", toggle: "Navigation menu", back: "Back to top",
    submenu: Object.freeze([["/en/uslugi/transformacja-zakupow/", "Procurement transformation"], ["/en/uslugi/wdrozenie-sap-ariba/", "SAP Ariba implementation"], ["/en/uslugi/doradztwo-zamowienia-publiczne/", "Public procurement"]]),
    primary: Object.freeze([["/en/aplikacje-operacyjne/", "Applications"], ["/en/lotnictwo/", "Aviation"], ["/en/case-studies/", "Projects"], ["/en/wiedza/", "Insights", true], ["/en/#about", "About"], ["/en/#contact", "Contact"]]),
    footer: Object.freeze([["/en/", "Home"], ["/en/uslugi/transformacja-zakupow/", "Advisory"], ["/en/aplikacje-operacyjne/", "Applications"], ["/en/lotnictwo/", "Aviation"], ["/en/case-studies/", "Projects"], ["/en/wiedza/", "Insights"], ["/en/#contact", "Contact"]]),
    resources: Object.freeze([
      Object.freeze({ href: "/infographic_procurement_2026_EN.html", title: "Procurement 2026: From Traditional Cycle to AI Orchestration", type: "Infographic", language: "English", status: "On-site resource", inLanguage: "en", lang: null }),
      Object.freeze({ href: "/en/wystapienia/", title: "Speaking & Lectures", type: "Talks and lectures", language: "English", status: "On-site resource", inLanguage: "en", lang: null }),
      Object.freeze({ href: "/procurement-2026/", title: "Procurement Process 2026", type: "Interactive model", language: "Polish", status: "Polish-language resource", inLanguage: "pl", lang: "pl" })
    ])
  })
});

const KNOWLEDGE_URL_SEQUENCE = Object.freeze({
  pl: Object.freeze([
    "https://mamcarz.com/wiedza/", "https://mamcarz.com/wiedza/", "https://mamcarz.com/en/wiedza/", "https://mamcarz.com/wiedza/",
    "/favicon.svg", "/assets/fonts/barlow-semi-condensed-latin-600-normal.woff2", "/assets/fonts/barlow-semi-condensed-latin-ext-600-normal.woff2", "/assets/css/style.css?v=20260825-flightplan-2",
    "#main", "/", "/uslugi/transformacja-zakupow/", "/uslugi/wdrozenie-sap-ariba/", "/uslugi/doradztwo-zamowienia-publiczne/",
    "/aplikacje-operacyjne/", "/lotnictwo/", "/case-studies/", "/wiedza/", "/#about", "/#contact", "/en/wiedza/", "/",
    "/procurement-2026/", "/wystapienia/", "/#contact", "/", "/assets/img/signature.png", "/", "/uslugi/transformacja-zakupow/",
    "/aplikacje-operacyjne/", "/lotnictwo/", "/case-studies/", "/wiedza/", "/#contact", "/assets/js/main.js?v=20260825-flightplan-2"
  ]),
  en: Object.freeze([
    "https://mamcarz.com/en/wiedza/", "https://mamcarz.com/wiedza/", "https://mamcarz.com/en/wiedza/", "https://mamcarz.com/wiedza/",
    "/favicon.svg", "/assets/fonts/barlow-semi-condensed-latin-600-normal.woff2", "/assets/fonts/barlow-semi-condensed-latin-ext-600-normal.woff2", "/assets/css/style.css?v=20260825-flightplan-2",
    "#main", "/en/", "/en/uslugi/transformacja-zakupow/", "/en/uslugi/wdrozenie-sap-ariba/", "/en/uslugi/doradztwo-zamowienia-publiczne/",
    "/en/aplikacje-operacyjne/", "/en/lotnictwo/", "/en/case-studies/", "/en/wiedza/", "/en/#about", "/en/#contact", "/wiedza/", "/en/",
    "/infographic_procurement_2026_EN.html", "/en/wystapienia/", "/procurement-2026/", "/en/#contact", "/en/", "/assets/img/signature.png", "/en/",
    "/en/uslugi/transformacja-zakupow/", "/en/aplikacje-operacyjne/", "/en/lotnictwo/", "/en/case-studies/", "/en/wiedza/", "/en/#contact", "/assets/js/main.js?v=20260825-flightplan-2"
  ])
});

function knowledgeResourceMarkup(resource, index, lang) {
  const labels = lang === "pl" ? ["Typ", "Język", "Status"] : ["Type", "Language", "Status"];
  return `<article class="knowledge-entry" data-resource><span class="knowledge-entry__number" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span><h2 class="knowledge-entry__title"><a href="${resource.href}"${resource.lang ? ` lang="${resource.lang}"` : ""}>${resource.title}</a></h2><dl class="knowledge-entry__meta"><div><dt>${labels[0]}</dt><dd data-meta="type">${resource.type}</dd></div><div><dt>${labels[1]}</dt><dd data-meta="language">${resource.language}</dd></div><div><dt>${labels[2]}</dt><dd data-meta="status">${resource.status}</dd></div></dl></article>`;
}

function knowledgeMainMarkup(contract, lang) {
  const resources = contract.resources.map((resource, index) => knowledgeResourceMarkup(resource, index, lang)).join("");
  return `<main id="main" tabindex="-1"><header class="page-hero knowledge-hero"><div class="page-hero-content"><nav class="breadcrumb" aria-label="${contract.breadcrumbLabel}"><a href="${contract.breadcrumbHomeHref}">${contract.breadcrumbHome}</a><span aria-hidden="true">/</span><span aria-current="page">${contract.title}</span></nav><p class="knowledge-kicker">${contract.kicker}</p><h1 class="page-title">${contract.title}</h1><p class="page-lead">${contract.purpose}</p></div></header><section class="knowledge-index" data-section="resources"><div class="section-shell knowledge-index__head"><p class="section-label">${contract.catalogue}</p><p>${contract.catalogueCopy}</p></div>${resources}</section><aside class="knowledge-contact"><div class="section-shell knowledge-contact__inner"><p class="knowledge-contact__label">${contract.contactLabel}</p><p>${contract.contactCopy}</p><a class="btn-primary" href="${contract.ctaHref}">${contract.ctaLabel}</a></div></aside></main>`;
}

function knowledgeNodeShape(node) {
  if (node?.type === "text") {
    let text = normalizeExactHtmlLiteral(node.value);
    if (node.parent?.type === "element" && node.parent.name === "script"
      && elementAttribute(node.parent, "type") === "application/ld+json") {
      try { text = JSON.stringify(JSON.parse(node.value)); } catch { /* preserve malformed source for mismatch */ }
    }
    return text.length > 0 ? { text } : null;
  }
  if (node?.type !== "element") return null;
  return {
    name: node.name,
    attributes: Object.fromEntries([...node.attributes.entries()].sort(([left], [right]) => left.localeCompare(right))),
    sourceAttributeCount: node.attributes.sourceAttributeCount ?? node.attributes.size,
    children: (node.children ?? []).map(knowledgeNodeShape).filter(Boolean)
  };
}

function knowledgeExpectedMainShape(contract, lang) {
  const expected = parseStaticHtml(knowledgeMainMarkup(contract, lang));
  return knowledgeNodeShape(directElementChildren(expected.root, "main")[0]);
}

function knowledgeDocumentMarkup(contract, lang) {
  const url = contract.url;
  const plUrl = "https://mamcarz.com/wiedza/";
  const enUrl = "https://mamcarz.com/en/wiedza/";
  const submenu = contract.submenu.map(([href, label]) => `<li><a href="${href}">${label}</a></li>`).join("");
  const primary = contract.primary.map(([href, label, current]) => `<li><a href="${href}"${current ? ' aria-current="page"' : ""}>${label}</a></li>`).join("");
  const footer = contract.footer.map(([href, label]) => `<li><a href="${href}">${label}</a></li>`).join("");
  return `<html lang="${lang}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${contract.title} · Paweł Mamcarz</title><meta name="description" content="${contract.purpose}"><meta name="author" content="Paweł Mamcarz"><meta name="robots" content="index, follow"><link rel="canonical" href="${url}"><link rel="alternate" hreflang="pl" href="${plUrl}"><link rel="alternate" hreflang="en" href="${enUrl}"><link rel="alternate" hreflang="x-default" href="${plUrl}"><meta property="og:title" content="${contract.title} · Paweł Mamcarz"><meta property="og:description" content="${contract.purpose}"><meta property="og:type" content="website"><meta property="og:url" content="${url}"><meta property="og:image" content="https://mamcarz.com/assets/img/og.jpg"><meta property="og:image:alt" content="${contract.title} · Paweł Mamcarz"><meta property="og:locale" content="${contract.ogLocale}"><meta property="og:site_name" content="Paweł Mamcarz"><script type="application/ld+json">${JSON.stringify(knowledgeSchema(contract, lang))}</script><link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="preload" as="font" type="font/woff2" href="/assets/fonts/barlow-semi-condensed-latin-600-normal.woff2" crossorigin><link rel="preload" as="font" type="font/woff2" href="/assets/fonts/barlow-semi-condensed-latin-ext-600-normal.woff2" crossorigin><link rel="stylesheet" href="/assets/css/style.css?v=20260825-flightplan-2"></head><body class="knowledge-page" data-page="knowledge"><a href="#main" class="skip-link">${contract.skip}</a><nav class="site-nav" aria-label="${contract.navLabel}"><a href="${contract.home}" class="nav-logo"><b>PM</b> · Mamcarz.com</a><ul class="nav-list" id="nav-menu"><li><details class="nav-group"><summary>${contract.advisory}</summary><ul class="nav-submenu">${submenu}</ul></details></li>${primary}</ul><a href="${contract.paired}" class="nav-lang">${contract.pairedLabel}</a><button class="nav-toggle" id="nav-toggle" aria-label="${contract.toggle}" aria-controls="nav-menu" aria-expanded="false"><span></span><span></span><span></span></button></nav><div class="nav-overlay" id="nav-overlay"></div><button class="back-to-top" id="backToTop" aria-label="${contract.back}">↑</button>${knowledgeMainMarkup(contract, lang)}<footer class="site-footer"><div class="footer-brand"><a class="footer-sign" href="${contract.home}" aria-label="${contract.logoLabel}"><img src="/assets/img/signature.png" alt="" width="160" height="50" loading="lazy" decoding="async"></a><div class="footer-copy">© 2026 Paweł Mamcarz · mamcarz.com</div></div><ul class="footer-links">${footer}</ul></footer><script src="/assets/js/main.js?v=20260825-flightplan-2" defer></script></body></html>`;
}

function knowledgeExpectedDocumentShape(contract, lang) {
  const expected = parseStaticHtml(knowledgeDocumentMarkup(contract, lang));
  return knowledgeNodeShape(directElementChildren(expected.root, "html")[0]);
}

function sameJsonContract(actual, expected) {
  if (Array.isArray(expected)) {
    return Array.isArray(actual)
      && actual.length === expected.length
      && expected.every((value, index) => sameJsonContract(actual[index], value));
  }
  if (isPlainObject(expected)) {
    return isPlainObject(actual)
      && sameStringSet(Object.keys(actual), Object.keys(expected))
      && Object.entries(expected).every(([key, value]) => sameJsonContract(actual[key], value));
  }
  return actual === expected;
}

function knowledgeSchema(contract, lang) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: contract.title,
    url: contract.url,
    description: contract.purpose,
    inLanguage: lang,
    hasPart: contract.resources.map((resource) => ({
      "@type": "CreativeWork",
      name: resource.title,
      url: `https://mamcarz.com${resource.href}`,
      inLanguage: resource.inLanguage
    }))
  };
}

function decodeValidPercentEscapes(value) {
  let decoded = value;
  for (let pass = 0; pass < 8; pass += 1) {
    const next = decoded.replace(/%([0-9a-f]{2})/gi, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

function knowledgeCanonicalPath(value) {
  if (typeof value !== "string") return null;
  let candidate = decodeHtmlEntities(value)
    .replace(/[\u0009\u000a\u000d]/g, "")
    .replace(/\p{Default_Ignorable_Code_Point}/gu, "")
    .trim();
  candidate = decodeValidPercentEscapes(candidate)
    .replace(/[\u0009\u000a\u000d]/g, "")
    .replace(/\p{Default_Ignorable_Code_Point}/gu, "");
  try {
    const url = new URL(candidate, "https://mamcarz.com/");
    return decodeValidPercentEscapes(url.pathname)
      .replace(/\p{Default_Ignorable_Code_Point}/gu, "")
      .replace(/\\/g, "/")
      .toLowerCase();
  } catch {
    return null;
  }
}

function knowledgeUrlCandidates(attribute, value) {
  if (typeof value !== "string") return [];
  if (attribute === "srcset") return srcsetCandidateUrls(value);
  if (attribute === "ping") return decodeHtmlEntities(value).trim().split(/[\u0009-\u000d\u0020]+/).filter(Boolean);
  return [value];
}

const KNOWLEDGE_URL_ATTRIBUTE_NAMES = new Set([...APPLICATION_RESOURCE_ATTRIBUTE_NAMES, "itemid"]);

function knowledgeMetadataContentIsUrl(element) {
  if (element.name !== "meta" || !element.attributes.has("content")) return false;
  const semantic = ["name", "property", "itemprop", "http-equiv"]
    .map((name) => decodeHtmlEntities(elementAttribute(element, name) ?? "").toLowerCase())
    .join(" ")
    .trim();
  return /(?:^|[:._-])(?:url|image|logo|contenturl|thumbnailurl)(?:$|[:._-])/.test(semantic);
}

function knowledgeJsonUrlValues(value, values = []) {
  if (Array.isArray(value)) {
    for (const item of value) knowledgeJsonUrlValues(item, values);
    return values;
  }
  if (!isPlainObject(value)) return values;
  for (const [key, item] of Object.entries(value)) {
    if (/^(?:@id|url|contentUrl|embedUrl|thumbnailUrl|image|logo|sameAs)$/i.test(key)) {
      for (const candidate of Array.isArray(item) ? item : [item]) {
        if (typeof candidate === "string") values.push(candidate);
      }
    }
    knowledgeJsonUrlValues(item, values);
  }
  return values;
}

function knowledgeDocumentUrlValues(parsedRoot) {
  const values = [];
  for (const element of elementDescendants(parsedRoot)) {
    for (const [name, value] of element.attributes.entries()) {
      if (KNOWLEDGE_URL_ATTRIBUTE_NAMES.has(name)) {
        values.push(...knowledgeUrlCandidates(name, value));
      }
    }
    if (knowledgeMetadataContentIsUrl(element)) values.push(elementAttribute(element, "content"));
    if (element.name === "script" && elementAttribute(element, "type") === "application/ld+json") {
      try { knowledgeJsonUrlValues(JSON.parse(rawElementText(element)), values); } catch { /* schema verifier owns malformed JSON */ }
    }
  }
  return values.filter((value) => typeof value === "string");
}

function knowledgeHasMalformedPercent(value) {
  let candidate = decodeHtmlEntities(value).replace(/\p{Default_Ignorable_Code_Point}/gu, "");
  for (let pass = 0; pass < 8; pass += 1) {
    if (/%(?![0-9a-f]{2})/i.test(candidate)) return true;
    const next = decodeValidPercentEscapes(candidate);
    if (next === candidate) break;
    candidate = next;
  }
  return /%(?![0-9a-f]{2})/i.test(candidate);
}

function knowledgeHasBannedRoute(value) {
  return knowledgeCanonicalPath(value) === "/en/procurement-2026/";
}

function knowledgeInactiveSourceFragments(parsedRoot) {
  const nodes = documentNodeDescendants(parsedRoot);
  const inactive = new Set(["noscript", "template"]);
  const elementIsInactive = (element) => inactive.has(element.name)
    || element.attributes.has("hidden")
    || element.attributes.has("inert")
    || /^true$/i.test(elementAttribute(element, "aria-hidden") ?? "")
    || elementHasHiddenInlineStyle(element);
  const fragments = nodes
    .filter((node) => node.type === "comment")
    .map((node) => node.value);
  const parents = [parsedRoot, ...nodes.filter((node) => node.type === "element")];
  for (const parent of parents) {
    let run = [];
    const flush = () => {
      const joined = run.map((node) => node.type === "comment" ? node.value.trim() : rawElementText(node).trim()).join("");
      run = [];
      if (joined.length > 0) fragments.push(joined);
    };
    for (const child of parent.children ?? []) {
      if (child.type === "comment" || (child.type === "element" && elementIsInactive(child))) {
        run.push(child);
      } else if (child.type === "text" && child.value.trim() === "" && run.length > 0) {
        continue;
      } else if (run.length > 0) flush();
    }
    if (run.length > 0) flush();
  }
  return fragments;
}

function knowledgeEmbeddedUrlCandidates(fragment) {
  const source = decodeHtmlEntities(fragment)
    .replace(/[\u0009\u000a\u000d]/g, "")
    .replace(/\p{Default_Ignorable_Code_Point}/gu, "");
  const candidates = [];
  const add = (value) => {
    const candidate = value.trim().replace(/^[({[,]+|[)}\],.;:!]+$/g, "");
    if (candidate.length > 0) candidates.push(candidate);
  };
  for (const match of source.matchAll(/["']([^"']+)["']/g)) add(match[1]);
  for (const match of source.matchAll(/(?:^|[\s{,])(?:["']?[a-z][a-z0-9:._-]*["']?)\s*[:=]\s*(?:["']([^"']+)["']|([^\s"'<>},;]+))/gi)) {
    add(match[1] ?? match[2] ?? "");
  }
  for (const match of source.matchAll(/(?:\/|%(?:25)*2f)[^\s"'<>},;]+/gi)) add(match[0]);
  return [...new Set(candidates)];
}

function knowledgeInactiveUrlViolation(parsedRoot) {
  const candidates = knowledgeInactiveSourceFragments(parsedRoot).flatMap(knowledgeEmbeddedUrlCandidates);
  return candidates.some((value) => knowledgeHasBannedRoute(value)
    || (knowledgeHasMalformedPercent(value) && knowledgeHasBannedRoute(decodeValidPercentEscapes(value))));
}

function knowledgeUrlPropertyViolation(parsedRoot) {
  const candidates = [...knowledgeDocumentUrlValues(parsedRoot), ...knowledgeInactiveSourceFragments(parsedRoot)];
  return candidates.some((value) => knowledgeHasBannedRoute(value)
    || (knowledgeHasMalformedPercent(value) && /\/en\//i.test(decodeHtmlEntities(value))));
}

function knowledgeInactiveTemporalIdentifierViolation(parsedRoot) {
  const temporalHeads = new Set(["date", "time", "year", "timestamp", "temporal"]);
  const temporalQualifiers = new Set([
    "at", "coverage", "created", "creation", "end", "modified", "publication", "published", "release", "start", "updated", "upload"
  ]);
  const exactIdentifiers = new Set([
    "creationdate", "datecreated", "datemodified", "datepublished", "dateupdated", "endtime", "publicationdate",
    "publisheddate", "releasedate", "starttime", "temporalcoverage", "timecreated", "timemodified", "timestamp", "updatedate", "uploaddate"
  ]);
  for (const fragment of knowledgeInactiveSourceFragments(parsedRoot)) {
    const source = decodeHtmlEntities(fragment).replace(/\p{Default_Ignorable_Code_Point}/gu, "");
    for (const match of source.matchAll(/[a-z][a-z0-9_-]*/gi)) {
      const compact = match[0].replace(/[-_]+/g, "").toLowerCase();
      if (exactIdentifiers.has(compact)) return true;
      const words = match[0]
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[-_]+/g, " ")
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
      if (words.length > 1
        && words.some((word) => temporalHeads.has(word))
        && words.every((word) => temporalHeads.has(word) || temporalQualifiers.has(word))) return true;
    }
  }
  return false;
}

function knowledgeHasDateBoundaryViolation(parsedRoot) {
  const nodes = documentNodeDescendants(parsedRoot);
  const elements = nodes.filter((node) => node.type === "element");
  const dateName = /(?:^|[-_:])(?:date|dated|datetime|time|timestamp|year|published|publication|updated|modified|temporal)(?:$|[-_:])/i;
  const metadataViolation = elements.some((element) => {
    if ([...element.attributes.keys()].some((name) => dateName.test(name))) return true;
    if (element.name !== "meta") return false;
    return ["name", "property", "itemprop", "http-equiv"]
      .some((name) => dateName.test(decodeHtmlEntities(elementAttribute(element, name) ?? "")));
  });
  if (metadataViolation) return true;
  const schemaHasTemporalKey = (value) => {
    if (Array.isArray(value)) return value.some(schemaHasTemporalKey);
    if (!isPlainObject(value)) return false;
    return Object.entries(value).some(([key, item]) =>
      /(?:date|time|timestamp|year|published|publication|updated|modified|temporal)/i.test(key)
      || schemaHasTemporalKey(item));
  };
  for (const script of elements.filter((element) => element.name === "script" && elementAttribute(element, "type") === "application/ld+json")) {
    try {
      if (schemaHasTemporalKey(JSON.parse(rawElementText(script)))) return true;
    } catch { /* schema verifier owns malformed JSON */ }
  }

  const approvedTitles = new Set([
    "Procurement 2026: From Traditional Cycle to AI Orchestration",
    "Procurement Process 2026"
  ]);
  const approvedUrls = new Set([
    "https://mamcarz.com/infographic_procurement_2026_EN.html",
    "https://mamcarz.com/procurement-2026/",
    "/infographic_procurement_2026_EN.html",
    "/procurement-2026/"
  ]);
  const approvedSchemaLiterals = [...approvedTitles, ...approvedUrls];
  const fragments = [];
  for (const node of nodes) {
    if (node.type === "text" || node.type === "comment") {
      let value = node.value;
      const parent = node.parent;
      if (node.type === "text" && parent?.type === "element" && elementHasClass(parent, "footer-copy")
        && publishedStaticText(parent) === "© 2026 Paweł Mamcarz · mamcarz.com") {
        value = "";
      }
      if (node.type === "text" && parent?.type === "element" && parent.name === "script"
        && elementAttribute(parent, "type") === "application/ld+json") {
        for (const literal of approvedSchemaLiterals) value = value.split(literal).join("");
      } else if (node.type === "text" && parent?.type === "element" && parent.name === "a"
        && approvedTitles.has(publishedStaticText(parent))
        && approvedUrls.has(elementAttribute(parent, "href"))) {
        value = "";
      }
      fragments.push(value);
    }
    if (node.type === "element") {
      for (const [name, value] of node.attributes.entries()) {
        fragments.push(name);
        fragments.push(APPLICATION_RESOURCE_ATTRIBUTE_NAMES.has(name) && approvedUrls.has(value) ? "" : value ?? "");
      }
    }
  }
  const normalize = (value) => decodeHtmlEntities(value).replace(/\p{Default_Ignorable_Code_Point}/gu, "");
  const corpora = [fragments.map(normalize).join(" "), fragments.map((value) => normalize(value).trim()).join("")];
  const dateLiteral = /(?<!\d)\d{4}(?!\d)|(?<!\d)\d{4}[-/.](?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01])(?!\d)|(?<!\d)(?:0?[1-9]|[12]\d|3[01])[-/.](?:0?[1-9]|1[0-2])[-/.]\d{4}(?!\d)/;
  const clockLiteral = /(?<!\d)(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?!\d)/;
  const temporalClaim = /\b(?:published|publication|updated|modified|dated|timestamp|temporal|time)(?:[-_ ]?at)?\b/i;
  return corpora.some((corpus) => dateLiteral.test(corpus)
    || clockLiteral.test(corpus)
    || temporalClaim.test(corpus)
    || /datepublished|datemodified/i.test(corpus));
}

function knowledgeResourceSequence(parsedRoot) {
  return documentNodeDescendants(parsedRoot)
    .filter((node) => node.type === "element")
    .flatMap((element) => [...element.attributes.entries()]
      .filter(([name]) => APPLICATION_RESOURCE_ATTRIBUTE_NAMES.has(name))
      .map(([, value]) => value ?? ""));
}

function verifyKnowledgeDocumentContract(path, parsedRoot, lang, main, errors) {
  const all = elementDescendants(parsedRoot);
  const actualMain = knowledgeNodeShape(main);
  const expectedMain = knowledgeExpectedMainShape(KNOWLEDGE_CONTRACT[lang], lang);
  const anchorsHaveOwnedAttributes = all.filter((element) => element.name === "a").every((anchor) =>
    [...anchor.attributes.keys()].every((name) => ["aria-current", "aria-label", "class", "href", "lang"].includes(name)));
  const zeroResourceTags = all.filter((element) => APPLICATION_ZERO_RESOURCE_TAGS.has(element.name));
  const metaRefresh = all.some((element) => element.name === "meta"
    && /^refresh$/i.test(elementAttribute(element, "http-equiv") ?? ""));
  const valid = JSON.stringify(actualMain) === JSON.stringify(expectedMain)
    && JSON.stringify(knowledgeResourceSequence(parsedRoot)) === JSON.stringify(KNOWLEDGE_URL_SEQUENCE[lang])
    && anchorsHaveOwnedAttributes
    && zeroResourceTags.length === 0
    && !metaRefresh;
  if (!valid) {
    error(errors, "knowledge-document-contract", path, "requires the exact spec-backed Knowledge main topology, localized ledger, approved URL sequence and complete main control census");
  }
}

function verifyKnowledgeFullDocumentContract(path, parsedRoot, lang, errors) {
  const htmlRoots = directElementChildren(parsedRoot, "html");
  const actual = knowledgeNodeShape(htmlRoots[0]);
  const expected = knowledgeExpectedDocumentShape(KNOWLEDGE_CONTRACT[lang], lang);
  const all = elementDescendants(parsedRoot);
  const eventHandlers = all.flatMap((element) => [...element.attributes.keys()].filter((name) => /^on/i.test(name)));
  const valid = htmlRoots.length === 1
    && JSON.stringify(actual) === JSON.stringify(expected)
    && eventHandlers.length === 0;
  if (!valid) {
    error(errors, "knowledge-full-document-contract", path, "requires the immutable spec-backed full-document element, raw attribute, metadata, resource, script, image and actionable-control topology");
  }
}

function verifyKnowledgeBoundary(path, parsedRoot, errors) {
  const nodes = documentNodeDescendants(parsedRoot);
  const elements = nodes.filter((node) => node.type === "element");
  const canonicalCorpus = normalizeExactHtmlLiteral(nodes.map((node) => {
    if (node.type === "text" || node.type === "comment") return node.value;
    if (node.type !== "element") return node.source ?? "";
    return `${node.name} ${[...node.attributes.entries()].map(([name, value]) => `${name}=${value ?? ""}`).join(" ")}`;
  }).join(" "));
  const externalAnchors = elements.filter((element) => element.name === "a").filter((anchor) => {
    const href = browserNormalizedUrl(elementAttribute(anchor, "href"));
    return !nonEmptyString(href) || (!href.startsWith("/") && !href.startsWith("#"));
  });
  const forbiddenResources = elements.filter((element) => new Set([
    "audio", "base", "embed", "form", "iframe", "object", "picture", "source", "style", "video"
  ]).has(element.name));
  const inlineStyles = elements.filter((element) => element.attributes.has("style"));
  const dateElements = elements.filter((element) => element.name === "time"
    || [...element.attributes.keys()].some((name) => /^(?:datetime|datepublished|datemodified|data-date)$/i.test(name)));
  const extraScripts = elements.filter((element) => element.name === "script"
    && elementAttribute(element, "type") !== "application/ld+json"
    && elementAttribute(element, "src") !== "/assets/js/main.js?v=20260825-flightplan-2");
  const inactiveUrlViolation = knowledgeInactiveUrlViolation(parsedRoot);
  const bannedRoute = knowledgeUrlPropertyViolation(parsedRoot) || inactiveUrlViolation;
  if (bannedRoute) {
    error(errors, "knowledge-route-boundary", path, "forbids the canonical /en/procurement-2026/ path across encoded URL attributes and adjacent inactive source fragments");
    error(errors, "knowledge-url-property-boundary", path, "forbids canonical or malformed fake English Procurement routes across every URL-valued attribute, metadata property, schema property and inactive source fragment");
  }
  if (inactiveUrlViolation) {
    error(errors, "knowledge-inactive-url-boundary", path, "forbids embedded bare, quoted, JSON-like or attribute-style fake English Procurement URLs extracted from comments and statically inactive source");
  }
  if (knowledgeInactiveTemporalIdentifierViolation(parsedRoot)) {
    error(errors, "knowledge-temporal-identifier-boundary", path, "forbids semantic date and time identifier tokens in comments and statically inactive source");
  }
  const temporalViolation = knowledgeHasDateBoundaryViolation(parsedRoot);
  if (temporalViolation) {
    error(errors, "knowledge-date-boundary", path, "forbids publication metadata and date-like factual literals outside exact approved Procurement 2026 titles and URLs");
    error(errors, "knowledge-temporal-boundary", path, "forbids temporal metadata, claims, clocks and unowned four-digit years outside exact Procurement 2026 resource ownership");
  }
  if (/datepublished|datemodified/.test(canonicalCorpus)
    || externalAnchors.length > 0
    || forbiddenResources.length > 0
    || inlineStyles.length > 0
    || dateElements.length > 0
    || extraScripts.length > 0) {
    error(errors, "knowledge-boundary", path, "requires internal links only, no fake English Procurement route, dates, inline styles or unowned resources");
  }
}

function verifyKnowledgePage(path, parsedRoot, lang, errors) {
  const contract = KNOWLEDGE_CONTRACT[lang];
  const all = elementDescendants(parsedRoot);
  const body = htmlBodyRoot(parsedRoot);
  const main = all.find((element) => element.name === "main" && elementAttribute(element, "id") === "main");
  if (elementAttribute(body, "data-page") !== "knowledge") {
    error(errors, "knowledge-shell", path, 'body must use data-page="knowledge"');
  }

  const h1s = all.filter((element) => element.name === "h1" && pageElementIsActive(element));
  if (h1s.length !== 1 || publishedStaticText(h1s[0]) !== normalizeExactLiteral(contract.title)) {
    error(errors, "knowledge-h1", path, "requires the exact localized Knowledge h1");
  }
  const purposes = all.filter((element) => elementHasClass(element, "page-lead") && pageElementIsActive(element));
  if (purposes.length !== 1 || publishedStaticText(purposes[0]) !== normalizeExactLiteral(contract.purpose)) {
    error(errors, "knowledge-purpose", path, "requires the exact localized purpose statement");
  }

  const sectionMarkers = all.filter((element) => element.attributes.has("data-section"));
  const directSections = directElementChildren(main, "section");
  const resourcesSection = sectionMarkers.find((section) => elementAttribute(section, "data-section") === "resources");
  if (sectionMarkers.length !== 1
    || directSections.length !== 1
    || directSections[0] !== resourcesSection
    || !pageElementIsActive(resourcesSection)) {
    error(errors, "knowledge-sections", path, "requires one direct visible resources section and no other data-section marker");
  }

  const resources = all.filter((element) => element.attributes.has("data-resource"));
  let resourcesValid = resources.length === contract.resources.length
    && resources.every((resource) => resource.name === "article"
      && resource.parent === resourcesSection
      && pageElementIsActive(resource));
  for (const [index, expected] of contract.resources.entries()) {
    const resource = resources[index];
    if (!resource) {
      resourcesValid = false;
      continue;
    }
    const anchors = elementDescendants(resource, "a");
    const anchor = anchors[0];
    const metadata = elementDescendants(resource).filter((element) => element.attributes.has("data-meta"));
    const metaNames = metadata.map((element) => elementAttribute(element, "data-meta"));
    const metaValues = metadata.map((element) => publishedStaticText(element));
    resourcesValid = resourcesValid
      && anchors.length === 1
      && pageElementIsActive(anchor)
      && elementAttribute(anchor, "href") === expected.href
      && elementAttribute(anchor, "lang") === expected.lang
      && publishedStaticText(anchor) === normalizeExactLiteral(expected.title)
      && JSON.stringify(metaNames) === JSON.stringify(["type", "language", "status"])
      && JSON.stringify(metaValues) === JSON.stringify([expected.type, expected.language, expected.status].map(normalizeExactLiteral))
      && metadata.every(pageElementIsActive);
  }
  if (!resourcesValid) {
    error(errors, "knowledge-resources", path, "requires the exact immutable ordered visible resource manifest");
  }
  if (lang === "en") {
    const polish = resources[2];
    const anchor = polish ? elementDescendants(polish, "a")[0] : null;
    const status = polish ? elementDescendants(polish).find((element) => elementAttribute(element, "data-meta") === "status") : null;
    if (!anchor
      || elementAttribute(anchor, "href") !== "/procurement-2026/"
      || elementAttribute(anchor, "lang") !== "pl"
      || publishedStaticText(status) !== "Polish-language resource") {
      error(errors, "knowledge-polish-resource", path, "English hub must visibly disclose the Polish resource and use raw lang=pl");
    }
  }

  const schemaScripts = all.filter((element) => element.name === "script" && elementAttribute(element, "type") === "application/ld+json");
  let schema = null;
  try { schema = schemaScripts.length === 1 ? JSON.parse(rawElementText(schemaScripts[0])) : null; } catch { schema = null; }
  if (!sameJsonContract(schema, knowledgeSchema(contract, lang))) {
    error(errors, "knowledge-schema", path, "requires one bounded CollectionPage whose hasPart exactly mirrors the immutable visible inventory");
  }

  const conversionControls = all.filter((element) => (element.name === "a" || element.name === "button")
    && ["btn-primary", "btn-secondary", "btn-ghost", "cta-link"].some((className) => elementHasClass(element, className)));
  const mailtoAnchors = all.filter((element) => element.name === "a" && /^mailto:/i.test(browserNormalizedUrl(elementAttribute(element, "href")) ?? ""));
  const cta = conversionControls[0];
  const contact = directElementChildren(main, "aside").filter((element) => elementHasClass(element, "knowledge-contact"));
  const contactControls = contact.length === 1
    ? elementDescendants(contact[0]).filter((element) => element.name === "a" || element.name === "button")
    : [];
  if (conversionControls.length !== 1
    || mailtoAnchors.length !== 0
    || contact.length !== 1
    || contactControls.length !== 1
    || cta?.name !== "a"
    || !elementIsWithin(cta, contact[0])
    || elementAttribute(cta, "href") !== contract.ctaHref
    || publishedStaticText(cta) !== normalizeExactLiteral(contract.ctaLabel)) {
    error(errors, "knowledge-contact", path, "requires one exact localized internal contact CTA and no second conversion control");
  }

  const nav = all.find((element) => element.name === "nav" && elementHasClass(element, "site-nav") && pageElementIsActive(element));
  const current = nav ? elementDescendants(nav, "a").filter((anchor) => elementAttribute(anchor, "aria-current") === "page") : [];
  const expectedRoute = lang === "pl" ? "/wiedza/" : "/en/wiedza/";
  if (current.length !== 1 || elementAttribute(current[0], "href") !== expectedRoute) {
    error(errors, "knowledge-shell", path, "requires Knowledge as the single current route in the localized v2 navigation");
  }
  verifyKnowledgeDocumentContract(path, parsedRoot, lang, main, errors);
  verifyKnowledgeFullDocumentContract(path, parsedRoot, lang, errors);
  verifyKnowledgeBoundary(path, parsedRoot, errors);
}

const PROJECT_GROUP_ORDER = Object.freeze(["advisory", "applications", "aviation"]);
const PROJECT_STRUCTURE = Object.freeze([
  Object.freeze({ group: "advisory", projects: Object.freeze([
    Object.freeze({ id: "orlen", facts: Object.freeze(["client.orlen", "project.orlen.role", "project.orlen.platform_scope", "project.orlen.connect_scope"]) }),
    Object.freeze({ id: "zabka", facts: Object.freeze(["client.zabka_polska", "project.zabka.role", "project.zabka.implementation", "project.zabka.proof"]) }),
    Object.freeze({ id: "kghm", facts: Object.freeze(["client.kghm", "project.kghm.role", "project.kghm.scope", "project.kghm.integration"]) }),
    Object.freeze({ id: "pll-lot", facts: Object.freeze(["client.pll_lot", "project.lot.implementation"]) }),
    Object.freeze({ id: "motor-oil-hellas", facts: Object.freeze(["client.motor_oil_hellas", "project.motor_oil.implementation"]) })
  ]) }),
  Object.freeze({ group: "applications", projects: Object.freeze([
    Object.freeze({ id: "czympojade", facts: Object.freeze(["portfolio.czympojade_pl", "portfolio.czympojade_pl.type"]) }),
    Object.freeze({ id: "przypominamy", facts: Object.freeze(["portfolio.przypominamy_com", "portfolio.przypominamy_com.type"]) }),
    Object.freeze({ id: "procuracost", facts: Object.freeze(["portfolio.procuracost", "portfolio.procuracost.type"]) }),
    Object.freeze({ id: "procurement-process-2026", facts: Object.freeze(["portfolio.procurement_process_2026", "portfolio.procurement_process_2026.type"]) }),
    Object.freeze({ id: "silence-tax", facts: Object.freeze(["portfolio.silence_tax", "portfolio.silence_tax.type"]) })
  ]) }),
  Object.freeze({ group: "aviation", projects: Object.freeze([
    Object.freeze({ id: "akrobacja", facts: Object.freeze(["portfolio.akrobacja_com", "portfolio.akrobacja_com.current_status", "portfolio.akrobacja_com.type"]) }),
    Object.freeze({ id: "filmolot", facts: Object.freeze(["portfolio.filmolot_pl", "portfolio.filmolot_pl.type"]) })
  ]) })
]);
const PROJECT_IDS = Object.freeze(PROJECT_STRUCTURE.flatMap((entry) => entry.projects.map((project) => project.id)));
const PROJECT_FACT_ORDER = Object.freeze(PROJECT_STRUCTURE.flatMap((entry) => entry.projects.flatMap((project) => project.facts)));
const PROJECT_FACT_CONTRACT = Object.freeze([
  Object.freeze({"id":"client.orlen","value":"ORLEN","display_pl":"ORLEN","display_en":"ORLEN","kind":"constant","as_of":null,"source_type":"owner_verified","source_label":"Owner confirmed client relationship, 2026-08-25","source_url":null,"surfaces":["index.html","en/index.html","llms.txt","llms-full.txt","worker/index.js","case-studies/index.html","en/case-studies/index.html"],"status":"approved"}),
  Object.freeze({"id":"project.orlen.role","value":"CONNECT project manager","display_pl":"Kierownik projektu CONNECT","display_en":"CONNECT Project Manager","kind":"constant","as_of":null,"source_type":"owner_verified","source_label":"Owner-confirmed pre-Task-5 project role, 2026-08-26","source_url":null,"surfaces":["index.html","en/index.html","uslugi/transformacja-zakupow/index.html","en/uslugi/transformacja-zakupow/index.html","case-studies/index.html","en/case-studies/index.html"],"status":"approved"}),
  Object.freeze({"id":"project.orlen.platform_scope","value":"Central sourcing platform for the ORLEN Group","display_pl":"Centralna platforma sourcingowa dla Grupy ORLEN","display_en":"Central sourcing platform for the ORLEN Group","kind":"constant","as_of":null,"source_type":"owner_verified","source_label":"Owner-confirmed pre-Task-5 project scope, 2026-08-26","source_url":null,"surfaces":["index.html","en/index.html","uslugi/transformacja-zakupow/index.html","en/uslugi/transformacja-zakupow/index.html","case-studies/index.html","en/case-studies/index.html"],"status":"approved"}),
  Object.freeze({"id":"project.orlen.connect_scope","value":"CONNECT sourcing platform for 15 ORLEN Group entities in 4 countries with a 60-person delivery team","display_pl":"15 spółek Grupy ORLEN w 4 krajach, 60-osobowy zespół","display_en":"15 ORLEN Group entities across 4 countries, 60-person team","kind":"constant","as_of":null,"source_type":"owner_verified","source_label":"Owner confirmed project scope, 2026-08-25","source_url":null,"surfaces":["index.html","en/index.html","llms.txt","llms-full.txt","worker/index.js","uslugi/transformacja-zakupow/index.html","en/uslugi/transformacja-zakupow/index.html","case-studies/index.html","en/case-studies/index.html"],"status":"approved"}),
  Object.freeze({"id":"client.zabka_polska","value":"Żabka Polska","display_pl":"Żabka Polska","display_en":"Żabka Polska","kind":"constant","as_of":null,"source_type":"owner_verified","source_label":"Owner confirmed client relationship, 2026-08-25","source_url":null,"surfaces":["index.html","en/index.html","llms.txt","llms-full.txt","worker/index.js","case-studies/index.html","en/case-studies/index.html"],"status":"approved"}),
  Object.freeze({"id":"project.zabka.role","value":"SAP Ariba implementation-delivery responsibility","display_pl":"Realizacja wdrożenia SAP Ariba","display_en":"Delivery of the SAP Ariba implementation","kind":"constant","as_of":null,"source_type":"owner_verified","source_label":"Owner-confirmed pre-Task-5 implementation-delivery responsibility, 2026-08-26","source_url":null,"surfaces":["index.html","en/index.html","uslugi/wdrozenie-sap-ariba/index.html","en/uslugi/wdrozenie-sap-ariba/index.html","case-studies/index.html","en/case-studies/index.html"],"status":"approved"}),
  Object.freeze({"id":"project.zabka.implementation","value":"Procurement, supplier risk and sourcing functional scope","display_pl":"Zakupy, ryzyko dostawców i sourcing","display_en":"Procurement, supplier risk and sourcing","kind":"constant","as_of":null,"source_type":"owner_verified","source_label":"Owner-confirmed pre-Task-5 functional scope, 2026-08-26","source_url":null,"surfaces":["index.html","en/index.html","llms.txt","llms-full.txt","uslugi/wdrozenie-sap-ariba/index.html","en/uslugi/wdrozenie-sap-ariba/index.html","case-studies/index.html","en/case-studies/index.html"],"status":"approved"}),
  Object.freeze({"id":"project.zabka.proof","value":"SAP Ariba Buying, Supplier Risk and sourcing","display_pl":"SAP Ariba Buying, Supplier Risk i sourcing","display_en":"SAP Ariba Buying, Supplier Risk and sourcing","kind":"constant","as_of":null,"source_type":"owner_verified","source_label":"Owner-confirmed pre-Task-5 implementation proof, 2026-08-26","source_url":null,"surfaces":["index.html","en/index.html","uslugi/wdrozenie-sap-ariba/index.html","en/uslugi/wdrozenie-sap-ariba/index.html","case-studies/index.html","en/case-studies/index.html"],"status":"approved"}),
  Object.freeze({"id":"client.kghm","value":"KGHM","display_pl":"KGHM","display_en":"KGHM","kind":"constant","as_of":null,"source_type":"owner_verified","source_label":"Owner confirmed client relationship, 2026-08-25","source_url":null,"surfaces":["index.html","en/index.html","llms.txt","llms-full.txt","worker/index.js","case-studies/index.html","en/case-studies/index.html"],"status":"approved"}),
  Object.freeze({"id":"project.kghm.role","value":"Implementation and integration delivery","display_pl":"Realizacja wdrożenia i integracji","display_en":"Implementation and integration delivery","kind":"constant","as_of":null,"source_type":"owner_verified","source_label":"Owner-confirmed pre-Task-5 project role, 2026-08-26","source_url":null,"surfaces":["index.html","en/index.html","uslugi/wdrozenie-sap-ariba/index.html","en/uslugi/wdrozenie-sap-ariba/index.html","case-studies/index.html","en/case-studies/index.html"],"status":"approved"}),
  Object.freeze({"id":"project.kghm.scope","value":"Sourcing and external workforce management","display_pl":"Sourcing i obsługa pracowników zewnętrznych","display_en":"Sourcing and external workforce management","kind":"constant","as_of":null,"source_type":"owner_verified","source_label":"Owner-confirmed pre-Task-5 project scope, 2026-08-26","source_url":null,"surfaces":["index.html","en/index.html","uslugi/wdrozenie-sap-ariba/index.html","en/uslugi/wdrozenie-sap-ariba/index.html","case-studies/index.html","en/case-studies/index.html"],"status":"approved"}),
  Object.freeze({"id":"project.kghm.integration","value":"SAP Ariba Sourcing and Fieldglass integrated with SAP S/4HANA","display_pl":"SAP Ariba Sourcing i Fieldglass zintegrowane z SAP S/4HANA","display_en":"SAP Ariba Sourcing and Fieldglass integrated with SAP S/4HANA","kind":"constant","as_of":null,"source_type":"owner_verified","source_label":"Owner confirmed project scope, 2026-08-25","source_url":null,"surfaces":["index.html","en/index.html","llms.txt","llms-full.txt","uslugi/wdrozenie-sap-ariba/index.html","en/uslugi/wdrozenie-sap-ariba/index.html","case-studies/index.html","en/case-studies/index.html"],"status":"approved"}),
  Object.freeze({"id":"client.pll_lot","value":"PLL LOT","display_pl":"PLL LOT","display_en":"PLL LOT","kind":"constant","as_of":null,"source_type":"owner_verified","source_label":"Owner confirmed client relationship, 2026-08-25","source_url":null,"surfaces":["index.html","en/index.html","llms.txt","llms-full.txt","worker/index.js","case-studies/index.html","en/case-studies/index.html"],"status":"approved"}),
  Object.freeze({"id":"project.lot.implementation","value":"SAP Ariba implementation for PLL LOT","display_pl":"Wdrożenie SAP Ariba dla PLL LOT","display_en":"SAP Ariba implementation for PLL LOT","kind":"constant","as_of":null,"source_type":"owner_verified","source_label":"Owner confirmed project scope, 2026-08-25","source_url":null,"surfaces":["llms.txt","llms-full.txt","worker/index.js","uslugi/wdrozenie-sap-ariba/index.html","en/uslugi/wdrozenie-sap-ariba/index.html","case-studies/index.html","en/case-studies/index.html"],"status":"approved"}),
  Object.freeze({"id":"client.motor_oil_hellas","value":"Motor Oil Hellas","display_pl":"Motor Oil Hellas","display_en":"Motor Oil Hellas","kind":"constant","as_of":null,"source_type":"owner_verified","source_label":"Owner confirmed client relationship, 2026-08-25","source_url":null,"surfaces":["index.html","en/index.html","llms.txt","llms-full.txt","worker/index.js","case-studies/index.html","en/case-studies/index.html"],"status":"approved"}),
  Object.freeze({"id":"project.motor_oil.implementation","value":"SAP procurement implementation for Motor Oil Hellas","display_pl":"Wdrożenie SAP w obszarze zakupów dla Motor Oil Hellas","display_en":"SAP procurement implementation for Motor Oil Hellas","kind":"constant","as_of":null,"source_type":"owner_verified","source_label":"Owner confirmed project scope, 2026-08-25","source_url":null,"surfaces":["llms.txt","llms-full.txt","worker/index.js","uslugi/wdrozenie-sap-ariba/index.html","en/uslugi/wdrozenie-sap-ariba/index.html","case-studies/index.html","en/case-studies/index.html"],"status":"approved"}),
  Object.freeze({"id":"portfolio.czympojade_pl","value":"czympojade.pl transport application","display_pl":"czympojade.pl","display_en":"czympojade.pl","kind":"constant","as_of":null,"source_type":"owner_verified","source_label":"Owner confirmed portfolio project, 2026-08-25","source_url":null,"surfaces":["index.html","en/index.html","aplikacje-operacyjne/index.html","en/aplikacje-operacyjne/index.html","case-studies/index.html","en/case-studies/index.html"],"status":"approved"}),
  Object.freeze({"id":"portfolio.czympojade_pl.type","value":"transport connection and timetable application","display_pl":"Aplikacja transportowa do pracy z połączeniami i rozkładami.","display_en":"Transport application for working with connections and timetables.","kind":"constant","as_of":null,"source_type":"owner_verified","source_label":"Owner-confirmed pre-Task-5 portfolio description, 2026-08-26","source_url":null,"surfaces":["index.html","en/index.html","aplikacje-operacyjne/index.html","en/aplikacje-operacyjne/index.html","case-studies/index.html","en/case-studies/index.html"],"status":"approved"}),
  Object.freeze({"id":"portfolio.przypominamy_com","value":"Przypominamy.com notification platform","display_pl":"Przypominamy.com","display_en":"Przypominamy.com","kind":"constant","as_of":null,"source_type":"owner_verified","source_label":"Owner confirmed portfolio project, 2026-08-25","source_url":null,"surfaces":["index.html","en/index.html","aplikacje-operacyjne/index.html","en/aplikacje-operacyjne/index.html","case-studies/index.html","en/case-studies/index.html"],"status":"approved"}),
  Object.freeze({"id":"portfolio.przypominamy_com.type","value":"notification platform for organisations","display_pl":"Platforma powiadomień dla organizacji.","display_en":"Notification platform for organisations.","kind":"constant","as_of":null,"source_type":"owner_verified","source_label":"Owner-confirmed pre-Task-5 portfolio description, 2026-08-26","source_url":null,"surfaces":["index.html","en/index.html","aplikacje-operacyjne/index.html","en/aplikacje-operacyjne/index.html","case-studies/index.html","en/case-studies/index.html"],"status":"approved"}),
  Object.freeze({"id":"portfolio.procuracost","value":"ProcuraCost calculator","display_pl":"ProcuraCost","display_en":"ProcuraCost","kind":"constant","as_of":null,"source_type":"owner_verified","source_label":"Owner confirmed portfolio project, 2026-08-25","source_url":null,"surfaces":["index.html","en/index.html","aplikacje-operacyjne/index.html","en/aplikacje-operacyjne/index.html","case-studies/index.html","en/case-studies/index.html"],"status":"approved"}),
  Object.freeze({"id":"portfolio.procuracost.type","value":"procurement procedure cost calculator","display_pl":"Kalkulator kosztów procedur zakupowych.","display_en":"Procurement procedure cost calculator.","kind":"constant","as_of":null,"source_type":"owner_verified","source_label":"Owner-confirmed pre-Task-5 portfolio description, 2026-08-26","source_url":null,"surfaces":["index.html","en/index.html","aplikacje-operacyjne/index.html","en/aplikacje-operacyjne/index.html","case-studies/index.html","en/case-studies/index.html"],"status":"approved"}),
  Object.freeze({"id":"portfolio.procurement_process_2026","value":"Procurement Process 2026 interactive model","display_pl":"Procurement Process 2026","display_en":"Procurement Process 2026","kind":"constant","as_of":null,"source_type":"owner_verified","source_label":"Owner confirmed portfolio project, 2026-08-25","source_url":null,"surfaces":["index.html","en/index.html","case-studies/index.html","en/case-studies/index.html"],"status":"approved"}),
  Object.freeze({"id":"portfolio.procurement_process_2026.type","value":"interactive procurement process model","display_pl":"Interaktywny model procesu zakupowego.","display_en":"Interactive procurement process model.","kind":"constant","as_of":null,"source_type":"owner_verified","source_label":"Owner-confirmed pre-Task-5 portfolio description, 2026-08-26","source_url":null,"surfaces":["index.html","en/index.html","case-studies/index.html","en/case-studies/index.html"],"status":"approved"}),
  Object.freeze({"id":"portfolio.silence_tax","value":"silence-tax.com calculator","display_pl":"silence-tax.com","display_en":"silence-tax.com","kind":"constant","as_of":null,"source_type":"owner_verified","source_label":"Owner confirmed portfolio project, 2026-08-25","source_url":null,"surfaces":["index.html","en/index.html","case-studies/index.html","en/case-studies/index.html"],"status":"approved"}),
  Object.freeze({"id":"portfolio.silence_tax.type","value":"organisational silence cost calculator","display_pl":"Kalkulator kosztów milczenia w organizacji.","display_en":"Calculator for the cost of silence in an organisation.","kind":"constant","as_of":null,"source_type":"owner_verified","source_label":"Owner-confirmed pre-Task-5 portfolio description, 2026-08-26","source_url":null,"surfaces":["index.html","en/index.html","case-studies/index.html","en/case-studies/index.html"],"status":"approved"}),
  Object.freeze({"id":"portfolio.akrobacja_com","value":"akrobacja.com","display_pl":"akrobacja.com","display_en":"akrobacja.com","kind":"constant","as_of":null,"source_type":"owner_verified","source_label":"Owner correction, 2026-08-26: akrobacja.com is the active aviation venture and succeeds the former WarsawFlightSafety name","source_url":null,"surfaces":["index.html","en/index.html","lotnictwo/index.html","en/lotnictwo/index.html","llms-full.txt","worker/index.js","case-studies/index.html","en/case-studies/index.html"],"status":"approved"}),
  Object.freeze({"id":"portfolio.akrobacja_com.current_status","value":"active aviation venture as of 2026-08-26","display_pl":"Aktualna marka działalności lotniczej","display_en":"Current aviation venture","kind":"dated","as_of":"2026-08-26","source_type":"owner_verified","source_label":"Owner correction, 2026-08-26: akrobacja.com is the active aviation venture","source_url":null,"surfaces":["index.html","en/index.html","lotnictwo/index.html","en/lotnictwo/index.html","llms-full.txt","worker/index.js","case-studies/index.html","en/case-studies/index.html"],"status":"approved"}),
  Object.freeze({"id":"portfolio.akrobacja_com.type","value":"aerobatic-flight voucher sales platform","display_pl":"Platforma sprzedaży voucherów na loty akrobacyjne.","display_en":"Voucher sales platform for aerobatic flights.","kind":"constant","as_of":null,"source_type":"owner_verified","source_label":"Owner-confirmed pre-Task-5 portfolio description, 2026-08-26","source_url":null,"surfaces":["index.html","en/index.html","lotnictwo/index.html","en/lotnictwo/index.html","llms-full.txt","worker/index.js","case-studies/index.html","en/case-studies/index.html"],"status":"approved"}),
  Object.freeze({"id":"portfolio.filmolot_pl","value":"FilmoLot.pl aviation photography and video project","display_pl":"FilmoLot.pl","display_en":"FilmoLot.pl","kind":"constant","as_of":null,"source_type":"owner_verified","source_label":"Owner confirmed portfolio project, 2026-08-25","source_url":null,"surfaces":["index.html","en/index.html","lotnictwo/index.html","en/lotnictwo/index.html","case-studies/index.html","en/case-studies/index.html"],"status":"approved"}),
  Object.freeze({"id":"portfolio.filmolot_pl.type","value":"aviation photography and video","display_pl":"Lotnictwo · fotografia i wideo","display_en":"Aviation · photography and video","kind":"constant","as_of":null,"source_type":"owner_verified","source_label":"Owner-confirmed pre-Task-5 portfolio description, 2026-08-26","source_url":null,"surfaces":["index.html","en/index.html","lotnictwo/index.html","en/lotnictwo/index.html","case-studies/index.html","en/case-studies/index.html"],"status":"approved"})
]);
const PROJECT_PAGE_CONTRACT = Object.freeze({
  pl: Object.freeze({ title: "Projekty", lead: "Rejestr projektów i produktów oparty na zatwierdzonych rolach, zakresach i faktach. Jeśli wynik lub status nie ma potwierdzenia, nie pojawia się na tej stronie.", url: "https://mamcarz.com/case-studies/", ctaHref: "mailto:pawel@mamcarz.com?subject=Projekt", ctaLabel: "Napisz o projekcie" }),
  en: Object.freeze({ title: "Projects", lead: "A register of projects and products built from approved roles, scopes and facts. If an outcome or status is not verified, it does not appear here.", url: "https://mamcarz.com/en/case-studies/", ctaHref: "mailto:pawel@mamcarz.com?subject=Project%20enquiry", ctaLabel: "Write about the project" })
});
const PROJECT_DOCUMENT_MANIFEST = Object.freeze({ pl: "cbc4b44e16583076a70e6abd07a7a61b750ee1ae9584c1935527583d54c9442d", en: "c4625b32670ca06c9c3bb7f9db2c831acadb9951dc9d1a088f028e79037d9754" });

function projectExpectedPublicSurfaces() {
  return SERVICE_PUBLIC_SURFACE_CONTRACT;
}

function verifyProjectRegistryInventory(factData, errors, { required = false } = {}) {
  const records = Array.isArray(factData.facts) ? factData.facts : [];
  const publicSurfaces = Array.isArray(factData.public_claim_surfaces) ? factData.public_claim_surfaces : [];
  const contractIds = new Set(PROJECT_FACT_ORDER);
  const ownsProjectState = records.some((record) => contractIds.has(record?.id)
      || (Array.isArray(record?.surfaces) && record.surfaces.some((surface) => PROJECT_SURFACES.includes(surface))))
    || publicSurfaces.some((surface) => PROJECT_SURFACES.includes(surface));
  if (!required && !ownsProjectState) return;

  const failures = [];
  if (JSON.stringify(publicSurfaces) !== JSON.stringify(projectExpectedPublicSurfaces())) {
    failures.push("public_claim_surfaces must equal the exact ordered Projects-aware public surface contract");
  }
  for (const surface of PROJECT_SURFACES) {
    const actual = records.filter((record) => Array.isArray(record?.surfaces) && record.surfaces.includes(surface)).map((record) => record.id).sort();
    const expected = [...PROJECT_FACT_ORDER].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) failures.push(`${surface} must authorize exactly the 31 immutable Projects facts`);
  }
  for (const expected of PROJECT_FACT_CONTRACT) {
    const matches = records.filter((record) => record?.id === expected.id);
    if (matches.length !== 1
      || !["id", "value", "display_pl", "display_en", "kind", "as_of", "source_type", "source_label", "source_url", "status"].every((key) => matches[0][key] === expected[key])
      || JSON.stringify(matches[0].surfaces) !== JSON.stringify(expected.surfaces)) {
      failures.push(`${expected.id} must retain its immutable value, localized displays, provenance, approval and exact complete surface inventory`);
    }
  }
  if (failures.length > 0) error(errors, "project-registry-inventory", "content/site-facts.json", failures.join("; "));
}

async function hasCompleteProjectDocumentContext(root) {
  const documents = await Promise.all(PROJECT_SURFACES.map(async (path) => {
    try { return (await stat(resolve(root, path))).isFile(); } catch { return false; }
  }));
  return documents.every(Boolean);
}

function verifyProjectSchema(path, parsedRoot, lang, errors) {
  const contract = PROJECT_PAGE_CONTRACT[lang];
  const scripts = elementDescendants(parsedRoot).filter((element) => element.name === "script" && elementAttribute(element, "type") === "application/ld+json");
  let actual = null;
  try { actual = scripts.length === 1 ? JSON.parse(rawElementText(scripts[0])) : null; } catch { actual = null; }
  const names = PROJECT_STRUCTURE.flatMap((group) => group.projects.map((project) => {
    const fact = PROJECT_FACT_CONTRACT.find((record) => record.id === project.facts[0]);
    return fact[lang === "pl" ? "display_pl" : "display_en"];
  }));
  const expected = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: contract.title,
    url: contract.url,
    description: contract.lead,
    mainEntity: {
      "@type": "ItemList",
      itemListElement: PROJECT_IDS.map((id, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: names[index],
        url: `${contract.url}#${id}`
      }))
    }
  };
  if (!sameJsonContract(actual, expected)) error(errors, "project-schema", path, "requires one exact bounded CollectionPage with a 12-item name, position and local-fragment ItemList only");
}

function verifyProjectResourceCensus(path, parsedRoot, contract, errors) {
  const elements = elementDescendants(parsedRoot);
  const forbidden = new Set(["audio", "base", "embed", "form", "iframe", "object", "picture", "source", "style", "video"]);
  const eventOrStyle = elements.some((element) => element.attributes.has("style") || [...element.attributes.keys()].some((name) => /^on/i.test(name)));
  const scripts = elements.filter((element) => element.name === "script");
  const validScripts = scripts.length === 2
    && scripts.filter((script) => elementAttribute(script, "type") === "application/ld+json" && !elementAttribute(script, "src")).length === 1
    && scripts.filter((script) => elementAttribute(script, "src") === "/assets/js/main.js?v=20260825-flightplan-2" && script.attributes.has("defer") && !rawElementText(script)).length === 1;
  const invalidAnchors = elements.filter((element) => element.name === "a").filter((anchor) => {
    const href = browserNormalizedUrl(elementAttribute(anchor, "href"));
    return !nonEmptyString(href) || (!href.startsWith("/") && !href.startsWith("#") && href !== contract.ctaHref);
  });
  const images = elements.filter((element) => element.name === "img");
  const signatureValid = images.length === 1
    && elementHasClass(images[0].parent, "footer-sign")
    && exactApplicationResourceAttributes(images[0], { src: "/assets/img/signature.png", alt: "", width: "160", height: "50", loading: "lazy", decoding: "async" });
  if (elements.some((element) => forbidden.has(element.name)) || !signatureValid || eventOrStyle || !validScripts || invalidAnchors.length > 0) {
    error(errors, "project-resource-census", path, "forbids images, external project links, embeds, inline styles or executable drift and allows only the exact schema, shell resources and contextual mail CTA");
  }
}

function verifyProjectClaimBoundary(path, parsedRoot, errors) {
  const corpus = normalizeExactHtmlLiteral(documentNodeDescendants(parsedRoot).map((node) => {
    if (node.type === "text" || node.type === "comment") return node.value;
    if (node.type !== "element") return "";
    return `${node.name} ${[...node.attributes].map(([name, value]) => `${name} ${value ?? ""}`).join(" ")}`;
  }).join(" ")).replace(/[^\p{L}\p{N}+#]+/gu, " ").trim();
  const compact = normalizeExactHtmlLiteral(documentNodeDescendants(parsedRoot)
    .filter((node) => node.type === "text" || node.type === "comment")
    .map((node) => node.value)
    .join(""))
    .replace(/[^\p{L}\p{N}+#]+/gu, "");
  const forbidden = [
    /warsaw\s*flight\s*safety/i, /polpharma/i, /\bmol\b/i,
    /12\s*(?:823|800)\+?/, /220\s*000/, /\b90\+/, /#1/,
    /largest|leading|największ|wiodąc|flag\s+carrier|narodow\w*\s+przewoźnik/i,
    /barrels?\s*(?:per|\/)\s*day|barył\w*\s*(?:dziennie|\/)/i,
    /market\s*leader|lider\w*\s+rynku/i,
    /guaranteed|gwarantowan|comprehensive|kompleksow|not\s+just|nie\s+tylko/i
  ];
  if (forbidden.some((pattern) => pattern.test(corpus)) || /warsawflightsafety|polpharma/i.test(compact)) {
    error(errors, "project-claim-boundary", path, "forbids retired brands, blocked clients, review-only numbers, rankings, organization facts, inferred outcomes/status and AI-tell sales copy across active and inactive source");
  }
}

function verifyProjectPage(path, parsedRoot, lang, factData, errors) {
  const contract = PROJECT_PAGE_CONTRACT[lang];
  const all = elementDescendants(parsedRoot);
  const body = htmlBodyRoot(parsedRoot);
  const main = all.find((element) => element.name === "main" && elementAttribute(element, "id") === "main");
  if (elementAttribute(body, "data-page") !== "projects") error(errors, "project-shell", path, 'body must use data-page="projects"');
  const h1s = all.filter((element) => element.name === "h1" && pageElementIsActive(element));
  if (h1s.length !== 1 || publishedStaticText(h1s[0]) !== normalizeExactLiteral(contract.title)) error(errors, "project-h1", path, "requires the exact localized Projects H1");
  const leads = all.filter((element) => elementHasClass(element, "page-lead") && pageElementIsActive(element));
  if (leads.length !== 1 || publishedStaticText(leads[0]) !== normalizeExactLiteral(contract.lead)) error(errors, "project-lead", path, "requires the exact evidence-policy lead");

  const sections = all.filter((element) => element.attributes.has("data-section"));
  const directGroups = directElementChildren(main, "section");
  const groupIds = sections.map((section) => elementAttribute(section, "data-section"));
  if (JSON.stringify(groupIds) !== JSON.stringify(PROJECT_GROUP_ORDER)
    || directGroups.length !== 3
    || !directGroups.every((section, index) => section === sections[index] && elementAttribute(section, "id") === PROJECT_GROUP_ORDER[index] && pageElementIsActive(section))) {
    error(errors, "project-groups", path, "requires exactly three direct visible advisory, applications and aviation groups in order");
  }

  const projectNodes = all.filter((element) => element.attributes.has("data-project-id"));
  const projectIds = projectNodes.map((element) => elementAttribute(element, "data-project-id"));
  let evidenceValid = JSON.stringify(projectIds) === JSON.stringify(PROJECT_IDS);
  const byFact = new Map(PROJECT_FACT_CONTRACT.map((record) => [record.id, record]));
  for (const group of PROJECT_STRUCTURE) {
    const section = sections.find((element) => elementAttribute(element, "data-section") === group.group);
    const groupProjects = section ? elementDescendants(section).filter((element) => element.attributes.has("data-project-id")) : [];
    if (JSON.stringify(groupProjects.map((element) => elementAttribute(element, "data-project-id"))) !== JSON.stringify(group.projects.map((project) => project.id))) evidenceValid = false;
    group.projects.forEach((expectedProject, index) => {
      const project = groupProjects[index];
      const facts = project ? elementDescendants(project).filter((element) => element.attributes.has("data-fact-id")) : [];
      if (JSON.stringify(facts.map((element) => elementAttribute(element, "data-fact-id"))) !== JSON.stringify(expectedProject.facts)) evidenceValid = false;
      facts.forEach((node, factIndex) => {
        const expected = byFact.get(expectedProject.facts[factIndex]);
        if (!expected || !pageElementIsActive(node) || publishedStaticText(node) !== normalizeExactLiteral(expected[lang === "pl" ? "display_pl" : "display_en"])) evidenceValid = false;
      });
    });
  }
  const factIds = projectNodes.flatMap((project) => elementDescendants(project).filter((element) => element.attributes.has("data-fact-id")).map((element) => elementAttribute(element, "data-fact-id")));
  if (!evidenceValid || JSON.stringify(factIds) !== JSON.stringify(PROJECT_FACT_ORDER)) error(errors, "project-evidence", path, "requires the exact 12-project and 31-fact immutable bilingual evidence order");

  const times = all.filter((element) => element.name === "time");
  const statusNodes = all.filter((element) => elementAttribute(element, "data-fact-id") === "portfolio.akrobacja_com.current_status");
  const akrobacja = projectNodes.find((element) => elementAttribute(element, "data-project-id") === "akrobacja");
  if (times.length !== 1 || statusNodes.length !== 1 || !elementIsWithin(times[0], akrobacja) || !elementIsWithin(statusNodes[0], akrobacja)
    || elementAttribute(times[0], "datetime") !== "2026-08-26" || publishedStaticText(times[0]) !== "2026-08-26") {
    error(errors, "project-status", path, "allows only the exact dated Akrobacja current-status line as of 2026-08-26");
  }

  const index = all.find((element) => element.name === "nav" && elementHasClass(element, "projects-index"));
  const indexHrefs = index ? directElementChildren(index, "a").map((anchor) => elementAttribute(anchor, "href")) : [];
  if (JSON.stringify(indexHrefs) !== JSON.stringify(PROJECT_GROUP_ORDER.map((id) => `#${id}`))) error(errors, "project-index", path, "requires one no-JS three-anchor group index");

  const controls = all.filter((element) => (element.name === "a" || element.name === "button")
    && (elementHasClass(element, "btn-primary") || /^mailto:/i.test(browserNormalizedUrl(elementAttribute(element, "href")) ?? "")));
  if (controls.length !== 1 || controls[0].name !== "a" || elementAttribute(controls[0], "href") !== contract.ctaHref || publishedStaticText(controls[0]) !== normalizeExactLiteral(contract.ctaLabel)) {
    error(errors, "project-controls", path, "requires one exact contextual mail CTA and no extra conversion control");
  }

  const current = all.filter((element) => element.name === "a" && elementAttribute(element, "aria-current") === "page");
  const expectedCurrent = lang === "pl" ? "/case-studies/" : "/en/case-studies/";
  if (current.length !== 1 || elementAttribute(current[0], "href") !== expectedCurrent) error(errors, "project-shell", path, "requires Projects as the single current localized navigation route");
  verifyProjectSchema(path, parsedRoot, lang, errors);
  verifyProjectResourceCensus(path, parsedRoot, contract, errors);
  verifyProjectClaimBoundary(path, parsedRoot, errors);
  const digest = serviceDocumentDigest(parsedRoot);
  if (digest !== PROJECT_DOCUMENT_MANIFEST[lang]) error(errors, "project-document-manifest", path, `requires the exact full Projects document manifest; actual ${digest}`);
  return { projectIds, factIds };
}

function verifyProjectParity(pl, en, errors) {
  if (JSON.stringify(pl) !== JSON.stringify(en)) error(errors, "project-parity", "projects", "PL and EN must expose identical ordered project and fact IDs");
}

const SERVICE_SECTION_ORDER = Object.freeze(["problem", "fit", "scope", "method", "evidence", "contact"]);
const SERVICE_SURFACES = Object.freeze({
  transformation: Object.freeze(["uslugi/transformacja-zakupow/index.html", "en/uslugi/transformacja-zakupow/index.html"]),
  ariba: Object.freeze(["uslugi/wdrozenie-sap-ariba/index.html", "en/uslugi/wdrozenie-sap-ariba/index.html"]),
  publicProcurement: Object.freeze(["uslugi/doradztwo-zamowienia-publiczne/index.html", "en/uslugi/doradztwo-zamowienia-publiczne/index.html"])
});
const SERVICE_SURFACE_LIST = Object.freeze(Object.values(SERVICE_SURFACES).flat());
const SERVICE_PUBLIC_SURFACE_CONTRACT = Object.freeze([
  "index.html",
  "en/index.html",
  "aplikacje-operacyjne/index.html",
  "en/aplikacje-operacyjne/index.html",
  "lotnictwo/index.html",
  "en/lotnictwo/index.html",
  "case-studies/index.html",
  "en/case-studies/index.html",
  ...SPEAKING_SURFACES,
  ...SERVICE_SURFACE_LIST,
  "llms.txt",
  "llms-full.txt",
  "worker/index.js",
  "assets/js/main.js"
]);

const SERVICE_CONTRACTS = Object.freeze({
  transformation: Object.freeze({
    files: SERVICE_SURFACES.transformation,
    facts: Object.freeze([
      "career.pzu.organization", "career.pzu.title", "career.pzu.responsibility",
      "career.pwc.organization", "career.pwc.title", "career.pwc.responsibility",
      "project.orlen.role", "project.orlen.platform_scope", "project.orlen.connect_scope"
    ]),
    pl: Object.freeze({
      title: "Transformacja zakupów",
      lead: "Porządkuję model operacyjny zakupów: decyzje, role, procesy, dane i technologię. Efektem pracy jest uzgodniony projekt zmiany, który można wdrożyć i rozliczać.",
      description: "Projekt modelu operacyjnego zakupów obejmujący decyzje, role, procesy, dane i technologię.",
      url: "https://mamcarz.com/uslugi/transformacja-zakupow/",
      sectionTitles: Object.freeze(["Model operacyjny przed narzędziem.", "Jasna decyzja po obu stronach.", "Rejestr projektowanej zmiany.", "Cztery zamknięcia decyzyjne.", "Doświadczenie zapisane faktami.", "Ustalmy projekt zmiany."]),
      method: Object.freeze(["Diagnoza", "Projekt", "Sekwencja", "Governance"]),
      ctaHref: "mailto:pawel@mamcarz.com?subject=Transformacja%20zakup%C3%B3w",
      ctaLabel: "Porozmawiaj o transformacji zakupów"
    }),
    en: Object.freeze({
      title: "Procurement transformation",
      lead: "I structure the procurement operating model across decisions, roles, processes, data and technology. The deliverable is an agreed change design that can be implemented and governed.",
      description: "Procurement operating-model design across decisions, roles, processes, data and technology.",
      url: "https://mamcarz.com/en/uslugi/transformacja-zakupow/",
      sectionTitles: Object.freeze(["Operating model before tooling.", "A clear decision on both sides.", "Change-design register.", "Four decision closures.", "Experience recorded as facts.", "Define the change project."]),
      method: Object.freeze(["Diagnosis", "Design", "Sequence", "Governance"]),
      ctaHref: "mailto:pawel@mamcarz.com?subject=Procurement%20transformation",
      ctaLabel: "Discuss procurement transformation"
    })
  }),
  ariba: Object.freeze({
    files: SERVICE_SURFACES.ariba,
    facts: Object.freeze([
      "hero.implementations", "project.kghm.role", "project.kghm.scope", "project.kghm.integration",
      "project.zabka.role", "project.zabka.implementation", "project.zabka.proof",
      "project.lot.implementation", "project.motor_oil.implementation"
    ]),
    pl: Object.freeze({
      title: "Wdrożenie SAP Ariba",
      lead: "Prowadzę wdrożenia SAP Ariba od decyzji procesowych i danych po konfigurację, integrację, testy i uruchomienie. Zakres wynika z realnego modelu zakupowego, a nie z listy funkcji systemu.",
      description: "Prowadzenie wdrożenia SAP Ariba od decyzji procesowych i danych po integrację, testy i uruchomienie.",
      url: "https://mamcarz.com/uslugi/wdrozenie-sap-ariba/",
      sectionTitles: Object.freeze(["Proces wyznacza konfigurację.", "Wdrożenie potrzebuje właścicieli decyzji.", "Rejestr zakresu rozwiązania.", "Od decyzji do uruchomienia.", "Zakresy potwierdzone faktami.", "Ustalmy zakres wdrożenia."]),
      method: Object.freeze(["Decyzje procesowe", "Dane i integracja", "Testy", "Uruchomienie"]),
      ctaHref: "mailto:pawel@mamcarz.com?subject=Wdro%C5%BCenie%20SAP%20Ariba",
      ctaLabel: "Porozmawiaj o wdrożeniu SAP Ariba"
    }),
    en: Object.freeze({
      title: "SAP Ariba implementation",
      lead: "I lead SAP Ariba implementations from process and data decisions through configuration, integration, testing and launch. The scope follows the real procurement operating model, not a feature checklist.",
      description: "SAP Ariba implementation leadership from process and data decisions through integration, testing and launch.",
      url: "https://mamcarz.com/en/uslugi/wdrozenie-sap-ariba/",
      sectionTitles: Object.freeze(["Process determines configuration.", "Implementation needs decision owners.", "Solution scope register.", "From decisions to launch.", "Scopes confirmed by facts.", "Define the implementation scope."]),
      method: Object.freeze(["Process decisions", "Data and integration", "Testing", "Launch"]),
      ctaHref: "mailto:pawel@mamcarz.com?subject=SAP%20Ariba%20implementation",
      ctaLabel: "Discuss an SAP Ariba implementation"
    })
  }),
  publicProcurement: Object.freeze({
    files: SERVICE_SURFACES.publicProcurement,
    facts: Object.freeze(["career.pkp_plk.organization", "career.pkp_plk.dates", "career.pkp_plk.title", "career.pkp_plk.responsibility"]),
    pl: Object.freeze({
      title: "Doradztwo w zamówieniach publicznych",
      lead: "Pomagam uporządkować strategię postępowania, odpowiedzialności, dokumenty i decyzje w projektach objętych zamówieniami publicznymi. Pracuję na styku zakupów, technologii i zarządzania projektem, z wyraźną granicą odpowiedzialności prawnej.",
      description: "Porządkowanie strategii postępowania, odpowiedzialności, dokumentów i decyzji w projektach zamówień publicznych.",
      url: "https://mamcarz.com/uslugi/doradztwo-zamowienia-publiczne/",
      sectionTitles: Object.freeze(["Decyzje przed dokumentami.", "Granica odpowiedzialności jest częścią zakresu.", "Rejestr pracy doradczej.", "Porządek postępowania.", "Doświadczenie zawodowe.", "Ustalmy zakres doradztwa."]),
      method: Object.freeze(["Strategia", "Role", "Dokumenty robocze", "Governance"]),
      ctaHref: "mailto:pawel@mamcarz.com?subject=Zam%C3%B3wienia%20publiczne",
      ctaLabel: "Porozmawiaj o zamówieniach publicznych"
    }),
    en: Object.freeze({
      title: "Public procurement advisory",
      lead: "I help structure procedure strategy, responsibilities, documents and decisions in public procurement projects. I work across procurement, technology and project governance, with a clear boundary around legal responsibility.",
      description: "Structuring procedure strategy, responsibilities, documents and decisions in public procurement projects.",
      url: "https://mamcarz.com/en/uslugi/doradztwo-zamowienia-publiczne/",
      sectionTitles: Object.freeze(["Decisions before documents.", "The responsibility boundary is part of scope.", "Advisory work register.", "Procedure working order.", "Professional experience.", "Define the advisory scope."]),
      method: Object.freeze(["Strategy", "Roles", "Working documents", "Governance"]),
      ctaHref: "mailto:pawel@mamcarz.com?subject=Public%20procurement%20advisory",
      ctaLabel: "Discuss public procurement advisory"
    })
  })
});

const SERVICE_FACT_CONTRACT = Object.freeze([
  ["career.pzu.organization", "PZU S.A.", "PZU S.A.", "PZU S.A.", "Owner-confirmed pre-Task-5 career chronology, 2026-08-26", ["index.html", "en/index.html", ...SERVICE_SURFACES.transformation]],
  ["career.pzu.title", "Strategic Project Director", "Dyrektor Projektu Strategicznego", "Strategic Project Director", "Owner-confirmed pre-Task-5 career title, 2026-08-26", ["index.html", "en/index.html", ...SERVICE_SURFACES.transformation]],
  ["career.pzu.responsibility", "Procurement transformation from spend analysis to target operating model", "Prowadziłem projekt transformacji zakupów, od analizy wydatków do docelowego modelu operacyjnego.", "I led a procurement transformation project from spend analysis to the target operating model.", "Owner-confirmed pre-Task-5 responsibility, 2026-08-26", ["index.html", "en/index.html", ...SERVICE_SURFACES.transformation]],
  ["career.pwc.organization", "PwC Polska Sp. z o.o.", "PwC Polska Sp. z o.o.", "PwC Polska Sp. z o.o.", "Owner-confirmed pre-Task-5 career chronology, 2026-08-26", ["index.html", "en/index.html", ...SERVICE_SURFACES.transformation]],
  ["career.pwc.title", "Associate Director, Advisory / Procurement Expert", "Wicedyrektor w Advisory / Procurement Expert", "Associate Director, Advisory / Procurement Expert", "Owner-confirmed pre-Task-5 career title, 2026-08-26", ["index.html", "en/index.html", ...SERVICE_SURFACES.transformation]],
  ["career.pwc.responsibility", "Work with the CAPP methodology", "Pracowałem z metodyką CAPP (Complete & Agile Procurement).", "I worked with the CAPP (Complete & Agile Procurement) methodology.", "Owner-confirmed pre-Task-5 responsibility, 2026-08-26", ["index.html", "en/index.html", ...SERVICE_SURFACES.transformation]],
  ["project.orlen.role", "CONNECT project manager", "Kierownik projektu CONNECT", "CONNECT Project Manager", "Owner-confirmed pre-Task-5 project role, 2026-08-26", ["index.html", "en/index.html", ...SERVICE_SURFACES.transformation, ...PROJECT_SURFACES]],
  ["project.orlen.platform_scope", "Central sourcing platform for the ORLEN Group", "Centralna platforma sourcingowa dla Grupy ORLEN", "Central sourcing platform for the ORLEN Group", "Owner-confirmed pre-Task-5 project scope, 2026-08-26", ["index.html", "en/index.html", ...SERVICE_SURFACES.transformation, ...PROJECT_SURFACES]],
  ["project.orlen.connect_scope", "CONNECT sourcing platform for 15 ORLEN Group entities in 4 countries with a 60-person delivery team", "15 spółek Grupy ORLEN w 4 krajach, 60-osobowy zespół", "15 ORLEN Group entities across 4 countries, 60-person team", "Owner confirmed project scope, 2026-08-25", ["index.html", "en/index.html", "llms.txt", "llms-full.txt", "worker/index.js", ...SERVICE_SURFACES.transformation, ...PROJECT_SURFACES]],
  ["hero.implementations", "20+ SAP Ariba implementations", "20+", "20+", "Owner confirmation, 2026-08-25: 20+ SAP Ariba implementations", ["index.html", "en/index.html", "llms.txt", "llms-full.txt", "worker/index.js", ...SERVICE_SURFACES.ariba]],
  ["project.kghm.role", "Implementation and integration delivery", "Realizacja wdrożenia i integracji", "Implementation and integration delivery", "Owner-confirmed pre-Task-5 project role, 2026-08-26", ["index.html", "en/index.html", ...SERVICE_SURFACES.ariba, ...PROJECT_SURFACES]],
  ["project.kghm.scope", "Sourcing and external workforce management", "Sourcing i obsługa pracowników zewnętrznych", "Sourcing and external workforce management", "Owner-confirmed pre-Task-5 project scope, 2026-08-26", ["index.html", "en/index.html", ...SERVICE_SURFACES.ariba, ...PROJECT_SURFACES]],
  ["project.kghm.integration", "SAP Ariba Sourcing and Fieldglass integrated with SAP S/4HANA", "SAP Ariba Sourcing i Fieldglass zintegrowane z SAP S/4HANA", "SAP Ariba Sourcing and Fieldglass integrated with SAP S/4HANA", "Owner confirmed project scope, 2026-08-25", ["index.html", "en/index.html", "llms.txt", "llms-full.txt", ...SERVICE_SURFACES.ariba, ...PROJECT_SURFACES]],
  ["project.zabka.role", "SAP Ariba implementation-delivery responsibility", "Realizacja wdrożenia SAP Ariba", "Delivery of the SAP Ariba implementation", "Owner-confirmed pre-Task-5 implementation-delivery responsibility, 2026-08-26", ["index.html", "en/index.html", ...SERVICE_SURFACES.ariba, ...PROJECT_SURFACES]],
  ["project.zabka.implementation", "Procurement, supplier risk and sourcing functional scope", "Zakupy, ryzyko dostawców i sourcing", "Procurement, supplier risk and sourcing", "Owner-confirmed pre-Task-5 functional scope, 2026-08-26", ["index.html", "en/index.html", "llms.txt", "llms-full.txt", ...SERVICE_SURFACES.ariba, ...PROJECT_SURFACES]],
  ["project.zabka.proof", "SAP Ariba Buying, Supplier Risk and sourcing", "SAP Ariba Buying, Supplier Risk i sourcing", "SAP Ariba Buying, Supplier Risk and sourcing", "Owner-confirmed pre-Task-5 implementation proof, 2026-08-26", ["index.html", "en/index.html", ...SERVICE_SURFACES.ariba, ...PROJECT_SURFACES]],
  ["project.lot.implementation", "SAP Ariba implementation for PLL LOT", "Wdrożenie SAP Ariba dla PLL LOT", "SAP Ariba implementation for PLL LOT", "Owner confirmed project scope, 2026-08-25", ["llms.txt", "llms-full.txt", "worker/index.js", ...SERVICE_SURFACES.ariba, ...PROJECT_SURFACES]],
  ["project.motor_oil.implementation", "SAP procurement implementation for Motor Oil Hellas", "Wdrożenie SAP w obszarze zakupów dla Motor Oil Hellas", "SAP procurement implementation for Motor Oil Hellas", "Owner confirmed project scope, 2026-08-25", ["llms.txt", "llms-full.txt", "worker/index.js", ...SERVICE_SURFACES.ariba, ...PROJECT_SURFACES]],
  ["career.pkp_plk.organization", "PKP Polskie Linie Kolejowe S.A.", "PKP Polskie Linie Kolejowe S.A.", "PKP Polskie Linie Kolejowe S.A.", "Owner-confirmed pre-Task-5 career chronology, 2026-08-26", ["index.html", "en/index.html", ...SERVICE_SURFACES.publicProcurement]],
  ["career.pkp_plk.dates", "June 2013 to September 2015", "06.2013 – 09.2015", "06.2013 – 09.2015", "Owner-confirmed pre-Task-5 career chronology, 2026-08-26", ["index.html", "en/index.html", ...SERVICE_SURFACES.publicProcurement]],
  ["career.pkp_plk.title", "Board Advisor", "Doradca Zarządu", "Board Advisor", "Owner-confirmed pre-Task-5 career title, 2026-08-26", ["index.html", "en/index.html", ...SERVICE_SURFACES.publicProcurement]],
  ["career.pkp_plk.responsibility", "SAP AG framework agreement negotiation for the PKP Group", "Negocjowałem umowę ramową z SAP AG dla grupy PKP.", "I negotiated an SAP AG framework agreement for the PKP Group.", "Owner-confirmed pre-Task-5 responsibility, 2026-08-26", ["index.html", "en/index.html", ...SERVICE_SURFACES.publicProcurement]]
].map(([id, value, display_pl, display_en, source_label, surfaces]) => Object.freeze({ id, value, display_pl, display_en, kind: "constant", as_of: null, source_type: "owner_verified", source_label, source_url: null, surfaces: Object.freeze(surfaces), status: "approved" })));

function verifyServiceRegistryInventory(factData, errors, { required = false } = {}) {
  const records = Array.isArray(factData.facts) ? factData.facts : [];
  const publicSurfaces = Array.isArray(factData.public_claim_surfaces) ? factData.public_claim_surfaces : [];
  const contractIds = new Set(SERVICE_FACT_CONTRACT.map((record) => record.id));
  const ownsServiceState = records.some((record) => contractIds.has(record?.id)
      || (Array.isArray(record?.surfaces) && record.surfaces.some((surface) => SERVICE_SURFACE_LIST.includes(surface))))
    || publicSurfaces.some((surface) => SERVICE_SURFACE_LIST.includes(surface));
  if (!required && !ownsServiceState) return;

  const failures = [];
  if (JSON.stringify(publicSurfaces) !== JSON.stringify(SERVICE_PUBLIC_SURFACE_CONTRACT)) {
    failures.push("public_claim_surfaces must equal the exact ordered service-aware public surface contract");
  }

  for (const surface of SERVICE_SURFACE_LIST) {
    const expectedIds = SERVICE_FACT_CONTRACT
      .filter((record) => record.status === "approved" && record.surfaces.includes(surface))
      .map((record) => record.id)
      .sort();
    const actualIds = records
      .filter((record) => Array.isArray(record?.surfaces) && record.surfaces.includes(surface))
      .map((record) => record.id)
      .sort();
    if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
      failures.push(`${surface} must authorize exactly ${expectedIds.join(", ")}`);
    }
  }

  for (const expected of SERVICE_FACT_CONTRACT) {
    const matches = records.filter((record) => record?.id === expected.id);
    if (matches.length !== 1 || JSON.stringify(matches[0].surfaces) !== JSON.stringify(expected.surfaces)) {
      failures.push(`${expected.id} must retain its exact complete surface inventory`);
    }
  }

  if (failures.length > 0) {
    error(errors, "service-registry-inventory", "content/site-facts.json", failures.join("; "));
  }
}

async function hasCompleteServiceDocumentContext(root) {
  const documents = await Promise.all(SERVICE_SURFACE_LIST.map(async (path) => {
    try {
      return (await stat(resolve(root, path))).isFile();
    } catch {
      return false;
    }
  }));
  return documents.every(Boolean);
}

const SERVICE_DOCUMENT_MANIFEST = Object.freeze({
  transformation: Object.freeze({ pl: "13d5e946545d212ca2763242962f753c316ce5d5ccc5f52ddf515ba0d8da1fde", en: "6d53556149ca00f68fa0c3dd51afcb9b4c8e968d9a00bd04407f2d28a0c907db" }),
  ariba: Object.freeze({ pl: "a1974b5ba5affc228b38c8afdd277a38cb74d7bdf6e87478f677454c8b9f2f08", en: "2979c9d690e7447d2917d6cfe86b067ca2f5698aa0bccdf3c726e32ac78939ea" }),
  publicProcurement: Object.freeze({ pl: "2a60ae7c00aef9b6f412fbe35f71c5a65a1162589ae193ad3af532a6ae3dcf25", en: "87e7bc40ed677276c7bf326272c6a9abdb7b4044ff865be6acdf7614346b5b22" })
});

function serviceKeyForPath(path) {
  if (path.includes("transformacja-zakupow")) return "transformation";
  if (path.includes("wdrozenie-sap-ariba")) return "ariba";
  return "publicProcurement";
}

function serviceDocumentDigest(parsedRoot) {
  const records = documentNodeDescendants(parsedRoot).map((node) => {
    if (node.type === "text") return ["text", node.value];
    if (node.type === "comment") return ["comment", node.value];
    if (node.type !== "element") return [node.type];
    return ["element", node.name, node.attributes.sourceAttributeCount ?? node.attributes.size, [...node.attributes].map(([name, value]) => [name, value ?? null])];
  });
  return createHash("sha256").update(JSON.stringify(records)).digest("hex");
}

function verifyServiceFactContract(path, factData, requiredIds, errors) {
  const records = Array.isArray(factData.facts) ? factData.facts : [];
  const byId = new Map(records.map((record) => [record.id, record]));
  const required = new Set(requiredIds);
  const valid = SERVICE_FACT_CONTRACT.filter((expected) => required.has(expected.id)).every((expected) => {
    const actual = byId.get(expected.id);
    return actual
      && ["id", "value", "display_pl", "display_en", "kind", "as_of", "source_type", "source_label", "source_url", "status"].every((key) => actual[key] === expected[key])
      && JSON.stringify(actual.surfaces) === JSON.stringify(expected.surfaces);
  });
  if (!valid) error(errors, "service-fact-contract", path, "requires every approved advisory fact value, display, status, provenance, null URL and exact service surface from the immutable Task 5 contract");
}

function serviceCanonicalCorpus(parsedRoot) {
  return normalizeExactHtmlLiteral(documentNodeDescendants(parsedRoot).map((node) => {
    if (node.type === "text" || node.type === "comment") return node.value;
    if (node.type !== "element") return "";
    return `${node.name} ${[...node.attributes].map(([name, value]) => `${name} ${value ?? ""}`).join(" ")}`;
  }).join(" ")).replace(/[^\p{L}\p{N}+#]+/gu, " ").trim();
}

function verifyServiceClaimBoundary(path, parsedRoot, errors) {
  const corpus = serviceCanonicalCorpus(parsedRoot);
  const compactTextCorpus = normalizeExactHtmlLiteral(documentNodeDescendants(parsedRoot)
    .filter((node) => node.type === "text" || node.type === "comment")
    .map((node) => node.value)
    .join(""))
    .replace(/[^\p{L}\p{N}+#]+/gu, "");
  const forbidden = [
    /polpharma/i, /500\s*m(?:ln|illion)?\s*pln/i, /pln\s*500\s*m/i, /100\s*m\+?\s*pln/i,
    /marketplanet/i, /gold\s*partner/i, /all\s*for\s*one/i, /award/i, /nagrod/i,
    /largest|leading|największ|wiodąc/i, /guaranteed|gwarantowan/i,
    /not\s+just|nie\s+tylko|comprehensive|kompleksow/i
  ];
  const compactForbidden = [/polpharma/i, /marketplanet/i, /goldpartner/i, /allforone/i];
  if (forbidden.some((pattern) => pattern.test(corpus)) || compactForbidden.some((pattern) => pattern.test(compactTextCorpus))) {
    error(errors, "service-claim-boundary", path, "forbids unsupported clients, values, results, ranks, partner or ownership status, legal conclusions and AI-tell sales copy across active and inactive source");
  }
}

function verifyServiceResourceCensus(path, parsedRoot, lang, contract, errors) {
  const elements = elementDescendants(parsedRoot);
  const forbiddenTags = new Set(["audio", "base", "embed", "form", "iframe", "object", "picture", "source", "style", "video"]);
  const images = elements.filter((element) => element.name === "img");
  const validSignature = images.length === 1
    && elementAttribute(images[0], "src") === "/assets/img/signature.png"
    && elementAttribute(images[0], "alt") === ""
    && elementIsWithin(images[0], elements.find((element) => element.name === "footer"));
  const eventOrStyle = elements.some((element) => element.attributes.has("style") || [...element.attributes.keys()].some((name) => /^on/i.test(name)));
  const extraExecutable = elements.filter((element) => element.name === "script").some((script) => {
    const type = elementAttribute(script, "type");
    const src = elementAttribute(script, "src");
    return !((type === "application/ld+json" && !src) || (src === "/assets/js/main.js?v=20260825-flightplan-2" && script.attributes.has("defer")));
  });
  const externalAnchors = elements.filter((element) => element.name === "a").filter((anchor) => {
    const href = browserNormalizedUrl(elementAttribute(anchor, "href"));
    return !nonEmptyString(href) || (!href.startsWith("/") && !href.startsWith("#") && href !== contract.ctaHref);
  });
  if (!validSignature || elements.some((element) => forbiddenTags.has(element.name)) || eventOrStyle || extraExecutable || externalAnchors.length > 0) {
    error(errors, "service-resource-census", path, "allows only the shared shell signature, exact local navigation resources, one bounded schema, one shared script and the contextual mail CTA");
  }
}

function verifyServiceSchema(path, parsedRoot, contract, errors) {
  const scripts = elementDescendants(parsedRoot).filter((element) => element.name === "script" && elementAttribute(element, "type") === "application/ld+json");
  let schema = null;
  try { schema = scripts.length === 1 ? JSON.parse(rawElementText(scripts[0])) : null; } catch { schema = null; }
  const expected = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: contract.title,
    url: contract.url,
    description: contract.description,
    provider: { "@type": "Person", name: "Paweł Mamcarz" }
  };
  if (!sameJsonContract(schema, expected)) error(errors, "service-schema", path, "requires one exact localized Service schema with name, URL, purpose and Paweł Mamcarz provider only");
}

function verifyServicePage(path, parsedRoot, lang, factData, errors) {
  const key = serviceKeyForPath(path);
  const pair = SERVICE_CONTRACTS[key];
  const contract = pair[lang];
  const all = elementDescendants(parsedRoot);
  const body = htmlBodyRoot(parsedRoot);
  const main = all.find((element) => element.name === "main" && elementAttribute(element, "id") === "main");
  verifyServiceFactContract(path, factData, pair.facts, errors);
  if (elementAttribute(body, "data-page") !== "services") error(errors, "service-shell", path, 'body must use data-page="services"');
  const h1s = all.filter((element) => element.name === "h1" && pageElementIsActive(element));
  if (h1s.length !== 1 || publishedStaticText(h1s[0]) !== normalizeExactLiteral(contract.title)) error(errors, "service-h1", path, "requires the exact localized service H1");
  const leads = all.filter((element) => elementHasClass(element, "page-lead") && pageElementIsActive(element));
  if (leads.length !== 1 || publishedStaticText(leads[0]) !== normalizeExactLiteral(contract.lead)) error(errors, "service-lead", path, "requires the exact claim-safe localized lead");

  const sectionMarkers = all.filter((element) => element.attributes.has("data-section"));
  const directSections = directElementChildren(main, "section");
  const names = sectionMarkers.map((section) => elementAttribute(section, "data-section"));
  const titles = directSections.map((section) => elementDescendants(section, "h2")[0]).map((heading) => heading ? publishedStaticText(heading) : "");
  if (JSON.stringify(names) !== JSON.stringify(SERVICE_SECTION_ORDER)
    || directSections.length !== SERVICE_SECTION_ORDER.length
    || !directSections.every((section, index) => section === sectionMarkers[index] && pageElementIsActive(section))
    || JSON.stringify(titles) !== JSON.stringify(contract.sectionTitles.map(normalizeExactLiteral))) {
    error(errors, "service-sections", path, "requires the exact six direct visible problem, fit, scope, method, evidence and contact sections with localized titles");
  }

  const methodSection = sectionMarkers.find((section) => elementAttribute(section, "data-section") === "method");
  const methodSteps = methodSection ? elementDescendants(methodSection).filter((element) => element.attributes.has("data-method-step")) : [];
  const methodValid = methodSteps.length === contract.method.length
    && methodSteps.every((step, index) => elementAttribute(step, "data-method-step") === String(index + 1)
      && publishedStaticText(elementDescendants(step, "h3")[0]) === normalizeExactLiteral(contract.method[index])
      && pageElementIsActive(step));
  if (!methodValid) error(errors, "service-method", path, "requires the exact ordered four-step localized method sequence");

  const evidenceSection = sectionMarkers.find((section) => elementAttribute(section, "data-section") === "evidence");
  const evidenceNodes = evidenceSection ? elementDescendants(evidenceSection).filter((element) => element.attributes.has("data-fact-id")) : [];
  const factIds = evidenceNodes.map((node) => elementAttribute(node, "data-fact-id"));
  const immutableById = new Map(SERVICE_FACT_CONTRACT.map((record) => [record.id, record]));
  const evidenceValid = JSON.stringify(factIds) === JSON.stringify(pair.facts)
    && evidenceNodes.every((node, index) => {
      const fact = immutableById.get(pair.facts[index]);
      return fact && publishedStaticText(node) === normalizeExactLiteral(lang === "pl" ? fact.display_pl : fact.display_en) && pageElementIsActive(node);
    });
  if (!evidenceValid) error(errors, "service-evidence", path, "requires the exact ordered immutable evidence IDs and localized literals");

  const controls = all.filter((element) => (element.name === "a" || element.name === "button")
    && (["btn-primary", "btn-secondary", "btn-ghost", "cta-link"].some((className) => elementHasClass(element, className))
      || /^mailto:/i.test(browserNormalizedUrl(elementAttribute(element, "href")) ?? "")));
  const contact = sectionMarkers.find((section) => elementAttribute(section, "data-section") === "contact");
  const cta = controls[0];
  if (controls.length !== 1 || cta?.name !== "a" || !elementIsWithin(cta, contact)
    || elementAttribute(cta, "href") !== contract.ctaHref || publishedStaticText(cta) !== normalizeExactLiteral(contract.ctaLabel)) {
    error(errors, "service-controls", path, "requires one contextual localized mail CTA and no other conversion control");
  }

  const nav = all.find((element) => element.name === "nav" && elementHasClass(element, "site-nav") && pageElementIsActive(element));
  const current = nav ? elementDescendants(nav, "a").filter((anchor) => elementAttribute(anchor, "aria-current") === "page") : [];
  const toggle = nav ? directElementChildren(nav, "button").find((element) => elementHasClass(element, "nav-toggle")) : null;
  const advisory = nav ? elementDescendants(nav, "details").find((element) => elementHasClass(element, "nav-group")) : null;
  const expectedCurrent = lang === "pl" ? `/${path.replace(/index\.html$/, "")}` : `/${path.replace(/index\.html$/, "")}`;
  if (current.length !== 1 || elementAttribute(current[0], "href") !== expectedCurrent
    || !exactApplicationAttributes(toggle, { class: "nav-toggle", id: "nav-toggle", "aria-label": lang === "pl" ? "Menu nawigacyjne" : "Navigation menu", "aria-controls": "nav-menu", "aria-expanded": "false" }, new Set(["aria-label"]))
    || !exactElementAttributes(advisory, { class: "nav-group" })) {
    error(errors, "service-shell", path, "requires the current advisory route, exact closed mobile toggle state and closed advisory disclosure");
  }

  verifyServiceSchema(path, parsedRoot, contract, errors);
  verifyServiceResourceCensus(path, parsedRoot, lang, contract, errors);
  verifyServiceClaimBoundary(path, parsedRoot, errors);
  const digest = serviceDocumentDigest(parsedRoot);
  if (digest !== SERVICE_DOCUMENT_MANIFEST[key][lang]) error(errors, "service-document-manifest", path, `requires immutable full-document text, comment, element and raw attribute manifest; actual ${digest}`);
  return factIds;
}

function verifyServiceParity(plFacts, enFacts, errors) {
  if (JSON.stringify(plFacts) !== JSON.stringify(enFacts)) error(errors, "service-parity", "services", "PL and EN evidence order must be structurally identical");
}

async function verifyAviationHomepageLinks(context) {
  for (const [path, href] of [["index.html", "/lotnictwo/"], ["en/index.html", "/en/lotnictwo/"]]) {
    const html = await readRequired(context, path, "aviation-home-link");
    const parsed = parseStaticHtml(html);
    const links = elementDescendants(parsed.root, "a")
      .filter((anchor) => pageElementIsActive(anchor) && browserNormalizedUrl(elementAttribute(anchor, "href")) === href);
    if (links.length < 1) error(context.errors, "aviation-home-link", path, `requires a direct visible ${href} link`);
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

const SPEAKING_GROUP_ORDER = Object.freeze(["topics", "formats", "audience", "contact"]);
const SPEAKING_CONTRACT = Object.freeze({
  pl: Object.freeze({
    title: "Wystąpienia",
    lead: "Temat i format dobieram do decyzji, z którą mierzy się publiczność. Zakres, czas i materiały ustalamy dopiero po poznaniu kontekstu wydarzenia.",
    url: "https://mamcarz.com/wystapienia/",
    description: "Temat i format dobieram do decyzji, z którą mierzy się publiczność. Zakres, czas i materiały ustalamy dopiero po poznaniu kontekstu wydarzenia.",
    topics: Object.freeze([
      ["transformation", "Transformacja zakupów", "Model operacyjny, role, procesy, dane i technologia."],
      ["ariba", "SAP Ariba", "Decyzje procesowe, zakres wdrożenia, integracje, testy i uruchomienie."],
      ["digital", "Digital procurement", "Przejście od projektu procesu do działającego środowiska operacyjnego."],
      ["public-procurement", "Zamówienia publiczne i technologia", "Struktura decyzji, odpowiedzialności, dokumentów i narzędzi."],
      ["leadership", "Przywództwo w zmianie", "Porządkowanie odpowiedzialności, komunikacji i tempa wdrożenia."]
    ]),
    formats: Object.freeze([
      ["talk", "Wystąpienie", "Skoncentrowana teza i uporządkowany materiał dla wspólnej sesji."],
      ["panel", "Panel", "Rozmowa prowadzona wokół pytań i decyzji istotnych dla odbiorców."],
      ["workshop", "Warsztat", "Praca na problemie, procesie lub scenariuszu wskazanym przez organizatora."],
      ["lecture", "Wykład", "Materiał osadzony w programie i poziomie przygotowania grupy."]
    ]),
    audiences: Object.freeze([["conferences", "Konferencje i fora branżowe"], ["teams", "Zespoły zakupowe i projektowe"], ["universities", "Uczelnie i programy executive"]]),
    contactHeading: "Najpierw kontekst",
    contactText: "W wiadomości podaj temat, odbiorców i cel wydarzenia. Format i zakres ustalimy na tej podstawie.",
    ctaHref: "mailto:pawel@mamcarz.com?subject=Wyst%C4%85pienie",
    ctaLabel: "Napisz o wystąpieniu"
  }),
  en: Object.freeze({
    title: "Speaking",
    lead: "I shape the topic and format around the decision facing the audience. Scope, timing and materials are agreed only after the event context is clear.",
    url: "https://mamcarz.com/en/wystapienia/",
    description: "I shape the topic and format around the decision facing the audience. Scope, timing and materials are agreed only after the event context is clear.",
    topics: Object.freeze([
      ["transformation", "Procurement transformation", "Operating model, roles, processes, data and technology."],
      ["ariba", "SAP Ariba", "Process decisions, implementation scope, integrations, testing and launch."],
      ["digital", "Digital procurement", "Moving from process design to an operational environment."],
      ["public-procurement", "Public procurement and technology", "The structure of decisions, responsibilities, documents and tools."],
      ["leadership", "Leading change", "Structuring accountability, communication and implementation pace."]
    ]),
    formats: Object.freeze([
      ["talk", "Talk", "A focused thesis and structured material for a shared session."],
      ["panel", "Panel", "A discussion built around the questions and decisions that matter to the audience."],
      ["workshop", "Workshop", "Work on a problem, process or scenario selected by the organiser."],
      ["lecture", "Lecture", "Material aligned with the programme and the group's level of preparation."]
    ]),
    audiences: Object.freeze([["conferences", "Industry conferences and forums"], ["teams", "Procurement and project teams"], ["universities", "Universities and executive programmes"]]),
    contactHeading: "Context first",
    contactText: "In your message, include the topic, audience and purpose of the event. We will define the format and scope from there.",
    ctaHref: "mailto:pawel@mamcarz.com?subject=Speaking%20enquiry",
    ctaLabel: "Write about a speaking enquiry"
  })
});

const SPEAKING_DOCUMENT_MANIFEST = Object.freeze({ pl: "ce016d189592e2f1c7bb5ce6b3bc6c91cd00d0bea2c22d741e215a580b2304ec", en: "7d5c274ba7752fd23eaa9585f4388a407f02d9fae111e6660450245625ea0b5c" });

function verifySpeakingRegistryInventory(factData, errors, { required = false } = {}) {
  const records = Array.isArray(factData.facts) ? factData.facts : [];
  const surfaces = Array.isArray(factData.public_claim_surfaces) ? factData.public_claim_surfaces : [];
  const ownsState = surfaces.some((surface) => SPEAKING_SURFACES.includes(surface))
    || records.some((record) => Array.isArray(record?.surfaces) && record.surfaces.some((surface) => SPEAKING_SURFACES.includes(surface)));
  if (!required && !ownsState) return;
  const failures = [];
  if (JSON.stringify(surfaces) !== JSON.stringify(SERVICE_PUBLIC_SURFACE_CONTRACT)) failures.push("public_claim_surfaces must equal the exact Speaking-aware ordered contract");
  for (const surface of SPEAKING_SURFACES) {
    const ids = records.filter((record) => Array.isArray(record?.surfaces) && record.surfaces.includes(surface)).map((record) => record.id);
    if (ids.length !== 0) failures.push(`${surface} must have an empty reverse fact inventory`);
  }
  if (failures.length) error(errors, "speaking-registry-inventory", "content/site-facts.json", failures.join("; "));
}

function exactLabeledEntries(section, attribute, expected) {
  const nodes = section ? elementDescendants(section).filter((element) => element.attributes.has(attribute)) : [];
  return nodes.length === expected.length && nodes.every((node, index) => {
    const headings = elementDescendants(node).filter((element) => element.name === "h3");
    const paragraphs = elementDescendants(node).filter((element) => element.name === "p");
    return elementAttribute(node, attribute) === expected[index][0]
      && headings.length === 1
      && publishedStaticText(headings[0]) === normalizeExactLiteral(expected[index][1])
      && (expected[index].length === 2 || (paragraphs.length === 1 && publishedStaticText(paragraphs[0]) === normalizeExactLiteral(expected[index][2])))
      && pageElementIsActive(node);
  });
}

function verifySpeakingSchema(path, parsedRoot, lang, errors) {
  const contract = SPEAKING_CONTRACT[lang];
  const scripts = elementDescendants(parsedRoot).filter((element) => element.name === "script" && elementAttribute(element, "type") === "application/ld+json");
  let actual = null;
  try { actual = scripts.length === 1 ? JSON.parse(rawElementText(scripts[0])) : null; } catch { actual = null; }
  const expected = { "@context": "https://schema.org", "@type": "WebPage", name: contract.title, url: contract.url, description: contract.description, inLanguage: lang };
  if (!sameJsonContract(actual, expected)) error(errors, "speaking-schema", path, "requires one exact bounded localized WebPage schema");
}

function verifySpeakingClaimBoundary(path, parsedRoot, errors) {
  const nodes = documentNodeDescendants(parsedRoot);
  const corpus = normalizeExactHtmlLiteral(nodes.map((node) => {
    if (node.type === "text" || node.type === "comment") return node.value;
    if (node.type !== "element") return "";
    return `${node.name} ${[...node.attributes].map(([name, value]) => `${name} ${value ?? ""}`).join(" ")}`;
  }).join(" ")).replace(/[^\p{L}\p{N}+#]+/gu, " ");
  const compact = normalizeExactHtmlLiteral(nodes.filter((node) => node.type === "text" || node.type === "comment").map((node) => node.value).join("")).replace(/[^\p{L}\p{N}]+/gu, "");
  const forbidden = [
    /\b100\s*(?:\+|organizac|organisation)/i, /\b25\s*\+/, /\b(?:30\s*(?:[-–]\s*60)|2\s*(?:[-–]\s*4)|8\s*(?:[-–]\s*16)|30)\s*(?:min|h|hours?|godzin)/i,
    /polish\s+english\s+german|polski\s+angielski\s+niemiecki/i,
    /współprac[^\s]*\s+z\s+uczelni|partner[^\s]*\s+with\s+universit/i,
    /works?\s+in\s+practice|działa\w*\s+w\s+praktyce|lessons?\s+learned/i,
    /\borlen\b|\bkghm\b|żabka|pll\s+lot|motor\s+oil|polpharma|warsaw\s*flight\s*safety/i,
    /successful|sukces|result|rezultat|outcome|wynik|available|dostępn/i
  ];
  if (forbidden.some((pattern) => pattern.test(corpus)) || /warsawflightsafety|polpharma/i.test(compact)) {
    error(errors, "speaking-claim-boundary", path, "forbids legacy counts, durations, delivery-language, collaboration, client, result, status and retired-brand claims across active and inactive source");
  }
}

function verifySpeakingResourceCensus(path, parsedRoot, contract, errors) {
  const all = elementDescendants(parsedRoot);
  const forbiddenTags = new Set(["audio", "base", "embed", "form", "iframe", "object", "picture", "source", "style", "video"]);
  const signatureImages = all.filter((element) => element.name === "img" && elementIsWithin(element, all.find((candidate) => elementHasClass(candidate, "footer-sign"))));
  const validSignature = signatureImages.length === 1 && exactElementAttributes(signatureImages[0], {
    src: "/assets/img/signature.png",
    alt: "",
    width: "160",
    height: "50",
    loading: "lazy",
    decoding: "async"
  }) && all.filter((element) => element.name === "img").length === 1;
  const invalidAnchor = all.filter((element) => element.name === "a").some((anchor) => {
    const href = browserNormalizedUrl(elementAttribute(anchor, "href"));
    return !nonEmptyString(href) || (!href.startsWith("/") && !href.startsWith("#") && href !== contract.ctaHref);
  });
  const scripts = all.filter((element) => element.name === "script");
  const validScripts = scripts.length === 2
    && scripts.filter((script) => elementAttribute(script, "type") === "application/ld+json" && !elementAttribute(script, "src")).length === 1
    && scripts.filter((script) => elementAttribute(script, "src") === "/assets/js/main.js?v=20260825-flightplan-2" && script.attributes.has("defer") && !rawElementText(script)).length === 1;
  if (all.some((element) => forbiddenTags.has(element.name) || element.attributes.has("style") || [...element.attributes.keys()].some((name) => /^on/i.test(name))) || invalidAnchor || !validScripts || !validSignature) {
    error(errors, "speaking-resource-census", path, "allows only the exact footer signature image and forbids embeds, forms, external URLs, inline styles, extra scripts or controls");
  }
}

function verifySpeakingPage(path, parsedRoot, lang, errors) {
  const contract = SPEAKING_CONTRACT[lang];
  const all = elementDescendants(parsedRoot);
  const body = htmlBodyRoot(parsedRoot);
  const main = all.find((element) => element.name === "main" && elementAttribute(element, "id") === "main");
  if (elementAttribute(body, "data-page") !== "speaking") error(errors, "speaking-shell", path, 'body must use data-page="speaking"');
  const h1s = all.filter((element) => element.name === "h1" && pageElementIsActive(element));
  const leads = all.filter((element) => elementHasClass(element, "page-lead") && pageElementIsActive(element));
  if (h1s.length !== 1 || publishedStaticText(h1s[0]) !== normalizeExactLiteral(contract.title)) error(errors, "speaking-h1", path, "requires exact localized Speaking identity");
  if (leads.length !== 1 || publishedStaticText(leads[0]) !== normalizeExactLiteral(contract.lead)) error(errors, "speaking-lead", path, "requires exact localized event-context lead");
  const groups = all.filter((element) => element.attributes.has("data-section"));
  const direct = directElementChildren(main, "section");
  if (JSON.stringify(groups.map((group) => elementAttribute(group, "data-section"))) !== JSON.stringify(SPEAKING_GROUP_ORDER)
    || direct.length !== 4 || !direct.every((section, index) => section === groups[index] && pageElementIsActive(section))) {
    error(errors, "speaking-groups", path, "requires exactly four direct ordered visible groups");
  }
  const byId = new Map(groups.map((group) => [elementAttribute(group, "data-section"), group]));
  if (!exactLabeledEntries(byId.get("topics"), "data-topic", contract.topics)
    || !exactLabeledEntries(byId.get("formats"), "data-format", contract.formats)
    || !exactLabeledEntries(byId.get("audience"), "data-audience", contract.audiences)) {
    error(errors, "speaking-programme", path, "requires the exact localized ordered topic, format and audience manifests");
  }
  const contact = byId.get("contact");
  const contactH2 = contact ? elementDescendants(contact, "h2") : [];
  const contactP = contact ? elementDescendants(contact, "p").filter((element) => publishedStaticText(element) === normalizeExactLiteral(contract.contactText)) : [];
  if (contactH2.length !== 1 || publishedStaticText(contactH2[0]) !== normalizeExactLiteral(contract.contactHeading)
    || contactP.length !== 1 || publishedStaticText(contactP[0]) !== normalizeExactLiteral(contract.contactText)) {
    error(errors, "speaking-contact", path, "requires exact localized context-first contact copy");
  }
  const controls = all.filter((element) => (element.name === "a" || element.name === "button")
    && (elementHasClass(element, "btn-primary") || /^mailto:/i.test(browserNormalizedUrl(elementAttribute(element, "href")) ?? "")));
  if (controls.length !== 1 || controls[0].name !== "a" || !elementIsWithin(controls[0], contact)
    || elementAttribute(controls[0], "href") !== contract.ctaHref || publishedStaticText(controls[0]) !== normalizeExactLiteral(contract.ctaLabel)) {
    error(errors, "speaking-controls", path, "requires one exact localized contextual mail CTA");
  }
  const factNodes = all.filter((element) => element.attributes.has("data-fact-id"));
  if (factNodes.length) error(errors, "speaking-fact-inventory", path, "Speaking pages must render no registry fact rows");
  const current = all.filter((element) => element.name === "a" && elementAttribute(element, "aria-current") === "page");
  const expectedCurrent = lang === "pl" ? "/wiedza/" : "/en/wiedza/";
  if (current.length !== 1 || elementAttribute(current[0], "href") !== expectedCurrent) error(errors, "speaking-shell", path, "requires Knowledge as the sole current local navigation route");
  verifySpeakingSchema(path, parsedRoot, lang, errors);
  verifySpeakingResourceCensus(path, parsedRoot, contract, errors);
  verifySpeakingClaimBoundary(path, parsedRoot, errors);
  const digest = serviceDocumentDigest(parsedRoot);
  if (digest !== SPEAKING_DOCUMENT_MANIFEST[lang]) error(errors, "speaking-document-manifest", path, `requires exact full-document manifest; actual ${digest}`);
}

const PROCUREMENT_PARENT = Object.freeze({
  title: "Procurement Process 2026",
  lead: "Interaktywny model procesu zakupowego. Poniżej znajdują się cztery materiały tworzące jego strukturę.",
  url: "https://mamcarz.com/procurement-2026/",
  ctaHref: "mailto:pawel@mamcarz.com?subject=Procurement%20Process%202026",
  iframes: Object.freeze([
    ["/diagrams/infographic.html", "Procurement 2026 · infographic", "Infografika: od cyklu do orkiestracji", "Materiał w języku angielskim"],
    ["/diagrams/diagram1_universal.html", "Procurement Process 2026 · interaktywny diagram", "Diagram procesu zakupowego", null],
    ["/diagrams/diagram2_ariba.html", "SAP Ariba Module Mapping", "Mapowanie modułów SAP Ariba", null],
    ["/diagrams/diagram3_maturity.html", "Procurement Maturity Assessment", "Ocena dojrzałości zakupowej", null]
  ])
});
const PROCUREMENT_DOCUMENT_MANIFEST = "5e34a84d5953e997a20a6ce0128a8863234e2f8e06b0c9358baab9995edcc080";

function verifyProcurementSchema(parsedRoot, errors) {
  const scripts = elementDescendants(parsedRoot).filter((element) => element.name === "script" && elementAttribute(element, "type") === "application/ld+json");
  let actual = null;
  try { actual = scripts.length === 1 ? JSON.parse(rawElementText(scripts[0])) : null; } catch { actual = null; }
  const expected = { "@context": "https://schema.org", "@type": "WebPage", name: PROCUREMENT_PARENT.title, url: PROCUREMENT_PARENT.url, description: PROCUREMENT_PARENT.lead, inLanguage: "pl" };
  if (!sameJsonContract(actual, expected)) error(errors, "procurement-schema", "procurement-2026/index.html", "requires one exact bounded Polish WebPage schema");
}

async function verifyProcurementParent(_factData, context) {
  const path = "procurement-2026/index.html";
  const html = await readRequired(context, path, "procurement-file");
  const parsedRoot = parseStaticHtml(html).root;
  const all = elementDescendants(parsedRoot);
  const body = htmlBodyRoot(parsedRoot);
  const main = all.find((element) => element.name === "main" && elementAttribute(element, "id") === "main");
  if (elementAttribute(body, "data-page") !== "procurement-parent") error(context.errors, "procurement-shell", path, 'body must use data-page="procurement-parent"');
  const h1s = all.filter((element) => element.name === "h1" && pageElementIsActive(element));
  const leads = all.filter((element) => elementHasClass(element, "page-lead") && pageElementIsActive(element));
  if (h1s.length !== 1 || publishedStaticText(h1s[0]) !== PROCUREMENT_PARENT.title || leads.length !== 1 || publishedStaticText(leads[0]) !== normalizeExactLiteral(PROCUREMENT_PARENT.lead)) {
    error(context.errors, "procurement-identity", path, "requires exact Procurement Process 2026 identity and lead");
  }
  const head = directElementChildren(directElementChildren(parsedRoot, "html")[0], "head")[0];
  const canonical = head ? directElementChildren(head, "link").filter((link) => elementAttribute(link, "rel") === "canonical") : [];
  const alternates = head ? directElementChildren(head, "link").filter((link) => elementAttribute(link, "rel") === "alternate") : [];
  const actualAlternates = alternates.map((link) => [elementAttribute(link, "hreflang"), elementAttribute(link, "href")]);
  if (canonical.length !== 1 || elementAttribute(canonical[0], "href") !== PROCUREMENT_PARENT.url
    || JSON.stringify(actualAlternates) !== JSON.stringify([["pl", PROCUREMENT_PARENT.url], ["x-default", PROCUREMENT_PARENT.url]])) {
    error(context.errors, "procurement-hreflang", path, "requires canonical plus only pl and x-default alternates");
  }
  const languageLinks = all.filter((element) => element.name === "a" && elementHasClass(element, "nav-lang"));
  if (languageLinks.length !== 1 || elementAttribute(languageLinks[0], "href") !== "/en/wiedza/" || languageLinks[0].attributes.has("hreflang") || publishedStaticText(languageLinks[0]) !== "EN") {
    error(context.errors, "procurement-language-link", path, "requires visible EN reader link to /en/wiedza/ without hreflang");
  }
  const sourceCorpus = documentNodeDescendants(parsedRoot).map((node) => node.type === "element"
    ? [...node.attributes.values()].join(" ")
    : (node.value ?? "")).join(" ");
  if (knowledgeHasBannedRoute(sourceCorpus) || knowledgeInactiveUrlViolation(parsedRoot) || knowledgeUrlPropertyViolation(parsedRoot)) {
    error(context.errors, "procurement-route-boundary", path, "forbids any active, encoded or inactive /en/procurement-2026/ route");
  }
  const artifactSections = directElementChildren(main, "section").filter((element) => elementHasClass(element, "procurement-artifacts"));
  const artifacts = artifactSections.length === 1 ? elementDescendants(artifactSections[0]).filter((element) => element.attributes.has("data-artifact")) : [];
  const frames = all.filter((element) => element.name === "iframe");
  const exactFrames = frames.length === 4 && frames.every((frame, index) => elementAttribute(frame, "src") === PROCUREMENT_PARENT.iframes[index][0]
    && elementAttribute(frame, "title") === PROCUREMENT_PARENT.iframes[index][1]
    && elementIsWithin(frame, artifacts[index]));
  const exactArtifacts = artifacts.length === 4 && artifacts.every((artifact, index) => {
    const headings = elementDescendants(artifact, "h2");
    const labels = elementDescendants(artifact).filter((element) => elementHasClass(element, "artifact-language"));
    return elementAttribute(artifact, "data-artifact") === String(index + 1)
      && headings.length === 1 && publishedStaticText(headings[0]) === normalizeExactLiteral(PROCUREMENT_PARENT.iframes[index][2])
      && (PROCUREMENT_PARENT.iframes[index][3] ? labels.length === 1 && publishedStaticText(labels[0]) === normalizeExactLiteral(PROCUREMENT_PARENT.iframes[index][3]) : labels.length === 0);
  });
  if (artifactSections.length !== 1 || !exactFrames || !exactArtifacts) error(context.errors, "procurement-iframes", path, "requires one exact four-artifact dossier with preserved source, order, title, heading and English label");
  const controls = all.filter((element) => (element.name === "a" || element.name === "button")
    && (elementHasClass(element, "btn-primary") || /^mailto:/i.test(browserNormalizedUrl(elementAttribute(element, "href")) ?? "")));
  if (controls.length !== 1 || controls[0].name !== "a" || elementAttribute(controls[0], "href") !== PROCUREMENT_PARENT.ctaHref) error(context.errors, "procurement-controls", path, "requires one contextual Procurement mail CTA");
  const forbiddenTags = new Set(["audio", "base", "embed", "form", "object", "picture", "source", "style", "video"]);
  const signatureImages = all.filter((element) => element.name === "img" && elementIsWithin(element, all.find((candidate) => elementHasClass(candidate, "footer-sign"))));
  const validSignature = signatureImages.length === 1 && exactElementAttributes(signatureImages[0], {
    src: "/assets/img/signature.png",
    alt: "",
    width: "160",
    height: "50",
    loading: "lazy",
    decoding: "async"
  }) && all.filter((element) => element.name === "img").length === 1;
  const invalidAnchor = all.filter((element) => element.name === "a").some((anchor) => {
    const href = browserNormalizedUrl(elementAttribute(anchor, "href"));
    return !nonEmptyString(href) || (!href.startsWith("/") && !href.startsWith("#") && href !== PROCUREMENT_PARENT.ctaHref);
  });
  const scripts = all.filter((element) => element.name === "script");
  const validScripts = scripts.length === 2
    && scripts.filter((script) => elementAttribute(script, "type") === "application/ld+json" && !elementAttribute(script, "src")).length === 1
    && scripts.filter((script) => elementAttribute(script, "src") === "/assets/js/main.js?v=20260825-flightplan-2" && script.attributes.has("defer")).length === 1;
  if (all.some((element) => forbiddenTags.has(element.name) || element.attributes.has("style") || [...element.attributes.keys()].some((name) => /^on/i.test(name)))
    || invalidAnchor || !validScripts || !validSignature || frames.length !== 4) error(context.errors, "procurement-resource-census", path, "forbids inline styles, external/extra resources, controls and executable drift while allowing exactly four frames plus the exact footer signature image");
  verifyProcurementSchema(parsedRoot, context.errors);
  const digest = serviceDocumentDigest(parsedRoot);
  if (digest !== PROCUREMENT_DOCUMENT_MANIFEST) error(context.errors, "procurement-document-manifest", path, `requires exact full-document manifest; actual ${digest}`);
  await verifyLocalLinks(path, parsedRoot, "speaking", context);
}

const ARTIFACT_FILES = Object.freeze([
  Object.freeze(["diagrams/diagram1_universal.html", "process"]),
  Object.freeze(["diagrams/diagram2_ariba.html", "ariba-map"]),
  Object.freeze(["diagrams/diagram3_maturity.html", "maturity"]),
  Object.freeze(["diagrams/infographic.html", "infographic"]),
  Object.freeze(["infographic_procurement_2026_EN.html", "infographic"])
]);
const ARTIFACT_COMMON_DISCLAIMER = "This is a conceptual procurement operating model. Capability descriptions and scores are illustrative target-state assumptions, not claims about current product availability, legal compliance or a measured organisation.";
const ARTIFACT_PRODUCT_DISCLAIMER = "Product names are model labels. Verify availability, scope and licensing for the relevant SAP landscape.";
const ARTIFACT_TOOLBAR_LABEL = "Back to the Polish Procurement 2026 page";
const ARTIFACT_FAVICON_PATH = "/favicon.svg";
const ARTIFACT_HEADINGS = Object.freeze({
  "diagrams/diagram1_universal.html": "Procurement process reference model",
  "diagrams/diagram2_ariba.html": "Conceptual SAP procurement map",
  "diagrams/diagram3_maturity.html": "Editable procurement maturity scenario",
  "diagrams/infographic.html": "Procurement process: reference model and scenario lenses",
  "infographic_procurement_2026_EN.html": "Procurement process: reference model and scenario lenses"
});
const ARTIFACT_SEMANTIC_COPY = Object.freeze({
  "diagrams/diagram1_universal.html": {
    titles: ["Procurement process reference model"],
    kickers: ["Reference model", "Decision index"],
    headings: [["h1", "Procurement process reference model"], ["h2", "Explore fifteen logical records"]],
    captions: [["figcaption", "The geometry groups a real sequence and optional lenses. Labels, state and descriptions are repeated in the adjacent control index."]],
    prose: [],
    svgText: [
      ["title", "Grouped procurement process geometry"],
      ["desc", "Strategic steps occupy the upper route, operational steps occupy the lower route, and scenario lenses surround the sequence. The adjacent fifteen-button index provides the full text alternative and keyboard controls."],
      ["text", "PROCUREMENT"], ["text", "REFERENCE"], ["text", "SELECT A RECORD"],
      ["text", "STRATEGIC SEQUENCE"], ["text", "OPERATIONAL SEQUENCE"]
    ],
    tableText: []
  },
  "diagrams/diagram2_ariba.html": {
    titles: ["Conceptual SAP procurement map"],
    kickers: ["Workshop vocabulary"],
    headings: [["h1", "Conceptual SAP procurement map"], ["h2", "Strategic sequence"], ["h2", "Operational sequence"], ["h2", "Scenario lenses"]],
    captions: [],
    prose: [
      "Five ordered decision areas before operational buying.",
      "Five ordered areas from stated need to invoice and payment decisions.",
      "Five cross-process questions that require implementation-specific validation."
    ],
    svgText: [],
    tableText: []
  },
  "diagrams/diagram3_maturity.html": {
    titles: ["Editable procurement maturity scenario"],
    kickers: ["Editable example"],
    headings: [["h1", "Editable procurement maturity scenario"], ["h2", "Scenario score"], ["h3", "Largest scenario gaps"]],
    captions: [],
    prose: ["Scale: 1 initial, 2 developing, 3 defined, 4 managed, 5 optimised for this illustrative scenario."],
    svgText: [],
    tableText: []
  },
  "diagrams/infographic.html": {
    titles: ["Procurement process reference model and scenario lenses"],
    kickers: ["Reference and scenario"],
    headings: [["h1", "Procurement process: reference model and scenario lenses"], ["h2", "Reference model"], ["h2", "Illustrative target-state scenario"], ["h2", "Model boundaries"]],
    captions: [["caption", "Scenario lenses to validate"]],
    prose: [
      "The sequence names seven handoffs. It does not prescribe a system, automation level or control design.",
      "Use the comparison as an agenda for validation, not as a product or compliance statement."
    ],
    svgText: [],
    tableText: [
      ["th", "Lens"], ["th", "Reference model"], ["th", "Illustrative target-state scenario"],
      ["th", "Decision boundary"], ["td", "Named process stage and ownership question"], ["td", "Decision rights, exceptions and escalation to define"],
      ["th", "Control boundary"], ["td", "Inputs and handoffs to define"], ["td", "Data, automation, control and evidence choices"]
    ]
  },
  "infographic_procurement_2026_EN.html": {
    titles: ["Procurement process reference model and scenario lenses"],
    kickers: ["Reference and scenario"],
    headings: [["h1", "Procurement process: reference model and scenario lenses"], ["h2", "Reference model"], ["h2", "Illustrative target-state scenario"], ["h2", "Model boundaries"]],
    captions: [["caption", "Scenario lenses to validate"]],
    prose: [
      "The sequence names seven handoffs. It does not prescribe a system, automation level or control design.",
      "Use the comparison as an agenda for validation, not as a product or compliance statement."
    ],
    svgText: [],
    tableText: [
      ["th", "Lens"], ["th", "Reference model"], ["th", "Illustrative target-state scenario"],
      ["th", "Decision boundary"], ["td", "Named process stage and ownership question"], ["td", "Decision rights, exceptions and escalation to define"],
      ["th", "Control boundary"], ["td", "Inputs and handoffs to define"], ["td", "Data, automation, control and evidence choices"]
    ]
  }
});
const ARTIFACT_LEADS = Object.freeze({
  "diagrams/diagram1_universal.html": "A workshop view of strategic and operational steps with five scenario lenses. Select a labelled record to inspect its decision boundary.",
  "diagrams/diagram2_ariba.html": "A static vocabulary for discussing a landscape. Each placement is a workshop hypothesis to verify for the organisation, not an implementation bill of materials or portfolio snapshot.",
  "diagrams/diagram3_maturity.html": "Change either side of each dimension to discuss a hypothetical baseline and target. The values do not describe an organisation.",
  "diagrams/infographic.html": "A compact workshop sheet for separating a process sequence from the choices made for a particular operating model.",
  "infographic_procurement_2026_EN.html": "A compact workshop sheet for separating a process sequence from the choices made for a particular operating model."
});
const ARTIFACT_TOKENS = Object.freeze({
  "--artifact-bg": "#102831",
  "--artifact-panel": "#193D49",
  "--artifact-paper": "#E9EDEF",
  "--artifact-line": "#8E9CA1",
  "--artifact-signal": "#D94B2B"
});
const ARTIFACT_FONT_PATHS = new Set([
  "/assets/fonts/barlow-semi-condensed-latin-600-normal.woff2",
  "/assets/fonts/dmsans-latin.woff2",
  "/assets/fonts/dmmono-latin.woff2"
]);
const ARTIFACT_INLINE_SCRIPT_HASHES = Object.freeze({
  "diagrams/diagram1_universal.html": Object.freeze(["b2f9c2b8cb795bb4f09d7a4ba7772a03bba263047d88d2ab8d11f1538ba7ef02"]),
  "diagrams/diagram2_ariba.html": Object.freeze([]),
  "diagrams/diagram3_maturity.html": Object.freeze(["9fa92ccde0dc26f042889289a609bd0ccaac9bfcad6ec2d0e78f34ca4f0de3b3"]),
  "diagrams/infographic.html": Object.freeze([]),
  "infographic_procurement_2026_EN.html": Object.freeze([])
});
const PROCESS_RECORDS = Object.freeze([
  Object.freeze(["s1", "Procurement Planning", "Strategic sequence", "Demand, budget assumptions, timing and decision ownership."]),
  Object.freeze(["s2", "Market Analysis", "Strategic sequence", "Selected supplier-market, price, capacity and supply-risk inputs."]),
  Object.freeze(["s3", "Category Strategy Definition", "Strategic sequence", "Spend, supplier, risk and sustainability inputs connected to category choices."]),
  Object.freeze(["s4", "Sourcing & Supplier Appraisal", "Strategic sequence", "Evaluation criteria, qualification steps, decision rights and sourcing-event controls."]),
  Object.freeze(["s5", "Contracting & Implementation", "Strategic sequence", "Clauses, obligations, controls, ownership and transition into operation."]),
  Object.freeze(["o1", "Product or Service Identification", "Operational sequence", "Routing a stated need toward approved channels, catalogues or suppliers."]),
  Object.freeze(["o2", "Purchase Requisition & Authorization", "Operational sequence", "Request data, budget checks, routing and approval responsibility."]),
  Object.freeze(["o3", "Purchase Order", "Operational sequence", "Converting an approved request into an order and handling changes and acknowledgements."]),
  Object.freeze(["o4", "Order Delivery Monitoring", "Operational sequence", "Delivery, acceptance, exceptions and escalation ownership."]),
  Object.freeze(["o5", "Invoicing & Payment", "Operational sequence", "Matching, exceptions, approval, payment terms and financing options."]),
  Object.freeze(["ai-orch", "AI & Orchestration", "Scenario lens", "An optional scenario layer whose automation scope and human oversight must be defined per implementation."]),
  Object.freeze(["risk", "Risk & Resilience", "Scenario lens", "Inputs, thresholds, controls and escalation paths."]),
  Object.freeze(["esg", "ESG & Sustainability", "Scenario lens", "Sustainability data and decisions; legal applicability and evidence requirements require separate validation."]),
  Object.freeze(["data", "Data & Analytics", "Scenario lens", "Ownership, quality, lineage and reporting."]),
  Object.freeze(["srm", "Supplier Relationship Management", "Scenario lens", "Supplier segmentation, governance, performance and collaboration."])
]);
const PROCESS_GEOMETRY_ORDER = Object.freeze([
  "ai-orch", "risk", "esg", "esg", "risk",
  "s1", "s2", "s3", "s4", "s5",
  "o1", "o2", "o3", "o4", "o5",
  "ai-orch", "risk", "esg", "data", "srm"
]);
const ARIBA_GROUPS = Object.freeze([
  Object.freeze(["strategic", Object.freeze(["1", "2", "3", "4", "5"])]),
  Object.freeze(["operational", Object.freeze(["6", "7", "8", "9", "10"])]),
  Object.freeze(["lenses", Object.freeze(["AI", "R", "E", "D", "S"])])
]);
const ARIBA_EXPECTED_VOCABULARY = Object.freeze({
  s1: Object.freeze(["SAP S/4HANA", "Organisation-specific data"]),
  s2: Object.freeze(["External market inputs", "Organisation-specific data"]),
  s3: Object.freeze(["SAP Ariba Strategic Sourcing Suite"]),
  s4: Object.freeze(["SAP Ariba Sourcing", "SAP Ariba Supplier Lifecycle and Performance", "SAP Ariba Supplier Risk"]),
  s5: Object.freeze(["SAP Ariba Contracts", "Implementation-specific controls"]),
  o1: Object.freeze(["SAP Ariba Buying and Invoicing", "guided buying", "catalogues"]),
  o2: Object.freeze(["SAP Ariba Buying and Invoicing", "approval workflows", "budget checks"]),
  o3: Object.freeze(["SAP Ariba Buying and Invoicing", "SAP Business Network for Procurement"]),
  o4: Object.freeze(["SAP Business Network for Procurement", "network-based collaboration", "Integration decision"]),
  o5: Object.freeze(["SAP Ariba Buying and Invoicing", "invoice management"]),
  "ai-orch": Object.freeze(["Implementation-specific controls", "Organisation-specific data"]),
  risk: Object.freeze(["SAP Ariba Supplier Risk", "External market inputs"]),
  esg: Object.freeze(["Organisation-specific data", "Implementation-specific controls"]),
  data: Object.freeze(["SAP S/4HANA", "Organisation-specific data"]),
  srm: Object.freeze(["SAP Ariba Supplier Lifecycle and Performance", "SAP Business Network for Procurement"])
});
const ARIBA_PRODUCT_NAMES = new Set([
  "SAP Ariba Strategic Sourcing Suite", "SAP Ariba Sourcing", "SAP Ariba Contracts",
  "SAP Ariba Supplier Lifecycle and Performance", "SAP Ariba Supplier Risk",
  "SAP Ariba Buying and Invoicing", "SAP Business Network for Procurement",
  "SAP S/4HANA", "SAP Fieldglass"
]);
const ARIBA_FEATURE_LABELS = new Set([
  "guided buying", "catalogues", "invoice management", "network-based collaboration",
  "approval workflows", "budget checks"
]);
const ARIBA_NEUTRAL_LABELS = new Set([
  "Organisation-specific data", "Implementation-specific controls", "External market inputs", "Integration decision"
]);
const ARIBA_WORKSHOP_QUESTIONS = Object.freeze([
  "Workshop question: which planning inputs and ownership rules belong in the landscape?",
  "Workshop question: which market and internal inputs support the analysis?",
  "Workshop question: which suite scope supports the chosen category workflow?",
  "Workshop question: which sourcing, lifecycle and risk labels require landscape validation?",
  "Workshop question: how are contract records and implementation controls divided?",
  "Workshop question: which channels and catalogue rules guide a stated need?",
  "Workshop question: which workflow and budget controls apply to a request?",
  "Workshop question: where do order records and network exchanges sit?",
  "Workshop question: which exchanges, acknowledgements and integrations are in scope?",
  "Workshop question: which invoice decisions and exceptions are represented?",
  "Workshop question: where is automation appropriate and where is human oversight required?",
  "Workshop question: which internal and external signals enter the risk workflow?",
  "Workshop question: which evidence, applicability decisions and controls are required?",
  "Workshop question: which source owns each data object and reporting rule?",
  "Workshop question: which governance and collaboration records belong in the landscape?"
]);
const MATURITY_DIMENSIONS = Object.freeze([
  Object.freeze(["ai", "AI & Orchestration", 1, 4]),
  Object.freeze(["risk", "Risk & Resilience", 1, 4]),
  Object.freeze(["esg", "ESG / Sustainability", 1, 3]),
  Object.freeze(["data", "Data & Analytics", 2, 4]),
  Object.freeze(["srm", "Supplier Relationship Management", 2, 4]),
  Object.freeze(["strat", "Strategic Procurement", 3, 5]),
  Object.freeze(["oper", "Operational Procurement", 3, 5]),
  Object.freeze(["integ", "Platform Integration", 2, 5])
]);
const INFOGRAPHIC_STAGES = Object.freeze([
  Object.freeze(["needs", "Needs Definition"]),
  Object.freeze(["supplier", "Supplier Selection"]),
  Object.freeze(["order", "Order"]),
  Object.freeze(["receipt", "Goods Receipt"]),
  Object.freeze(["invoicing", "Invoicing"]),
  Object.freeze(["matching", "Matching"]),
  Object.freeze(["payment", "Payment"])
]);
const INFOGRAPHIC_NOTES = Object.freeze([
  "People and decision rights remain explicit.",
  "Data, automation and controls are implementation choices.",
  "Legal applicability and evidence requirements require separate validation."
]);

// Tag and attribute totals are a structural tripwire in addition to the
// behavior-specific contracts below. Values are filled from the reviewed
// implementation, never derived from a mutable digest.
const ARTIFACT_CENSUS = Object.freeze({
  "diagrams/diagram1_universal.html": Object.freeze({ elements: 74, tags: Object.freeze({ a: 1, body: 1, button: 15, circle: 7, desc: 1, div: 2, figcaption: 1, figure: 1, h1: 1, h2: 2, head: 1, header: 2, html: 1, link: 1, main: 1, meta: 2, nav: 1, p: 6, path: 14, rect: 1, script: 1, section: 2, style: 1, svg: 1, text: 5, title: 2 }), attributes: Object.freeze({ "aria-controls": 15, "aria-label": 2, "aria-labelledby": 4, "aria-live": 1, "aria-pressed": 15, charset: 1, class: 55, content: 1, cx: 7, cy: 7, d: 14, "data-artifact": 1, "data-description": 15, "data-record-id": 35, "data-record-kind": 15, fill: 22, height: 1, href: 2, id: 6, lang: 1, name: 1, r: 7, rel: 1, role: 2, stroke: 22, "stroke-width": 22, target: 1, "text-anchor": 5, type: 16, viewbox: 1, width: 1, x: 6, xmlns: 1, y: 6 }) }),
  "diagrams/diagram2_ariba.html": Object.freeze({ elements: 156, tags: Object.freeze({ a: 1, article: 15, body: 1, div: 19, h1: 1, h2: 3, h3: 15, head: 1, header: 4, html: 1, li: 33, link: 1, main: 1, meta: 2, nav: 1, p: 37, section: 3, style: 1, title: 1, ul: 15 }), attributes: Object.freeze({ "aria-label": 1, charset: 1, class: 110, content: 1, "data-artifact": 1, "data-feature-label": 6, "data-map-group": 3, "data-marker": 15, "data-model-label": 11, "data-product-name": 16, "data-record-id": 15, href: 2, lang: 1, name: 1, rel: 1, target: 1, type: 1 }) }),
  "diagrams/diagram3_maturity.html": Object.freeze({ elements: 292, tags: Object.freeze({ a: 1, body: 1, dd: 5, div: 22, dl: 1, dt: 5, fieldset: 16, form: 1, h1: 1, h2: 9, h3: 1, head: 1, header: 1, html: 1, input: 80, label: 80, legend: 16, li: 4, link: 1, main: 1, meta: 2, nav: 1, ol: 1, output: 8, p: 12, script: 1, section: 9, span: 8, style: 1, title: 1 }), attributes: Object.freeze({ "aria-label": 2, "aria-labelledby": 1, "aria-live": 1, charset: 1, checked: 16, class: 130, content: 1, "data-artifact": 1, "data-baseline": 8, "data-dimension": 8, "data-side": 16, "data-target": 8, for: 80, href: 2, id: 87, lang: 1, name: 81, rel: 1, target: 1, type: 81, value: 80 }) }),
  "diagrams/infographic.html": Object.freeze({ elements: 52, tags: Object.freeze({ a: 1, body: 1, caption: 1, h1: 1, h2: 3, head: 1, header: 1, html: 1, li: 10, link: 1, main: 1, meta: 2, nav: 1, ol: 1, p: 5, section: 3, style: 1, table: 1, tbody: 1, td: 4, th: 5, thead: 1, title: 1, tr: 3, ul: 1 }), attributes: Object.freeze({ "aria-label": 2, "aria-labelledby": 3, charset: 1, class: 21, content: 1, "data-artifact": 1, "data-stage": 7, href: 2, id: 3, lang: 1, name: 1, rel: 1, scope: 5, target: 1, type: 1 }) }),
  "infographic_procurement_2026_EN.html": Object.freeze({ elements: 52, tags: Object.freeze({ a: 1, body: 1, caption: 1, h1: 1, h2: 3, head: 1, header: 1, html: 1, li: 10, link: 1, main: 1, meta: 2, nav: 1, ol: 1, p: 5, section: 3, style: 1, table: 1, tbody: 1, td: 4, th: 5, thead: 1, title: 1, tr: 3, ul: 1 }), attributes: Object.freeze({ "aria-label": 2, "aria-labelledby": 3, charset: 1, class: 21, content: 1, "data-artifact": 1, "data-stage": 7, href: 2, id: 3, lang: 1, name: 1, rel: 1, scope: 5, target: 1, type: 1 }) })
});

function artifactCensus(parsedRoot) {
  const tags = new Map();
  const attributes = new Map();
  const elements = elementDescendants(parsedRoot);
  for (const element of elements) {
    tags.set(element.name, (tags.get(element.name) ?? 0) + 1);
    for (const name of element.attributes.keys()) attributes.set(name, (attributes.get(name) ?? 0) + 1);
  }
  return Object.freeze({
    elements: elements.length,
    tags: Object.freeze(Object.fromEntries([...tags].sort())),
    attributes: Object.freeze(Object.fromEntries([...attributes].sort()))
  });
}

function artifactSourceCorpus(html) {
  return normalizeExactHtmlLiteral(decodeHtmlEntities(html))
    .replace(/\p{Default_Ignorable_Code_Point}+/gu, "")
    .toLocaleLowerCase("en-US");
}

function verifyArtifactClaimBoundary(path, html, parsedRoot, errors) {
  const sourceVariants = [
    artifactSourceCorpus(html),
    artifactSourceCorpus(html.replace(/<!--[\s\S]*?-->/g, ""))
  ];
  const compacts = sourceVariants.map((source) => source.replace(/[^a-z0-9%+>]+/g, ""));
  const forbidden = [
    "reality2026", "asof2026", "newlayers2026", "target2027", "currentreadiness",
    "90%+", ">90%", "fullcsrdcsdddautomation", "everytransaction",
    "autonomouslymanage", "mostprocurementorganizations", "sapgoldpartner",
    "apsolutgroup", "allforonegroup", "warsawflightsafety", "polpharma",
    "autonomousrfx", "autonomousbidevaluation", "autonomouscontractnegotiation",
    "automaticlegalcompliance", "automaticregulatorycompliance", "guaranteedlegalcompliance",
    "guaranteedregulatorycompliance", "complianceautomation", "realtimeprediction",
    "realtimepredictive", "digitaltwin", "touchlessrate"
  ];
  if (forbidden.some((claim) => compacts.some((compact) => compact.includes(claim)))) {
    error(errors, "artifact-claims", path, "contains an unsupported current-state, capability, partner, compliance or performance claim");
  }
  const visible = publishedStaticText(htmlBodyRoot(parsedRoot));
  const percentages = [...visible.matchAll(/\b\d+(?:\.\d+)?\s*%/g)].map((match) => match[0].replace(/\s+/g, ""));
  const expectedPercentages = path === "diagrams/diagram3_maturity.html" ? ["38%"] : [];
  if (JSON.stringify(percentages) !== JSON.stringify(expectedPercentages)) {
    error(errors, "artifact-claims", path, "allows only the exact baseline percentage derived by the illustrative maturity model");
  }
  const visibleWithoutDisclaimer = normalizeExactLiteral(visible.replace(ARTIFACT_COMMON_DISCLAIMER, ""));
  if (visibleWithoutDisclaimer.includes("—")
    || /\b(?:best|leading|ultimate|most)\b/i.test(visibleWithoutDisclaimer)
    || /\bcurrent\b/i.test(visibleWithoutDisclaimer)
    || elementDescendants(parsedRoot).some((element) => /(?:^|\s)(?:badge|status)(?:\s|$)/i.test(elementAttribute(element, "class") ?? ""))) {
    error(errors, "artifact-claims", path, "forbids decorative em dash, superlatives, unqualified current-state wording and status badges");
  }
}

async function verifyArtifactResources(path, html, parsedRoot, styleText, context) {
  const all = elementDescendants(parsedRoot);
  const forbiddenTags = new Set([
    "applet", "audio", "base", "embed", "frame", "frameset", "iframe", "img",
    "object", "picture", "portal", "source", "track", "video"
  ]);
  const resourceAttributes = new Set(["action", "background", "cite", "data", "formaction", "manifest", "ping", "poster", "profile", "src", "srcdoc", "srcset", "usemap", "xlink:href"]);
  const exactFavicon = (element) => exactActiveLink(element, { rel: "icon", type: "image/svg+xml", href: ARTIFACT_FAVICON_PATH });
  const invalidResource = all.some((element) => forbiddenTags.has(element.name)
    || [...element.attributes].some(([name, value]) => resourceAttributes.has(name) && nonEmptyString(value))
    || (element.name !== "a" && !exactFavicon(element) && element.attributes.has("href"))
    || (element.name === "link" && !exactFavicon(element))
    || (element.name === "script" && element.attributes.has("src")));
  const cssUrls = [...styleText.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi)].map((match) => decodeCssEscapes(match[2].trim()));
  const invalidCss = /@import\b/i.test(styleText)
    || cssUrls.some((url) => !ARTIFACT_FONT_PATHS.has(url))
    || /(?:https?:)?\/\//i.test(styleText)
    || /data\s*:/i.test(styleText);
  const scriptText = all.filter((element) => element.name === "script").map((script) => rawElementText(script)).join("\n");
  const scriptHashes = all.filter((element) => element.name === "script")
    .map((script) => createHash("sha256").update(rawElementText(script)).digest("hex"));
  const ownsInlineScripts = JSON.stringify(scriptHashes) === JSON.stringify(ARTIFACT_INLINE_SCRIPT_HASHES[path]);
  const normalizedScriptMembers = scriptText.replace(/\[\s*(["'`])([a-z_$][\w$]*)\1\s*\]/gi, ".$2");
  const invalidDynamicScript = /(?:document\s*\.\s*)?createElement\s*\(\s*(["'`])(?:script|iframe|object|embed|img|link|source)\1\s*\)/i.test(normalizedScriptMembers)
    || /["'`](?:https?:)?\/\//i.test(normalizedScriptMembers);
  if (invalidResource || invalidCss || invalidDynamicScript || !ownsInlineScripts || /<\s*(?:iframe|embed|object)\b/i.test(html)) {
    error(context.errors, "artifact-resource", path, "allows only the three approved local WOFF2 font requests, exact per-path inline scripts, the exact local favicon and the parent return link");
  }
  for (const fontPath of new Set(cssUrls)) {
    try {
      const file = await stat(resolve(context.root, routeToFile(fontPath)));
      if (!file.isFile()) throw Object.assign(new Error("font target is not a file"), { code: "NOT_FILE" });
    } catch (cause) {
      error(context.errors, "artifact-resource", path, `${fontPath} is missing (${cause.code ?? cause.message})`);
    }
  }
  try {
    const favicon = await stat(resolve(context.root, routeToFile(ARTIFACT_FAVICON_PATH)));
    if (!favicon.isFile()) throw Object.assign(new Error("favicon target is not a file"), { code: "NOT_FILE" });
  } catch (cause) {
    error(context.errors, "artifact-favicon", path, `${ARTIFACT_FAVICON_PATH} is missing (${cause.code ?? cause.message})`);
  }
}

function decodedArtifactCssDeclarations(rule) {
  return [...rule.declarations].map(([property, value]) => [
    normalize(decodeCssEscapes(property)),
    normalize(decodeCssEscapes(value)).replace(/\s*!\s*important\s*$/, "")
  ]);
}

function artifactCssOpeningBrace(source, start = 0) {
  let quote = null;
  let escaped = false;
  let parentheses = 0;
  let brackets = 0;
  for (let index = start; index < source.length; index += 1) {
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
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "(") parentheses += 1;
    else if (character === ")" && parentheses > 0) parentheses -= 1;
    else if (character === "[") brackets += 1;
    else if (character === "]" && brackets > 0) brackets -= 1;
    else if (character === "{" && parentheses === 0 && brackets === 0) return index;
  }
  return -1;
}

function artifactCssDeclarationBlockIsValid(body) {
  if (artifactCssOpeningBrace(body) !== -1) return false;
  for (const candidate of splitCssTopLevel(body, ";")) {
    if (candidate.trim() === "") continue;
    const colon = cssDelimiterIndex(candidate, ":");
    if (colon <= 0 || candidate.slice(colon + 1).trim() === "") return false;
    const property = decodeCssEscapesChecked(candidate.slice(0, colon));
    const value = decodeCssEscapesChecked(candidate.slice(colon + 1));
    if (property.malformedEscapeAt !== -1 || property.unterminatedQuoteAt !== -1
      || value.malformedEscapeAt !== -1 || value.unterminatedQuoteAt !== -1) return false;
  }
  return true;
}

function parseArtifactCssStylesheet(source) {
  const commentScan = stripCssComments(source);
  const rules = [];
  if (commentScan.unterminatedCommentAt !== -1 || !cssStructureIsBalanced(source)) return { valid: false, rules };

  const walk = (block, media = [], groupingDepth = 0) => {
    let cursor = 0;
    while (cursor < block.length) {
      while (/\s/.test(block[cursor] ?? "")) cursor += 1;
      if (cursor === block.length) return true;
      const opening = artifactCssOpeningBrace(block, cursor);
      if (opening === -1) return block.slice(cursor).trim() === "";
      const prelude = block.slice(cursor, opening).trim();
      const closing = matchingBrace(block, opening);
      if (prelude === "" || closing === -1 || cssDelimiterIndex(prelude, ";") !== -1) return false;
      const decodedPrelude = decodeCssEscapesChecked(prelude);
      if (decodedPrelude.malformedEscapeAt !== -1 || decodedPrelude.unterminatedQuoteAt !== -1) return false;
      const normalizedPrelude = decodedPrelude.decoded.replace(/\s+/g, " ").trim();
      const body = block.slice(opening + 1, closing);
      if (normalizedPrelude.startsWith("@")) {
        const match = /^@([a-z-]+)(?=\s|\(|$)/i.exec(normalizedPrelude);
        if (match === null) return false;
        const name = match[1].toLowerCase();
        if (name === "media" || name === "supports") {
          const nestedMedia = name === "media" ? [...media, normalizedPrelude] : media;
          if (!walk(body, nestedMedia, groupingDepth + 1)) return false;
        } else if (name === "font-face" && groupingDepth === 0 && artifactCssDeclarationBlockIsValid(body)) {
          rules.push({ prelude: normalizedPrelude, selectors: [], declarations: parseDeclarations(body), media });
        } else {
          return false;
        }
      } else {
        if (!artifactCssDeclarationBlockIsValid(body)) return false;
        const selectors = splitCssTopLevel(prelude, ",").map((selector) => selector.trim().replace(/\s+/g, " ")).filter(Boolean);
        if (selectors.length === 0 || selectors.some((selector) => selector.startsWith("@"))) return false;
        rules.push({ prelude: normalizedPrelude, selectors, declarations: parseDeclarations(body), media });
      }
      cursor = closing + 1;
    }
    return true;
  };

  return { valid: walk(commentScan.css), rules };
}

function verifyArtifactStylesheetVisibility(path, rules, errors) {
  const visibleDisplayValues = new Set(["block", "flex", "grid", "inline-flex"]);
  const preservesVisibility = (property, value) => {
    if (property === "display") return visibleDisplayValues.has(value);
    if (property === "visibility") return value === "visible";
    if (property === "content-visibility") return new Set(["auto", "visible"]).has(value);
    if (property === "opacity") {
      const literal = /^(\d+(?:\.\d+)?|\.\d+)(%)?$/.exec(value);
      if (literal === null) return false;
      const amount = Number.parseFloat(literal[1]);
      return Number.isFinite(amount) && amount > 0 && amount <= (literal[2] ? 100 : 1);
    }
    return true;
  };
  const hiddenOrUnreviewable = rules.some((rule) => {
    const declarations = decodedArtifactCssDeclarations(rule);
    return declarations.some(([property, value]) => !preservesVisibility(property, value));
  });
  if (hiddenOrUnreviewable) error(errors, "artifact-visibility", path, "forbids hidden or unreviewable visibility-sensitive declarations in artifact styles");
}

function verifyArtifactSafety(path, html, parsedRoot, styleText, errors) {
  const all = elementDescendants(parsedRoot);
  const duplicateAttributes = all.some((element) => (element.attributes.sourceAttributeCount ?? element.attributes.size) !== element.attributes.size);
  const ids = all.map((element) => elementAttribute(element, "id")).filter(nonEmptyString);
  const unsafeElement = all.some((element) => element.attributes.has("style")
    || element.attributes.has("hidden")
    || element.attributes.has("inert")
    || normalize(elementAttribute(element, "aria-hidden") ?? "") === "true"
    || [...element.attributes.keys()].some((name) => /^on/i.test(name)));
  const unsafeSource = /\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\s*\.\s*write|eval|DOMParser|createContextualFragment)\b/i.test(decodeHtmlEntities(html));
  const unsafeCss = /(?:linear|radial|conic)-gradient\s*\(|text-shadow\s*:|box-shadow\s*:|drop-shadow\s*\(|backdrop-filter\s*:|filter\s*:|blur\s*\(|@keyframes\b|animation\s*:|:hover[^{}]*\{[^{}]*transform\s*:[^{}]*(?:scale|translate)/is.test(styleText);
  if (duplicateAttributes || new Set(ids).size !== ids.length || unsafeElement || unsafeSource || unsafeCss) {
    error(errors, "artifact-safety", path, "forbids duplicate IDs/attributes, hidden decoys, inline behavior/style, unsafe DOM sinks and prohibited visual effects");
  }
}

function verifyArtifactSemanticCopy(path, all, head, errors) {
  const modelContainers = all.filter((element) => ["process-detail", "model-cell", "maturity-dimension"]
    .some((className) => elementHasClass(element, className)));
  const belongsToOwnedModel = (element) => modelContainers.some((container) => elementIsWithin(element, container));
  const headings = all.filter((element) => new Set(["h1", "h2", "h3"]).has(element.name) && !belongsToOwnedModel(element))
    .map((element) => [element.name, publishedStaticText(element)]);
  const excludedProseClasses = ["artifact-kicker", "artifact-lead", "artifact-disclaimer", "artifact-product-disclaimer"];
  const svgElements = all.filter((element) => element.name === "svg");
  const actual = {
    titles: head ? directElementChildren(head, "title").map((element) => publishedStaticText(element)) : [],
    kickers: all.filter((element) => element.name === "p" && elementHasClass(element, "artifact-kicker")).map((element) => publishedStaticText(element)),
    headings,
    captions: all.filter((element) => new Set(["figcaption", "caption"]).has(element.name)).map((element) => [element.name, publishedStaticText(element)]),
    prose: all.filter((element) => element.name === "p"
      && !belongsToOwnedModel(element)
      && !excludedProseClasses.some((className) => elementHasClass(element, className)))
      .map((element) => publishedStaticText(element)),
    svgText: all.filter((element) => new Set(["title", "desc", "text"]).has(element.name)
      && svgElements.some((svg) => elementIsWithin(element, svg)))
      .map((element) => [element.name, publishedStaticText(element)]),
    tableText: all.filter((element) => new Set(["th", "td"]).has(element.name)).map((element) => [element.name, publishedStaticText(element)])
  };
  if (JSON.stringify(actual) !== JSON.stringify(ARTIFACT_SEMANTIC_COPY[path])) {
    error(errors, "artifact-copy-manifest", path, "requires the exact reviewed non-model semantic copy for this artifact path");
  }
}

function verifyArtifactShared(path, html, expectedArtifact, context) {
  const parsed = parseStaticHtml(html);
  for (const syntaxError of parsed.errors) error(context.errors, "artifact-html", path, syntaxError);
  const root = parsed.root;
  const all = elementDescendants(root);
  const htmlElements = directElementChildren(root, "html");
  const htmlElement = htmlElements[0];
  const heads = htmlElement ? directElementChildren(htmlElement, "head") : [];
  const bodies = htmlElement ? directElementChildren(htmlElement, "body") : [];
  const head = heads[0];
  const body = bodies[0];
  const titles = head ? directElementChildren(head, "title") : [];
  const meta = head ? directElementChildren(head, "meta") : [];
  const charset = meta.filter((item) => normalize(elementAttribute(item, "charset") ?? "") === "utf-8");
  const viewport = meta.filter((item) => normalize(elementAttribute(item, "name") ?? "") === "viewport"
    && normalizeExactLiteral(elementAttribute(item, "content") ?? "") === "width=device-width, initial-scale=1.0");
  const h1s = all.filter((element) => element.name === "h1" && pageElementIsActive(element));
  if (!/^\s*<!doctype\s+html>/i.test(html)
    || htmlElements.length !== 1 || elementAttribute(htmlElement, "lang") !== "en"
    || heads.length !== 1 || bodies.length !== 1
    || titles.length !== 1 || !nonEmptyString(publishedStaticText(titles[0]))
    || charset.length !== 1 || viewport.length !== 1 || meta.length !== 2
    || h1s.length !== 1 || !nonEmptyString(publishedStaticText(h1s[0]))) {
    error(context.errors, "artifact-document", path, "requires one complete English HTML5 document, title, viewport and visible h1");
  }
  if (h1s.length !== 1 || publishedStaticText(h1s[0]) !== ARTIFACT_HEADINGS[path]) {
    error(context.errors, "artifact-heading", path, "requires the exact reviewed artifact h1 for this path");
  }
  if (!body || elementAttribute(body, "data-artifact") !== expectedArtifact
    || all.filter((element) => element.attributes.has("data-artifact")).length !== 1) {
    error(context.errors, "artifact-manifest", path, `body must be the sole data-artifact owner with value ${expectedArtifact}`);
  }
  const faviconLinks = head ? directElementChildren(head, "link") : [];
  const allLinks = all.filter((element) => element.name === "link");
  if (faviconLinks.length !== 1 || allLinks.length !== 1
    || !exactActiveLink(faviconLinks[0], { rel: "icon", type: "image/svg+xml", href: ARTIFACT_FAVICON_PATH })) {
    error(context.errors, "artifact-favicon", path, "requires exactly one active local SVG favicon declaration in head");
  }
  const toolbars = all.filter((element) => element.name === "nav" && elementHasClass(element, "artifact-toolbar") && pageElementIsActive(element));
  const links = toolbars.length === 1 ? directElementChildren(toolbars[0], "a").filter(pageElementIsActive) : [];
  const allAnchors = all.filter((element) => element.name === "a");
  if (toolbars.length !== 1
    || !exactElementAttributes(toolbars[0], { class: "artifact-toolbar", "aria-label": "Artifact navigation" })
    || links.length !== 1 || allAnchors.length !== 1
    || !exactElementAttributes(links[0], { href: "/procurement-2026/", target: "_top" })
    || publishedStaticText(links[0]) !== ARTIFACT_TOOLBAR_LABEL) {
    error(context.errors, "artifact-toolbar", path, "requires one visible exact return toolbar and honest Polish-parent label");
  }
  const disclaimers = all.filter((element) => elementHasClass(element, "artifact-disclaimer") && pageElementIsActive(element));
  if (disclaimers.length !== 1 || publishedStaticText(disclaimers[0]) !== ARTIFACT_COMMON_DISCLAIMER) {
    error(context.errors, "artifact-disclaimer", path, "requires the exact visible conceptual-model disclaimer once");
  }
  const styles = head ? directElementChildren(head, "style") : [];
  const styleText = styles.length === 1 ? rawElementText(styles[0]) : "";
  const stylesheet = parseArtifactCssStylesheet(styleText);
  const rules = stylesheet.rules;
  if (styles.length !== 1 || !stylesheet.valid
    || Object.entries(ARTIFACT_TOKENS).some(([property, value]) => propertyValue(rules, ":root", property) !== value)) {
    error(context.errors, "artifact-style", path, "requires reviewed fail-closed local CSS structure and the exact five Flight Plan artifact tokens");
  }
  const leads = all.filter((element) => elementHasClass(element, "artifact-lead") && pageElementIsActive(element));
  if (leads.length !== 1 || publishedStaticText(leads[0]) !== ARTIFACT_LEADS[path]) {
    error(context.errors, "artifact-copy", path, "requires the exact reviewed claim-safe artifact lead");
  }
  verifyArtifactSemanticCopy(path, all, head, context.errors);
  verifyArtifactSafety(path, html, root, styleText, context.errors);
  verifyArtifactStylesheetVisibility(path, rules, context.errors);
  verifyArtifactClaimBoundary(path, html, root, context.errors);
  const actualCensus = artifactCensus(root);
  const expectedCensus = ARTIFACT_CENSUS[path];
  if (expectedCensus === null || JSON.stringify(actualCensus) !== JSON.stringify(expectedCensus)) {
    error(context.errors, "artifact-census", path, `requires exact structural element/tag/attribute census; actual ${JSON.stringify(actualCensus)}`);
  }
  return { root, all, head, body, styleText, rules };
}

function verifyProcessArtifact(path, artifact, errors) {
  const { all, styleText, rules } = artifact;
  const controls = all.filter((element) => element.name === "button" && elementHasClass(element, "process-control"));
  const actualRecords = controls.map((control) => [
    elementAttribute(control, "data-record-id"),
    publishedStaticText(control),
    elementAttribute(control, "data-record-kind"),
    normalizeExactHtmlLiteral(elementAttribute(control, "data-description") ?? "")
  ]);
  if (JSON.stringify(actualRecords) !== JSON.stringify(PROCESS_RECORDS)) {
    error(errors, "process-records", path, "requires the exact 15 ordered logical records and neutral descriptions");
  }
  const geometries = all.filter((element) => elementHasClass(element, "process-geometry"));
  const geometryOrder = geometries.map((element) => elementAttribute(element, "data-record-id"));
  if (JSON.stringify(geometryOrder) !== JSON.stringify(PROCESS_GEOMETRY_ORDER)
    || geometries.some((element) => !new Set(["circle", "path"]).has(element.name) || element.attributes.has("tabindex") || element.attributes.has("role"))) {
    error(errors, "process-geometry", path, "requires the exact 20 pointer geometries mapped to 15 logical records and no geometry tab stops");
  }
  const pointerDeclarationManifest = rules.flatMap((rule) => decodedArtifactCssDeclarations(rule)
    .filter(([property]) => property === "pointer-events")
    .flatMap(([, value]) => rule.selectors.map((selector) => [rule.media, selector, value])));
  const expectedPointerDeclarationManifest = [
    [[], ".process-geometry", "stroke"],
    [[], "circle.process-geometry", "visiblepainted"],
    [[], ".map-label", "none"]
  ];
  const paths = geometries.filter((element) => element.name === "path");
  const circles = geometries.filter((element) => element.name === "circle");
  const lensCircles = circles.filter((element) => elementAttribute(element, "r") === "18");
  const outerRings = circles.filter((element) => elementAttribute(element, "r") === "282");
  const hasPaintedStroke = (element) => {
    const strokeWidth = Number.parseFloat(elementAttribute(element, "stroke-width") ?? "");
    return elementAttribute(element, "stroke") !== "none" && Number.isFinite(strokeWidth) && strokeWidth > 0;
  };
  const ownsSafePointerHits = JSON.stringify(pointerDeclarationManifest) === JSON.stringify(expectedPointerDeclarationManifest)
    && propertyValue(rules, ".process-geometry", "pointer-events") === "stroke"
    && propertyValue(rules, "circle.process-geometry", "pointer-events") === "visiblePainted"
    && propertyValue(rules, ".map-label", "pointer-events") === "none"
    && paths.length === 14
    && paths.every((element) => elementAttribute(element, "fill") === "none" && hasPaintedStroke(element))
    && lensCircles.length === 5
    && lensCircles.every((element) => elementAttribute(element, "fill") === "#193D49" && hasPaintedStroke(element))
    && outerRings.length === 1
    && elementAttribute(outerRings[0], "fill") === "none"
    && hasPaintedStroke(outerRings[0])
    && geometries.every((element) => !element.attributes.has("pointer-events"));
  if (!ownsSafePointerHits) {
    error(errors, "process-pointer-hit", path, "requires stroke-only hits for open paths and visible painted fill/stroke hits for the five lens circles");
  }
  const panels = all.filter((element) => elementAttribute(element, "id") === "process-detail");
  const panelTitle = all.filter((element) => elementAttribute(element, "id") === "process-detail-title");
  const exactControls = controls.length === 15 && controls.every((control, index) => exactApplicationAttributes(control, {
    class: "process-control",
    type: "button",
    "data-record-id": PROCESS_RECORDS[index][0],
    "data-record-kind": PROCESS_RECORDS[index][2],
    "data-description": PROCESS_RECORDS[index][3],
    "aria-controls": "process-detail",
    "aria-pressed": index === 0 ? "true" : "false"
  }, new Set(["data-description"])));
  if (!exactControls || panels.length !== 1 || panelTitle.length !== 1
    || !exactElementAttributes(panels[0], { class: "process-detail", id: "process-detail", role: "region", "aria-live": "polite", "aria-labelledby": "process-detail-title" })
    || !elementIsWithin(panelTitle[0], panels[0])) {
    error(errors, "process-controls", path, "requires 15 exact logical buttons and one named polite detail region");
  }
  const scripts = all.filter((element) => element.name === "script");
  const script = scripts.length === 1 ? rawElementText(scripts[0]) : "";
  const interactionFragments = [
    'event.key !== "Enter" && event.key !== " "',
    'document.querySelectorAll(".process-geometry")',
    'document.querySelectorAll(".process-control")',
    'control.setAttribute("aria-pressed",',
    "panel.replaceChildren(",
    ".textContent ="
  ];
  if (scripts.length !== 1 || interactionFragments.some((fragment) => !script.includes(fragment))
    || !/\.addEventListener\("click"/.test(script) || !/\.addEventListener\("keydown"/.test(script)
    || !/\.process-control\s*\{[^}]*min-block-size:\s*44px;[^}]*min-inline-size:\s*44px;/s.test(styleText)) {
    error(errors, "process-interaction", path, "requires click plus Enter/Space equivalence, safe panel replacement, pressed state and 44px controls");
  }
}

function verifyAribaMapArtifact(path, artifact, errors) {
  const { all } = artifact;
  const groups = all.filter((element) => element.name === "section" && elementHasClass(element, "model-group"));
  const actualGroups = groups.map((group) => [
    elementAttribute(group, "data-map-group"),
    elementDescendants(group).filter((element) => element.name === "article" && elementHasClass(element, "model-cell")).map((cell) => elementAttribute(cell, "data-marker"))
  ]);
  const cells = groups.flatMap((group) => elementDescendants(group).filter((element) => element.name === "article" && elementHasClass(element, "model-cell")));
  const titles = cells.map((cell) => publishedStaticText(elementDescendants(cell, "h3")[0]));
  const expectedTitles = PROCESS_RECORDS.map((record) => record[1]);
  const recordIds = cells.map((cell) => elementAttribute(cell, "data-record-id"));
  if (JSON.stringify(actualGroups) !== JSON.stringify(ARIBA_GROUPS)
    || JSON.stringify(recordIds) !== JSON.stringify(PROCESS_RECORDS.map((record) => record[0]))
    || JSON.stringify(titles) !== JSON.stringify(expectedTitles)) {
    error(errors, "ariba-map-model", path, "requires the exact three groups, 15 markers, logical record order and process/lens titles");
  }
  const workshopQuestions = cells.map((cell) => {
    const questions = elementDescendants(cell).filter((element) => elementHasClass(element, "model-cell__question"));
    return questions.length === 1 ? publishedStaticText(questions[0]) : null;
  });
  if (JSON.stringify(workshopQuestions) !== JSON.stringify(ARIBA_WORKSHOP_QUESTIONS)) {
    error(errors, "ariba-map-copy", path, "requires the exact 15 reviewed workshop questions in process order");
  }
  let validVocabulary = cells.length === 15;
  for (const cell of cells) {
    const id = elementAttribute(cell, "data-record-id");
    const items = elementDescendants(cell, "li").filter((element) => elementHasClass(element, "model-vocabulary__item"));
    const labels = items.map((item) => publishedStaticText(item));
    if (JSON.stringify(labels) !== JSON.stringify(ARIBA_EXPECTED_VOCABULARY[id] ?? [])) validVocabulary = false;
    for (const item of items) {
      const product = elementAttribute(item, "data-product-name");
      const feature = elementAttribute(item, "data-feature-label");
      const neutral = elementAttribute(item, "data-model-label");
      const present = [product, feature, neutral].filter(nonEmptyString);
      if (present.length !== 1 || publishedStaticText(item) !== present[0]
        || (product && !ARIBA_PRODUCT_NAMES.has(product))
        || (feature && !ARIBA_FEATURE_LABELS.has(feature))
        || (neutral && !ARIBA_NEUTRAL_LABELS.has(neutral))) validVocabulary = false;
    }
  }
  const allVocabularyItems = all.filter((element) => element.attributes.has("data-product-name")
    || element.attributes.has("data-feature-label") || element.attributes.has("data-model-label"));
  if (allVocabularyItems.length !== Object.values(ARIBA_EXPECTED_VOCABULARY).flat().length
    || allVocabularyItems.some((item) => !elementHasClass(item, "model-vocabulary__item"))) validVocabulary = false;
  if (!validVocabulary) error(errors, "ariba-map-taxonomy", path, "requires the exact bounded official-product, official-feature and neutral workshop vocabulary");
  const productDisclaimers = all.filter((element) => elementHasClass(element, "artifact-product-disclaimer"));
  if (productDisclaimers.length !== 1 || publishedStaticText(productDisclaimers[0]) !== ARTIFACT_PRODUCT_DISCLAIMER) {
    error(errors, "artifact-disclaimer", path, "requires the exact SAP product-label disclaimer once");
  }
  const scripts = all.filter((element) => element.name === "script");
  const fakeControls = cells.some((cell) => cell.attributes.has("tabindex") || cell.attributes.has("role"))
    || all.some((element) => element.name === "button" || element.name === "input")
    || scripts.length > 0;
  if (fakeControls) error(errors, "ariba-map-static", path, "must remain complete static HTML without fake card interaction");
}

function verifyMaturityArtifact(path, artifact, errors) {
  const { all, styleText } = artifact;
  const dimensions = all.filter((element) => element.name === "section" && elementHasClass(element, "maturity-dimension"));
  const actual = dimensions.map((dimension) => {
    const heading = directElementChildren(dimension, "h2")[0];
    return [
      elementAttribute(dimension, "data-dimension"),
      publishedStaticText(heading),
      Number(elementAttribute(dimension, "data-baseline")),
      Number(elementAttribute(dimension, "data-target"))
    ];
  });
  if (JSON.stringify(actual) !== JSON.stringify(MATURITY_DIMENSIONS)) {
    error(errors, "maturity-model", path, "requires the exact eight ordered illustrative dimensions and initial values");
  }
  const fieldsets = dimensions.flatMap((dimension) => directElementChildren(dimension, "fieldset"));
  const radios = all.filter((element) => element.name === "input" && elementAttribute(element, "type") === "radio");
  let controlsValid = fieldsets.length === 16 && radios.length === 80;
  for (const [dimensionIndex, dimension] of dimensions.entries()) {
    const [id, , baseline, target] = MATURITY_DIMENSIONS[dimensionIndex] ?? [];
    const groups = directElementChildren(dimension, "fieldset");
    for (const [sideIndex, group] of groups.entries()) {
      const side = sideIndex === 0 ? "baseline" : "target";
      const expected = side === "baseline" ? baseline : target;
      const legend = directElementChildren(group, "legend");
      const inputs = elementDescendants(group, "input");
      const labels = elementDescendants(group, "label");
      if (elementAttribute(group, "data-side") !== side || legend.length !== 1
        || publishedStaticText(legend[0]) !== (side === "baseline" ? "Illustrative baseline" : "Scenario target")
        || inputs.length !== 5 || labels.length !== 5) controlsValid = false;
      inputs.forEach((input, valueIndex) => {
        const value = String(valueIndex + 1);
        const inputId = `${id}-${side}-${value}`;
        const expectedAttributes = new Set(["id", "type", "name", "value", ...(valueIndex + 1 === expected ? ["checked"] : [])]);
        if (!elementHasExactAttributeNames(input, expectedAttributes)
          || elementAttribute(input, "id") !== inputId
          || elementAttribute(input, "type") !== "radio"
          || elementAttribute(input, "name") !== `${id}-${side}`
          || elementAttribute(input, "value") !== value
          || input.attributes.has("checked") !== (valueIndex + 1 === expected)
          || elementAttribute(labels[valueIndex], "for") !== inputId) controlsValid = false;
      });
    }
  }
  if (!controlsValid || !/\.scale-choice\s*\{[^}]*min-block-size:\s*44px;[^}]*min-inline-size:\s*44px;/s.test(styleText)) {
    error(errors, "maturity-controls", path, "requires 16 native radio groups, 80 values from 1 through 5 and 44px labelled targets");
  }
  const scripts = all.filter((element) => element.name === "script");
  const script = scripts.length === 1 ? rawElementText(scripts[0]) : "";
  const formulaFragments = [
    "baselineTotal / dimensions.length",
    "targetTotal / dimensions.length",
    "targetTotal - baselineTotal",
    "Math.max(...gaps.map((dimension) => dimension.gap))",
    "baselineTotal / 40",
    "b.gap - a.gap || a.order - b.order",
    ".slice(0, 4)"
  ];
  if (scripts.length !== 1 || formulaFragments.some((fragment) => !script.includes(fragment))) {
    error(errors, "maturity-formulas", path, "requires exact averages, total/max gap, 40-point score and stable four-gap ordering");
  }
  const guardFragments = ["allowedSides.has(side)", "Number.isInteger(value)", "value < 1", "value > 5"];
  if ((script.match(/allowedIds\.has\(id\)/g) ?? []).length !== 2 || guardFragments.some((fragment) => !script.includes(fragment))) {
    error(errors, "maturity-guards", path, "requires dimension, side and integer range validation before state changes");
  }
  const behaviorFragments = ["replaceChildren(", "textContent =", "globalThis.procurementMaturityModel", 'input.addEventListener("change"'];
  if (behaviorFragments.some((fragment) => !script.includes(fragment))) {
    error(errors, "maturity-interaction", path, "requires safely rendered native-control updates and an independently testable calculator");
  }
  const summaries = all.filter((element) => element.name === "section" && elementHasClass(element, "scenario-summary"));
  const summary = summaries[0];
  const summaryHeadings = summary ? directElementChildren(summary, "h2") : [];
  const summaryLists = summary ? directElementChildren(summary, "dl") : [];
  const summaryRows = summaryLists.length === 1 ? directElementChildren(summaryLists[0], "div") : [];
  const actualSummaryRows = summaryRows.map((row) => {
    const terms = directElementChildren(row, "dt");
    const values = directElementChildren(row, "dd");
    return terms.length === 1 && values.length === 1
      ? [publishedStaticText(terms[0]), elementAttribute(values[0], "id"), publishedStaticText(values[0])]
      : null;
  });
  const expectedSummaryRows = [
    ["Illustrative baseline", "baseline-average", "1.9 / 5.0"],
    ["Scenario target", "target-average", "4.3 / 5.0"],
    ["Total scenario gap", "total-gap", "+19 points"],
    ["Maximum single gap", "maximum-gap", "3"],
    ["Illustrative baseline score", "baseline-score", "38%"]
  ];
  if (summaries.length !== 1 || summaryHeadings.length !== 1
    || !exactElementAttributes(summaryHeadings[0], { id: "scenario-summary-title" })
    || publishedStaticText(summaryHeadings[0]) !== "Scenario score"
    || JSON.stringify(actualSummaryRows) !== JSON.stringify(expectedSummaryRows)) {
    error(errors, "maturity-output", path, "requires the exact Scenario score heading and honestly labelled baseline-derived output rows");
  }
  const visible = publishedStaticText(artifact.body);
  for (const required of ["Illustrative baseline", "Illustrative baseline score", "Scenario target", "Scenario score", "Largest scenario gaps", "1.9", "4.3", "+19", "38%"] ) {
    if (!visible.includes(required)) error(errors, "maturity-output", path, `missing initial illustrative output ${required}`);
  }
}

function verifyInfographicArtifact(path, artifact, errors) {
  const { all, body, styleText } = artifact;
  const stages = all.filter((element) => element.name === "li" && elementHasClass(element, "process-stage"));
  const actualStages = stages.map((stage) => [elementAttribute(stage, "data-stage"), publishedStaticText(stage)]);
  const notes = all.filter((element) => element.name === "li" && elementHasClass(element, "scenario-note")).map((note) => publishedStaticText(note));
  const tables = all.filter((element) => element.name === "table");
  const captions = tables.length === 1 ? directElementChildren(tables[0], "caption") : [];
  const headers = tables.length === 1 ? elementDescendants(tables[0], "th") : [];
  if (JSON.stringify(actualStages) !== JSON.stringify(INFOGRAPHIC_STAGES)
    || JSON.stringify(notes) !== JSON.stringify(INFOGRAPHIC_NOTES)
    || !publishedStaticText(body).includes("Reference model")
    || !publishedStaticText(body).includes("Illustrative target-state scenario")
    || tables.length !== 1 || captions.length !== 1 || headers.length !== 5
    || headers.some((header) => !new Set(["col", "row"]).has(elementAttribute(header, "scope")))) {
    error(errors, "infographic-model", path, "requires the exact seven-stage reference sequence, scenario framing, notes and semantic comparison table");
  }
  if (all.some((element) => element.name === "script" || element.name === "svg")
    || !/@media\s*\(max-width:\s*760px\)/i.test(styleText)
    || /overflow\s*:\s*hidden/i.test(styleText)
    || /min-width\s*:\s*[1-9]\d*px/i.test(styleText)) {
    error(errors, "infographic-responsive", path, "requires a script-free responsive text infographic without masked overflow or fixed minimum width");
  }
}

async function publicHtmlPaths(root, relativeDirectory = "") {
  const entries = await readdir(resolve(root, relativeDirectory), { withFileTypes: true });
  const paths = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const childDirectory = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      paths.push(...await publicHtmlPaths(root, childDirectory));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".html")) continue;
    paths.push(relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name);
  }
  return paths;
}

async function verifyArtifacts(_factData, context) {
  let diagramFiles = [];
  try {
    diagramFiles = (await readdir(resolve(context.root, "diagrams"))).filter((entry) => entry.endsWith(".html")).sort();
  } catch (cause) {
    error(context.errors, "artifact-manifest", "diagrams", `unable to enumerate artifact directory: ${cause.code ?? cause.message}`);
  }
  if (JSON.stringify(diagramFiles) !== JSON.stringify(["diagram1_universal.html", "diagram2_ariba.html", "diagram3_maturity.html", "infographic.html"])) {
    error(context.errors, "artifact-manifest", "diagrams", "requires the exact four embedded artifact files and no sixth diagram artifact");
  }
  try {
    const artifactOwners = [];
    for (const path of await publicHtmlPaths(context.root)) {
      const html = await readFile(resolve(context.root, path), "utf8");
      const parsed = parseStaticHtml(html);
      if (elementDescendants(parsed.root, "body").some((body) => body.attributes.has("data-artifact"))) artifactOwners.push(path);
    }
    const expectedOwners = ARTIFACT_FILES.map(([path]) => path).sort();
    if (JSON.stringify(artifactOwners.sort()) !== JSON.stringify(expectedOwners)) {
      error(context.errors, "artifact-manifest", "artifacts", `requires exact recursive body[data-artifact] paths ${JSON.stringify(expectedOwners)}; actual ${JSON.stringify(artifactOwners.sort())}`);
    }
  } catch (cause) {
    error(context.errors, "artifact-manifest", "artifacts", `unable to enumerate public HTML recursively: ${cause.code ?? cause.message}`);
  }
  const files = new Map();
  const parsed = new Map();
  for (const [path, dataArtifact] of ARTIFACT_FILES) {
    const html = await readRequired(context, path, "artifact-file");
    files.set(path, html);
    const artifact = verifyArtifactShared(path, html, dataArtifact, context);
    parsed.set(path, artifact);
    await verifyArtifactResources(path, html, artifact.root, artifact.styleText, context);
  }
  const process = parsed.get("diagrams/diagram1_universal.html");
  const ariba = parsed.get("diagrams/diagram2_ariba.html");
  const maturity = parsed.get("diagrams/diagram3_maturity.html");
  const embeddedInfographic = parsed.get("diagrams/infographic.html");
  const standaloneInfographic = parsed.get("infographic_procurement_2026_EN.html");
  if (process?.body) verifyProcessArtifact("diagrams/diagram1_universal.html", process, context.errors);
  if (ariba?.body) verifyAribaMapArtifact("diagrams/diagram2_ariba.html", ariba, context.errors);
  if (maturity?.body) verifyMaturityArtifact("diagrams/diagram3_maturity.html", maturity, context.errors);
  if (embeddedInfographic?.body) verifyInfographicArtifact("diagrams/infographic.html", embeddedInfographic, context.errors);
  if (standaloneInfographic?.body) verifyInfographicArtifact("infographic_procurement_2026_EN.html", standaloneInfographic, context.errors);
  if (files.get("diagrams/infographic.html") !== files.get("infographic_procurement_2026_EN.html")) {
    error(context.errors, "infographic-parity", "diagrams/infographic.html", "embedded and standalone infographic files must be byte-for-byte identical");
  }
}

const SITE_SHELL_ENTRIES = Object.freeze([
  Object.freeze({ path: "index.html", lang: "pl", counterpart: "/en/", active: "logo" }),
  Object.freeze({ path: "en/index.html", lang: "en", counterpart: "/", active: "logo" }),
  Object.freeze({ path: "uslugi/transformacja-zakupow/index.html", lang: "pl", counterpart: "/en/uslugi/transformacja-zakupow/", active: "/uslugi/transformacja-zakupow/" }),
  Object.freeze({ path: "en/uslugi/transformacja-zakupow/index.html", lang: "en", counterpart: "/uslugi/transformacja-zakupow/", active: "/en/uslugi/transformacja-zakupow/" }),
  Object.freeze({ path: "uslugi/wdrozenie-sap-ariba/index.html", lang: "pl", counterpart: "/en/uslugi/wdrozenie-sap-ariba/", active: "/uslugi/wdrozenie-sap-ariba/" }),
  Object.freeze({ path: "en/uslugi/wdrozenie-sap-ariba/index.html", lang: "en", counterpart: "/uslugi/wdrozenie-sap-ariba/", active: "/en/uslugi/wdrozenie-sap-ariba/" }),
  Object.freeze({ path: "uslugi/doradztwo-zamowienia-publiczne/index.html", lang: "pl", counterpart: "/en/uslugi/doradztwo-zamowienia-publiczne/", active: "/uslugi/doradztwo-zamowienia-publiczne/" }),
  Object.freeze({ path: "en/uslugi/doradztwo-zamowienia-publiczne/index.html", lang: "en", counterpart: "/uslugi/doradztwo-zamowienia-publiczne/", active: "/en/uslugi/doradztwo-zamowienia-publiczne/" }),
  Object.freeze({ path: "aplikacje-operacyjne/index.html", lang: "pl", counterpart: "/en/aplikacje-operacyjne/", active: "/aplikacje-operacyjne/" }),
  Object.freeze({ path: "en/aplikacje-operacyjne/index.html", lang: "en", counterpart: "/aplikacje-operacyjne/", active: "/en/aplikacje-operacyjne/" }),
  Object.freeze({ path: "lotnictwo/index.html", lang: "pl", counterpart: "/en/lotnictwo/", active: "/lotnictwo/" }),
  Object.freeze({ path: "en/lotnictwo/index.html", lang: "en", counterpart: "/lotnictwo/", active: "/en/lotnictwo/" }),
  Object.freeze({ path: "case-studies/index.html", lang: "pl", counterpart: "/en/case-studies/", active: "/case-studies/" }),
  Object.freeze({ path: "en/case-studies/index.html", lang: "en", counterpart: "/case-studies/", active: "/en/case-studies/" }),
  Object.freeze({ path: "wiedza/index.html", lang: "pl", counterpart: "/en/wiedza/", active: "/wiedza/" }),
  Object.freeze({ path: "en/wiedza/index.html", lang: "en", counterpart: "/wiedza/", active: "/en/wiedza/" }),
  Object.freeze({ path: "wystapienia/index.html", lang: "pl", counterpart: "/en/wystapienia/", active: "/wiedza/" }),
  Object.freeze({ path: "en/wystapienia/index.html", lang: "en", counterpart: "/wystapienia/", active: "/en/wiedza/" }),
  Object.freeze({ path: "procurement-2026/index.html", lang: "pl", counterpart: "/en/wiedza/", active: "/wiedza/" })
]);

const SITE_SHELL_COPY = Object.freeze({
  pl: Object.freeze({
    navLabel: "Nawigacja główna", home: "/", logoLabel: "Paweł Mamcarz, strona główna", group: "Doradztwo",
    submenu: Object.freeze([
      Object.freeze(["/uslugi/transformacja-zakupow/", "Transformacja zakupów"]),
      Object.freeze(["/uslugi/wdrozenie-sap-ariba/", "Wdrożenie SAP Ariba"]),
      Object.freeze(["/uslugi/doradztwo-zamowienia-publiczne/", "Zamówienia publiczne"])
    ]),
    primary: Object.freeze([
      Object.freeze(["/aplikacje-operacyjne/", "Aplikacje"]), Object.freeze(["/lotnictwo/", "Lotnictwo"]),
      Object.freeze(["/case-studies/", "Projekty"]), Object.freeze(["/wiedza/", "Wiedza"]),
      Object.freeze(["/#about", "O mnie"]), Object.freeze(["/#contact", "Kontakt"])
    ]),
    language: "EN", toggle: "Menu nawigacyjne", back: "Wróć na górę",
    footer: Object.freeze([
      Object.freeze(["/", "Strona główna"]), Object.freeze(["/uslugi/transformacja-zakupow/", "Doradztwo"]),
      Object.freeze(["/aplikacje-operacyjne/", "Aplikacje"]), Object.freeze(["/lotnictwo/", "Lotnictwo"]),
      Object.freeze(["/case-studies/", "Projekty"]), Object.freeze(["/wiedza/", "Wiedza"]),
      Object.freeze(["/#contact", "Kontakt"])
    ])
  }),
  en: Object.freeze({
    navLabel: "Main navigation", home: "/en/", logoLabel: "Paweł Mamcarz, homepage", group: "Advisory",
    submenu: Object.freeze([
      Object.freeze(["/en/uslugi/transformacja-zakupow/", "Procurement transformation"]),
      Object.freeze(["/en/uslugi/wdrozenie-sap-ariba/", "SAP Ariba implementation"]),
      Object.freeze(["/en/uslugi/doradztwo-zamowienia-publiczne/", "Public procurement"])
    ]),
    primary: Object.freeze([
      Object.freeze(["/en/aplikacje-operacyjne/", "Applications"]), Object.freeze(["/en/lotnictwo/", "Aviation"]),
      Object.freeze(["/en/case-studies/", "Projects"]), Object.freeze(["/en/wiedza/", "Insights"]),
      Object.freeze(["/en/#about", "About"]), Object.freeze(["/en/#contact", "Contact"])
    ]),
    language: "PL", toggle: "Navigation menu", back: "Back to top",
    footer: Object.freeze([
      Object.freeze(["/en/", "Home"]), Object.freeze(["/en/uslugi/transformacja-zakupow/", "Advisory"]),
      Object.freeze(["/en/aplikacje-operacyjne/", "Applications"]), Object.freeze(["/en/lotnictwo/", "Aviation"]),
      Object.freeze(["/en/case-studies/", "Projects"]), Object.freeze(["/en/wiedza/", "Insights"]),
      Object.freeze(["/en/#contact", "Contact"])
    ])
  })
});

function shellElementHasOnlyTextAndComments(element) {
  return (element?.children ?? []).every((child) => child.type === "text" || child.type === "comment");
}

function shellElementHasOnlyEmptyContent(element) {
  return shellElementHasOnlyTextAndComments(element) && rawElementText(element).trim() === "";
}

function shellElementHasExactDirectElements(element, expected) {
  const children = element?.children ?? [];
  const elements = children.filter((child) => child.type === "element");
  return elements.length === expected.length
    && elements.every((child, index) => child === expected[index])
    && children.every((child) => child.type === "element"
      || child.type === "comment"
      || (child.type === "text" && child.value.trim() === ""));
}

function exactShellAnchor(anchor, href, label, current = false, className = null) {
  const attributes = { href };
  if (className !== null) attributes.class = className;
  if (current) attributes["aria-current"] = "page";
  return anchor?.name === "a"
    && exactApplicationResourceAttributes(anchor, attributes)
    && shellElementHasOnlyTextAndComments(anchor)
    && normalizeExactHtmlLiteral(rawElementText(anchor)) === label;
}

function exactShellLogo(anchor, href, current) {
  const attributes = { href, class: "nav-logo" };
  if (current) attributes["aria-current"] = "page";
  const children = anchor?.children ?? [];
  const mark = children.find((child) => child.type === "element");
  const markIndex = children.indexOf(mark);
  const prefix = children.slice(0, markIndex).filter((child) => child.type === "text").map((child) => child.value).join("");
  const suffix = children.slice(markIndex + 1).filter((child) => child.type === "text").map((child) => child.value).join("");
  return anchor?.name === "a"
    && exactApplicationResourceAttributes(anchor, attributes)
    && directElementChildren(anchor).length === 1
    && mark?.name === "b"
    && exactApplicationResourceAttributes(mark, {})
    && shellElementHasOnlyTextAndComments(mark)
    && normalizeExactHtmlLiteral(rawElementText(mark)) === "PM"
    && prefix.trim() === ""
    && normalizeExactHtmlLiteral(suffix) === "· Mamcarz.com";
}

function exactShellListLinks(list, expected, active) {
  const items = directElementChildren(list);
  if (items.length !== expected.length
    || items.some((item) => item.name !== "li" || !exactApplicationResourceAttributes(item, {}))) return false;
  return items.every((item, index) => {
    const children = directElementChildren(item);
    const [href, label] = expected[index];
    return shellElementHasExactDirectElements(item, children)
      && children.length === 1
      && exactShellAnchor(children[0], href, label, active === href);
  }) && shellElementHasExactDirectElements(list, items);
}

function shellElementsHaveNoBehaviorDrift(elements) {
  return elements.every((element) => [...element.attributes.keys()].every((name) => name !== "style" && !name.startsWith("on")));
}

function verifySiteShellPage(entry, html, parsedRoot, errors) {
  const copy = SITE_SHELL_COPY[entry.lang];
  const all = elementDescendants(parsedRoot);
  const body = htmlBodyRoot(parsedRoot);
  const navs = all.filter((element) => element.name === "nav" && elementHasClass(element, "site-nav"));
  const nav = navs[0];
  const navChildren = directElementChildren(nav);
  const logo = navChildren[0];
  const menu = navChildren[1];
  const language = navChildren[2];
  const toggle = navChildren[3];
  let navValid = navs.length === 1
    && nav?.parent === body
    && exactApplicationResourceAttributes(nav, { class: "site-nav", "aria-label": copy.navLabel })
    && navChildren.length === 4
    && exactShellLogo(logo, copy.home, entry.active === "logo")
    && menu?.name === "ul"
    && exactApplicationResourceAttributes(menu, { class: "nav-list", id: "nav-menu" })
    && exactShellAnchor(language, entry.counterpart, copy.language, false, "nav-lang")
    && toggle?.name === "button"
    && exactApplicationResourceAttributes(toggle, {
      class: "nav-toggle", id: "nav-toggle", "aria-label": copy.toggle,
      "aria-controls": "nav-menu", "aria-expanded": "false"
    });
  const toggleSpans = directElementChildren(toggle, "span");
  navValid = navValid
    && shellElementHasExactDirectElements(nav, navChildren)
    && shellElementHasExactDirectElements(toggle, toggleSpans)
    && toggleSpans.length === 3
    && toggleSpans.every((span) => exactApplicationResourceAttributes(span, {}) && shellElementHasOnlyEmptyContent(span));
  const menuItems = directElementChildren(menu);
  const disclosure = directElementChildren(menuItems[0]);
  const details = disclosure[0];
  const detailsChildren = directElementChildren(details);
  const summary = detailsChildren[0];
  const submenu = detailsChildren[1];
  navValid = navValid
    && menuItems.length === 7
    && menuItems.every((item) => item.name === "li" && exactApplicationResourceAttributes(item, {}))
    && shellElementHasExactDirectElements(menu, menuItems)
    && disclosure.length === 1
    && shellElementHasExactDirectElements(menuItems[0], disclosure)
    && details?.name === "details"
    && exactApplicationResourceAttributes(details, { class: "nav-group" })
    && detailsChildren.length === 2
    && shellElementHasExactDirectElements(details, detailsChildren)
    && summary?.name === "summary"
    && exactApplicationResourceAttributes(summary, {})
    && shellElementHasOnlyTextAndComments(summary)
    && normalizeExactHtmlLiteral(rawElementText(summary)) === copy.group
    && submenu?.name === "ul"
    && exactApplicationResourceAttributes(submenu, { class: "nav-submenu" })
    && exactShellListLinks(submenu, copy.submenu, entry.active)
    && exactShellListLinks({ children: menuItems.slice(1) }, copy.primary, entry.active);
  const current = nav ? elementDescendants(nav, "a").filter((anchor) => elementAttribute(anchor, "aria-current") === "page") : [];
  navValid = navValid && current.length === 1 && elementIsVisibleIfDisclosuresOpen(current[0]);
  const languageControls = all.filter((element) => element.name === "a" && elementHasClass(element, "nav-lang"));
  const logos = all.filter((element) => element.name === "a" && elementHasClass(element, "nav-logo"));
  const menus = all.filter((element) => element.name === "ul" && elementAttribute(element, "id") === "nav-menu");
  const toggles = all.filter((element) => element.name === "button" && elementAttribute(element, "id") === "nav-toggle");
  const disclosures = all.filter((element) => element.name === "details" && elementHasClass(element, "nav-group"));
  navValid = navValid && languageControls.length === 1 && logos.length === 1 && menus.length === 1 && toggles.length === 1 && disclosures.length === 1;
  if (!navValid) error(errors, "site-shell-nav", entry.path, "requires the exact localized disclosure navigation, route order, labels, ownership and sole current item");

  const overlays = all.filter((element) => elementAttribute(element, "id") === "nav-overlay");
  const backs = all.filter((element) => elementAttribute(element, "id") === "backToTop");
  const controlsValid = overlays.length === 1
    && overlays[0].name === "div"
    && overlays[0].parent === body
    && exactApplicationResourceAttributes(overlays[0], { class: "nav-overlay", id: "nav-overlay" })
    && shellElementHasOnlyEmptyContent(overlays[0])
    && backs.length === 1
    && backs[0].name === "button"
    && backs[0].parent === body
    && exactApplicationResourceAttributes(backs[0], { class: "back-to-top", id: "backToTop", "aria-label": copy.back })
    && shellElementHasOnlyTextAndComments(backs[0])
    && normalizeExactHtmlLiteral(rawElementText(backs[0])) === "↑";
  if (!controlsValid) error(errors, "site-shell-controls", entry.path, "requires one exact overlay and back-to-top control");

  const footers = all.filter((element) => element.name === "footer" && elementHasClass(element, "site-footer"));
  const footer = footers[0];
  const footerChildren = directElementChildren(footer);
  const brand = footerChildren[0];
  const footerList = footerChildren[1];
  const brandChildren = directElementChildren(brand);
  const sign = brandChildren[0];
  const owner = brandChildren[1];
  const signChildren = directElementChildren(sign);
  const signature = signChildren[0];
  const footerValid = footers.length === 1
    && footer?.parent === body
    && exactApplicationResourceAttributes(footer, { class: "site-footer" })
    && footerChildren.length === 2
    && shellElementHasExactDirectElements(footer, footerChildren)
    && brand?.name === "div"
    && exactApplicationResourceAttributes(brand, { class: "footer-brand" })
    && brandChildren.length === 2
    && shellElementHasExactDirectElements(brand, brandChildren)
    && sign?.name === "a"
    && exactApplicationResourceAttributes(sign, { class: "footer-sign", href: copy.home, "aria-label": copy.logoLabel })
    && signChildren.length === 1
    && shellElementHasExactDirectElements(sign, signChildren)
    && signature?.name === "img"
    && exactApplicationResourceAttributes(signature, {
      src: "/assets/img/signature.png", alt: "", width: "160", height: "50", loading: "lazy", decoding: "async"
    })
    && owner?.name === "div"
    && exactApplicationResourceAttributes(owner, { class: "footer-copy" })
    && shellElementHasOnlyTextAndComments(owner)
    && normalizeExactHtmlLiteral(rawElementText(owner)) === "© 2026 Paweł Mamcarz · mamcarz.com"
    && footerList?.name === "ul"
    && exactApplicationResourceAttributes(footerList, { class: "footer-links" })
    && exactShellListLinks(footerList, copy.footer, null);
  if (!footerValid) error(errors, "site-shell-footer", entry.path, "requires the exact signature, 2026 owner line and ordered localized seven-link footer");

  const stylesheets = all.filter((element) => element.name === "link" && (
    elementAttributeTokens(element, "rel").includes("stylesheet")
    || (elementAttribute(element, "href") ?? "").startsWith("/assets/css/style.css")
  ));
  const scripts = all.filter((element) => element.name === "script");
  const sharedScripts = scripts.filter((element) => element.attributes.has("src") || (elementAttribute(element, "src") ?? "").startsWith("/assets/js/main.js"));
  const inlineExecutable = scripts.filter((element) => !element.attributes.has("src") && normalize(elementAttribute(element, "type") ?? "") !== "application/ld+json");
  const resourceValid = stylesheets.length === 1
    && exactApplicationResourceAttributes(stylesheets[0], { rel: "stylesheet", href: "/assets/css/style.css?v=20260825-flightplan-2" })
    && elementIsActiveResource(stylesheets[0])
    && sharedScripts.length === 1
    && exactApplicationResourceAttributes(sharedScripts[0], { src: "/assets/js/main.js?v=20260825-flightplan-2", defer: null })
    && elementIsActiveResource(sharedScripts[0])
    && rawElementText(sharedScripts[0]).trim() === ""
    && elementDescendants(parsedRoot, "style").length === 0
    && inlineExecutable.length === 0;
  if (!resourceValid) error(errors, "site-shell-resources", entry.path, "requires one exact v2 stylesheet, one exact deferred v2 script and no alternate or inline executable shell resource");

  const shellOwned = [nav, footer, overlays[0], backs[0]].filter(Boolean).flatMap((element) => [element, ...elementDescendants(element)]);
  const legacy = all.some((element) => ["navLinks", "navHamburger"].includes(elementAttribute(element, "id")))
    || /\/en\/procurement-2026\//i.test(decodeHtmlEntities(html));
  if (legacy || !shellElementsHaveNoBehaviorDrift(shellOwned)) {
    error(errors, "site-shell-safety", entry.path, "forbids legacy IDs, fake English Procurement routing, inline shell styles and event handlers");
  }
}

async function verifySiteShellManifest(context) {
  for (const entry of SITE_SHELL_ENTRIES) {
    const html = await readRequired(context, entry.path, "site-shell-file");
    const parsed = parseStaticHtml(html);
    verifySiteShellPage(entry, html, parsed.root, context.errors);
  }
}

async function verifyPages(factData, family, context) {
  const selectedPairs = ROUTE_PAIRS.filter((pair) => family === "all" || pair[4] === family);
  if (family === "services" || family === "all") verifyServiceRegistryInventory(factData, context.errors, { required: true });
  if (family === "projects" || family === "all") verifyProjectRegistryInventory(factData, context.errors, { required: true });
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
    if (routeFamily === "aviation") {
      verifyAviationPage(plFile, plRoot, "pl", factData, context.errors);
      verifyAviationPage(enFile, enRoot, "en", factData, context.errors);
    }
    if (routeFamily === "knowledge") {
      verifyKnowledgePage(plFile, plRoot, "pl", context.errors);
      verifyKnowledgePage(enFile, enRoot, "en", context.errors);
    }
    if (routeFamily === "services") {
      const plEvidence = verifyServicePage(plFile, plRoot, "pl", factData, context.errors);
      const enEvidence = verifyServicePage(enFile, enRoot, "en", factData, context.errors);
      verifyServiceParity(plEvidence, enEvidence, context.errors);
    }
    if (routeFamily === "projects") {
      const plEvidence = verifyProjectPage(plFile, plRoot, "pl", factData, context.errors);
      const enEvidence = verifyProjectPage(enFile, enRoot, "en", factData, context.errors);
      verifyProjectParity(plEvidence, enEvidence, context.errors);
    }
    if (routeFamily === "speaking") {
      const speakingActive = elementAttribute(htmlBodyRoot(plRoot), "data-page") === "speaking"
        && elementAttribute(htmlBodyRoot(enRoot), "data-page") === "speaking";
      verifySpeakingRegistryInventory(factData, context.errors, { required: speakingActive });
      if (speakingActive) {
        verifySpeakingPage(plFile, plRoot, "pl", context.errors);
        verifySpeakingPage(enFile, enRoot, "en", context.errors);
      }
    }
    await verifyLocalLinks(plFile, plRoot, family, context);
    await verifyLocalLinks(enFile, enRoot, family, context);
  }
  if (family === "aviation" || family === "all") await verifyAviationHomepageLinks(context);
  if (family === "speaking" || family === "all") await verifyProcurementParent(factData, context);
  if (family === "artifacts" || family === "all") await verifyArtifacts(factData, context);
  if (family === "all") await verifySiteShellManifest(context);
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
    const completeServiceContext = await hasCompleteServiceDocumentContext(root);
    const completeProjectContext = await hasCompleteProjectDocumentContext(root);
    const completeSpeakingContext = await Promise.all(SPEAKING_SURFACES.map(async (path) => {
      try { return (await stat(resolve(root, path))).isFile(); } catch { return false; }
    })).then((items) => items.every(Boolean));
    verifyServiceRegistryInventory(facts, errors, { required: completeServiceContext });
    verifyProjectRegistryInventory(facts, errors, { required: completeProjectContext });
    verifySpeakingRegistryInventory(facts, errors, { required: completeSpeakingContext });
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
