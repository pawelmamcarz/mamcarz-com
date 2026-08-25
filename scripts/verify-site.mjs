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

async function verifyFoundation(context) {
  const [css, js] = await Promise.all([read(context, "assets/css/style.css"), read(context, "assets/js/main.js")]);
  if (css !== null && css.length === 0) error(context.errors, "foundation-css", "assets/css/style.css", "stylesheet is empty");
  if (css !== null) {
    for (const token of [
      "--sky-paper: #E9EDEF",
      "--runway-ink: #102831",
      "--signal: #D94B2B",
      "--panel: #193D49",
      "--boundary: #8E9CA1",
      "--white: #F7F9F8",
      "--muted: #52707A"
    ]) {
      if (!css.includes(token)) error(context.errors, "flight-token", "assets/css/style.css", `missing ${token}`);
    }
    if (!css.includes("font-family: 'Barlow Semi Condensed'")) error(context.errors, "display-font", "assets/css/style.css", "Barlow face missing");
  }
  if (js !== null && js.length === 0) error(context.errors, "foundation-js", "assets/js/main.js", "browser script is empty");
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
