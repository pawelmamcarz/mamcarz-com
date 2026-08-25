import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const scopeArg = process.argv.find((arg) => arg.startsWith("--scope="));
const scope = scopeArg?.split("=")[1] ?? "all";
const langArg = process.argv.find((arg) => arg.startsWith("--lang="));
const lang = langArg?.split("=")[1] ?? "all";
const errors = [];

if (!["all", "pl", "en"].includes(lang)) {
  errors.push(`ERROR cli-lang scripts/verify-site.mjs: unsupported language ${lang}`);
}
if (!["all", "facts", "foundation", "home"].includes(scope)) {
  errors.push(`ERROR cli-scope scripts/verify-site.mjs: unsupported scope ${scope}`);
}

async function read(relativePath) {
  return readFile(resolve(root, relativePath), "utf8");
}

function check(condition, id, path, message) {
  if (!condition) errors.push(`ERROR ${id} ${path}: ${message}`);
}

export async function readFacts() {
  let parsed;
  try {
    parsed = JSON.parse(await read("content/site-facts.json"));
  } catch (error) {
    check(false, "facts-json", "content/site-facts.json", error.message);
    return { version: 0, facts: [], blocked_claims: [] };
  }
  check(parsed.version === 1, "facts-version", "content/site-facts.json", "expected version 1");
  check(Array.isArray(parsed.facts), "facts-array", "content/site-facts.json", "facts must be an array");
  check(Array.isArray(parsed.blocked_claims), "blocked-claims-array", "content/site-facts.json", "blocked_claims must be an array");
  return Array.isArray(parsed.facts) ? parsed : { ...parsed, facts: [], blocked_claims: [] };
}

function verifyFactSchema(factData) {
  const required = ["id", "value", "display_pl", "display_en", "kind", "as_of", "source_type", "source_label", "source_url", "surfaces", "status"];
  for (const [index, fact] of factData.facts.entries()) {
    if (!fact || typeof fact !== "object" || Array.isArray(fact)) {
      check(false, "fact-record", "content/site-facts.json", `facts[${index}] must be an object`);
      continue;
    }
    for (const key of required) {
      check(Object.hasOwn(fact, key), "fact-key", "content/site-facts.json", `facts[${index}] missing ${key}`);
    }
  }
}

async function verifyFoundation() {
  const [css, js] = await Promise.all([
    read("assets/css/style.css"),
    read("assets/js/main.js")
  ]);
  check(css.length > 0, "foundation-css", "assets/css/style.css", "stylesheet is empty");
  check(js.length > 0, "foundation-js", "assets/js/main.js", "browser script is empty");
}

function occurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

async function verifyHome(factData) {
  const pages = [
    { path: "index.html", lang: "pl" },
    { path: "en/index.html", lang: "en" }
  ].filter((page) => lang === "all" || page.lang === lang);

  for (const page of pages) {
    const html = await read(page.path);
    check(occurrences(html, "<h1") === 1, "home-h1", page.path, "expected exactly one h1");
    for (const fact of factData.facts.filter((item) => Array.isArray(item?.surfaces) && item.surfaces.includes(page.path))) {
      const display = page.lang === "pl" ? fact.display_pl : fact.display_en;
      if (fact.status === "approved") {
        check(html.includes(display), `fact-${fact.id}`, page.path, `missing approved display: ${display}`);
      } else {
        check(!html.includes(display), `fact-${fact.id}`, page.path, `non-approved fact is still published: ${display}`);
      }
    }
  }
}

const facts = await readFacts();
if (scope === "facts" || scope === "all") await verifyFactSchema(facts);
if (scope === "foundation" || scope === "all") await verifyFoundation();
if (scope === "home" || scope === "all") await verifyHome(facts);

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`OK site verification (${scope})`);
}
