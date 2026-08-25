import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const defaultRoot = resolve(import.meta.dirname, "..");
const factKeys = ["id", "value", "display_pl", "display_en", "kind", "as_of", "source_type", "source_label", "source_url", "surfaces", "status"];
const kinds = new Set(["constant", "dated"]);
const sourceTypes = new Set(["owner_verified", "public_source", "internal_evidence"]);
const statuses = new Set(["approved", "review", "retired"]);
const blockedKeys = ["id", "pattern", "forbidden_contexts", "reason"];
const publicClaimSurfaces = ["index.html", "en/index.html", "llms.txt", "llms-full.txt", "worker/index.js"];

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
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

function renderedText(html) {
  return normalize(html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&"));
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

function verifyFactSchema(factData, errors) {
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
    if (!statuses.has(fact.status)) error(errors, "fact-status", path, `facts[${index}] status is invalid`);
    verifyAliases(fact, index, errors);
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

async function verifyBlockedSurfaces(factData, context) {
  const claims = Array.isArray(factData.blocked_claims) ? factData.blocked_claims.filter((claim) => isPlainObject(claim) && nonEmptyString(claim.id) && nonEmptyString(claim.pattern)) : [];
  for (const surface of publicClaimSurfaces) {
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
  if (/\.innerHTML\s*=/.test(activeJs)) error(errors, "js-inner-html", path, "innerHTML assignment is forbidden");
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
  if (js !== null && js.length > 0) verifyBrowserScript(js, context.errors);
}

function candidates(fact, language) {
  const aliases = isPlainObject(fact.aliases) && Array.isArray(fact.aliases[language]) ? fact.aliases[language] : [];
  return [language === "pl" ? fact.display_pl : fact.display_en, ...aliases].filter(nonEmptyString).map(normalize);
}

async function verifyHome(factData, context) {
  const pages = [{ path: "index.html", lang: "pl" }, { path: "en/index.html", lang: "en" }].filter((page) => context.lang === "all" || page.lang === context.lang);
  for (const page of pages) {
    const html = await read(context, page.path);
    if (html === null) continue;
    if ((html.match(/<h1\b/gi) ?? []).length !== 1) error(context.errors, "home-h1", page.path, "expected exactly one h1");
    const visible = renderedText(html);
    const records = Array.isArray(factData.facts) ? factData.facts : [];
    for (const fact of records.filter((item) => Array.isArray(item?.surfaces) && item.surfaces.includes(page.path))) {
      const published = candidates(fact, page.lang).some((candidate) => visible.includes(candidate));
      if (fact.status === "approved" && !published) error(context.errors, `fact-${fact.id}`, page.path, `missing approved display: ${page.lang === "pl" ? fact.display_pl : fact.display_en}`);
      if (fact.status !== "approved" && published) error(context.errors, `fact-${fact.id}`, page.path, "non-approved fact is still published");
    }
  }
}

export async function runVerification({ root = defaultRoot, scope = "all", lang = "all" } = {}) {
  const errors = [];
  const context = { root, scope, lang, errors };
  if (!["all", "pl", "en"].includes(lang)) error(errors, "cli-lang", "scripts/verify-site.mjs", `unsupported language ${lang}`);
  if (!["all", "facts", "foundation", "home"].includes(scope)) error(errors, "cli-scope", "scripts/verify-site.mjs", `unsupported scope ${scope}`);
  const facts = await readFacts({ root, onError: (id, path, message) => error(errors, id, path, message) });
  if (scope === "facts" || scope === "all") {
    const factIds = verifyFactSchema(facts, errors);
    verifyBlockedSchema(facts, factIds, errors);
    await verifyBlockedSurfaces(facts, context);
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
