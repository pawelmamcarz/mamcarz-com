import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PUBLIC_PAGES } from './verify-site.mjs';

const ORIGIN = 'https://mamcarz.com';
const EM_DASH = '\u2014';
const TITLE_RANGE = Object.freeze([30, 65]);
const DESCRIPTION_RANGE = Object.freeze([70, 165]);
const LLMS_FILES = Object.freeze(['llms.txt', 'llms-full.txt']);

const decodeEntities = (value) => value
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const clean = (value) => decodeEntities(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim().normalize('NFC');

function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) result[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3]);
  return result;
}

function tags(html, name) {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map((match) => attributes(match[0]));
}

function meta(html, key, value) {
  return tags(html, 'meta').filter((tag) => tag[key] === value).map((tag) => tag.content ?? '');
}

function pageUrl(route) {
  return `${ORIGIN}${route}`;
}

function schemaTypes(node, found = new Set()) {
  if (Array.isArray(node)) node.forEach((item) => schemaTypes(item, found));
  else if (node && typeof node === 'object') {
    if (node['@type']) [].concat(node['@type']).forEach((type) => found.add(type));
    for (const [key, value] of Object.entries(node)) if (key !== '@type') schemaTypes(value, found);
  }
  return found;
}

function stripInactive(html) {
  return html.replace(/<(script|style|template|noscript)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
}

export function analysePage(page, html) {
  const errors = [];
  const warnings = [];
  const add = (list, message) => list.push(`${page.file}: ${message}`);
  const titles = [...html.matchAll(/<title>([\s\S]*?)<\/title>/gi)].map((match) => clean(match[1]));
  const title = titles[0] ?? '';
  const descriptions = meta(html, 'name', 'description').map(clean);
  const description = descriptions[0] ?? '';

  if (titles.length !== 1 || !title) add(errors, `expected exactly one non-empty <title>, found ${titles.length}`);
  if (descriptions.length !== 1 || !description) add(errors, `expected exactly one non-empty meta description, found ${descriptions.length}`);
  if (title && (title.length < TITLE_RANGE[0] || title.length > TITLE_RANGE[1])) add(warnings, `title length ${title.length} outside ${TITLE_RANGE.join('–')}`);
  if (description && (description.length < DESCRIPTION_RANGE[0] || description.length > DESCRIPTION_RANGE[1])) add(warnings, `description length ${description.length} outside ${DESCRIPTION_RANGE.join('–')}`);

  const canonicals = tags(html, 'link').filter((tag) => tag.rel === 'canonical').map((tag) => tag.href);
  if (canonicals.length !== 1 || canonicals[0] !== pageUrl(page.route)) add(errors, `canonical must be exactly ${pageUrl(page.route)}, found ${canonicals.join(', ') || 'none'}`);

  const hreflang = Object.fromEntries(tags(html, 'link').filter((tag) => tag.rel === 'alternate' && tag.hreflang).map((tag) => [tag.hreflang, tag.href]));
  const expectedHreflang = { [page.lang]: pageUrl(page.route) };
  if (page.pair) expectedHreflang[page.lang === 'pl' ? 'en' : 'pl'] = pageUrl(page.pair);
  expectedHreflang['x-default'] = pageUrl(page.lang === 'pl' || !page.pair ? page.route : page.pair);
  if (JSON.stringify(Object.entries(hreflang).sort()) !== JSON.stringify(Object.entries(expectedHreflang).sort())) {
    add(errors, `hreflang set ${JSON.stringify(hreflang)} differs from ${JSON.stringify(expectedHreflang)}`);
  }

  const ogTitle = meta(html, 'property', 'og:title').map(clean);
  const ogDescription = meta(html, 'property', 'og:description').map(clean);
  const ogUrl = meta(html, 'property', 'og:url');
  if (ogTitle.length !== 1 || ogTitle[0] !== title) add(errors, 'og:title must equal <title>');
  if (ogDescription.length !== 1 || ogDescription[0] !== description) add(errors, 'og:description must equal meta description');
  if (ogUrl.length !== 1 || ogUrl[0] !== pageUrl(page.route)) add(errors, 'og:url must equal the canonical URL');
  if (meta(html, 'property', 'og:image').length !== 1) add(errors, 'expected exactly one og:image');

  const types = new Set();
  let schemaDescription = null;
  for (const match of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(match[1]);
      schemaTypes(data, types);
      const nodes = data['@graph'] ?? [data];
      schemaDescription ??= nodes.find((node) => typeof node.description === 'string')?.description ?? null;
    } catch {
      add(errors, 'JSON-LD block does not parse');
    }
  }
  for (const type of page.schema) if (!types.has(type)) add(errors, `JSON-LD is missing manifest type ${type}`);
  if (schemaDescription !== null && clean(schemaDescription) !== description) add(warnings, 'JSON-LD description differs from meta description');

  const visible = stripInactive(html);
  const h1 = [...visible.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((match) => clean(match[1]));
  if (h1.length !== 1 || !h1[0]) add(errors, `expected exactly one non-empty <h1>, found ${h1.length}`);
  const h2Count = [...visible.matchAll(/<h2\b/gi)].length;

  const images = tags(visible, 'img');
  const missingAlt = images.filter((tag) => !('alt' in tag));
  if (missingAlt.length) add(errors, `${missingAlt.length} <img> without alt attribute`);

  if (html.includes(EM_DASH)) add(errors, 'contains an em dash (U+2014)');

  const mainMatch = visible.match(/<main\b[\s\S]*?<\/main>/i);
  const internalLinks = new Set();
  for (const tag of tags(mainMatch?.[0] ?? '', 'a')) {
    const href = tag.href ?? '';
    const path = href.startsWith(ORIGIN) ? href.slice(ORIGIN.length) : href;
    if (path.startsWith('/') && !path.startsWith('//')) internalLinks.add(path.split('#')[0].split('?')[0] || '/');
  }
  internalLinks.delete(page.route);

  return { page, title, description, h1: h1[0] ?? '', h2Count, imageCount: images.length, schemaTypes: [...types].sort(), internalLinks: [...internalLinks].sort(), errors, warnings };
}

export function analyseSitemap(xml, pages = PUBLIC_PAGES) {
  const errors = [];
  const entries = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((match) => ({
    loc: match[1].match(/<loc>([^<]+)<\/loc>/)?.[1] ?? '',
    lastmod: match[1].match(/<lastmod>([^<]+)<\/lastmod>/)?.[1] ?? '',
    alternates: Object.fromEntries([...match[1].matchAll(/hreflang="([^"]+)" href="([^"]+)"/g)].map((item) => [item[1], item[2]]))
  }));
  const expected = pages.map((page) => pageUrl(page.route));
  const actual = entries.map((entry) => entry.loc);
  const missing = expected.filter((url) => !actual.includes(url));
  const extra = actual.filter((url) => !expected.includes(url));
  if (missing.length) errors.push(`sitemap.xml: missing ${missing.join(', ')}`);
  if (extra.length) errors.push(`sitemap.xml: unexpected ${extra.join(', ')}`);
  if (new Set(actual).size !== actual.length) errors.push('sitemap.xml: duplicate <loc> entries');
  for (const entry of entries) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.lastmod)) errors.push(`sitemap.xml: ${entry.loc} has no valid lastmod`);
    const page = pages.find((candidate) => pageUrl(candidate.route) === entry.loc);
    if (page?.pair && entry.alternates[page.lang === 'pl' ? 'en' : 'pl'] !== pageUrl(page.pair)) errors.push(`sitemap.xml: ${entry.loc} alternate does not point to ${pageUrl(page.pair)}`);
  }
  return { entries, errors };
}

export function analyseLlms(name, text, pages = PUBLIC_PAGES) {
  const errors = [];
  const warnings = [];
  if (text.includes(EM_DASH)) errors.push(`${name}: contains an em dash (U+2014)`);
  if (!/^# .+/m.test(text)) errors.push(`${name}: missing H1 title`);
  if (!/^> .+/m.test(text)) warnings.push(`${name}: missing summary blockquote`);
  const urls = [...text.matchAll(/https:\/\/mamcarz\.com(\/[^\s)]*)?/g)].map((match) => match[1] || '/');
  const covered = new Set(urls);
  const missing = pages.filter((page) => !covered.has(page.route)).map((page) => page.route);
  const unknown = [...covered].filter((route) => !pages.some((page) => page.route === route) && route !== '/llms.txt' && route !== '/llms-full.txt');
  if (name === 'llms.txt') {
    if (missing.length) errors.push(`${name}: routes missing from index: ${missing.join(', ')}`);
    const undescribed = pages.filter((page) => !new RegExp(`\\]\\(${pageUrl(page.route).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\): \\S`).test(text)).map((page) => page.route);
    if (undescribed.length) warnings.push(`${name}: routes without a one-sentence description: ${undescribed.join(', ')}`);
  }
  if (unknown.length) errors.push(`${name}: links to routes outside PUBLIC_PAGES: ${unknown.join(', ')}`);
  return { name, routeCount: covered.size, errors, warnings };
}

export function analyseRobots(text) {
  const errors = [];
  if (!text.includes(`Sitemap: ${ORIGIN}/sitemap.xml`)) errors.push('robots.txt: missing Sitemap reference');
  for (const file of LLMS_FILES) if (!text.includes(`${ORIGIN}/${file}`)) errors.push(`robots.txt: missing ${file} reference`);
  if (/^Disallow:\s*\/\s*$/m.test(text)) errors.push('robots.txt: disallows the whole site');
  return { errors };
}

export function crossPageChecks(results) {
  const errors = [];
  const warnings = [];
  for (const field of ['title', 'description']) {
    const seen = new Map();
    for (const result of results) {
      if (!result[field]) continue;
      if (seen.has(result[field])) errors.push(`duplicate ${field}: ${seen.get(result[field])} and ${result.page.file}`);
      else seen.set(result[field], result.page.file);
    }
  }
  const inbound = new Map(results.map((result) => [result.page.route, 0]));
  for (const result of results) for (const link of result.internalLinks) if (inbound.has(link)) inbound.set(link, inbound.get(link) + 1);
  for (const [route, count] of inbound) if (count === 0) warnings.push(`no contextual link from another page's <main> to ${route}`);
  return { errors, warnings, inbound: Object.fromEntries(inbound) };
}

async function onlineChecks(pages, { timeoutMs = 10000 } = {}) {
  const findings = [];
  for (const target of [...pages.map((page) => page.route), '/robots.txt', '/sitemap.xml', '/llms.txt', '/llms-full.txt']) {
    const url = pageUrl(target);
    try {
      const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
      findings.push(response.status === 200 ? null : `${url}: HTTP ${response.status}`);
    } catch (error) {
      findings.push(`${url}: ${error.message}`);
    }
  }
  return findings.filter(Boolean);
}

export async function runSeoReport({ root = resolve(import.meta.dirname, '..'), online = false } = {}) {
  const read = (file) => readFile(resolve(root, file), 'utf8');
  const pages = await Promise.all(PUBLIC_PAGES.map(async (page) => analysePage(page, await read(page.file))));
  const sitemap = analyseSitemap(await read('sitemap.xml'));
  const llms = await Promise.all(LLMS_FILES.map(async (file) => analyseLlms(file, await read(file))));
  const robots = analyseRobots(await read('robots.txt'));
  const cross = crossPageChecks(pages);
  const onlineErrors = online ? await onlineChecks(PUBLIC_PAGES) : [];
  const errors = [...pages.flatMap((page) => page.errors), ...sitemap.errors, ...llms.flatMap((item) => item.errors), ...robots.errors, ...cross.errors, ...onlineErrors];
  const warnings = [...pages.flatMap((page) => page.warnings), ...llms.flatMap((item) => item.warnings), ...cross.warnings];
  return { pages, sitemap, llms, robots, cross, online, errors, warnings };
}

const cell = (value) => String(value).replace(/\|/g, '\\|');

export function formatSeoReport(report, { date }) {
  const lines = [
    `# Raport SEO i llms: ${date}`,
    '',
    `Wygenerowano przez \`npm run seo:report\`${report.online ? ' z flagą `--online`' : ' (tryb offline)'}. Zakres: ${report.pages.length} dokumentów z \`PUBLIC_PAGES\`, \`sitemap.xml\`, \`robots.txt\`, \`llms.txt\` i \`llms-full.txt\`.`,
    '',
    `- Błędy: ${report.errors.length}`,
    `- Ostrzeżenia: ${report.warnings.length}`,
    `- Wpisy w sitemapie: ${report.sitemap.entries.length}`,
    ...report.llms.map((item) => `- ${item.name}: ${item.routeCount} unikalnych tras mamcarz.com`),
    '',
    '## Strony',
    '',
    '| Plik | Tytuł (zn.) | Opis (zn.) | Schema | H2 | Obrazy | Linki wewn. w main | Linki przychodzące | lastmod |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |'
  ];
  for (const result of report.pages) {
    const lastmod = report.sitemap.entries.find((entry) => entry.loc === pageUrl(result.page.route))?.lastmod ?? '';
    lines.push(`| ${cell(result.page.file)} | ${result.title.length} | ${result.description.length} | ${cell(result.schemaTypes.join(', '))} | ${result.h2Count} | ${result.imageCount} | ${result.internalLinks.length} | ${report.cross.inbound[result.page.route]} | ${lastmod} |`);
  }
  lines.push('', '## Tytuły i opisy', '');
  for (const result of report.pages) lines.push(`- \`${result.page.route}\`: ${result.title}`, `  - ${result.description}`);
  lines.push('', '## Błędy', '', ...(report.errors.length ? report.errors.map((item) => `- ${item}`) : ['Brak.']));
  lines.push('', '## Ostrzeżenia', '', ...(report.warnings.length ? report.warnings.map((item) => `- ${item}`) : ['Brak.']));
  return `${lines.join('\n')}\n`;
}

async function cli(args = process.argv.slice(2)) {
  const online = args.includes('--online');
  const check = args.includes('--check');
  const write = args.includes('--write');
  const date = args.find((arg) => arg.startsWith('--date='))?.slice(7) ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error('ERROR seo-report: --date must be YYYY-MM-DD');
    process.exitCode = 1;
    return;
  }
  const report = await runSeoReport({ online });
  if (check) {
    for (const item of report.errors) console.error(`ERROR ${item}`);
    for (const item of report.warnings) console.warn(`WARN ${item}`);
    if (!report.errors.length) console.log(`OK seo report (${report.pages.length} pages, ${report.warnings.length} warnings)`);
  } else if (write) {
    const target = resolve(import.meta.dirname, '..', 'docs/seo/ARCHIWUM', `${date}-seo-report.md`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, formatSeoReport(report, { date }));
    console.log(`Wrote ${target}`);
  } else {
    process.stdout.write(formatSeoReport(report, { date }));
  }
  if (report.errors.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await cli();
