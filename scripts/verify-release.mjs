import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PUBLIC_PAGES } from './verify-site.mjs';
import { publicationFiles } from './package-site.mjs';

const root = resolve(import.meta.dirname, '..');
export const PRIVATE_PATHS = ['/AGENTS.md', '/CLAUDE.md', '/content/site-facts.json', '/worker/index.js', '/worker/wrangler.toml', '/scripts/verify-site.mjs', '/package.json'];
export async function filesBelow(directory, prefix = '', includeHidden = false) {
  const files = [];
  for (const entry of await readdir(resolve(directory, prefix), { withFileTypes: true })) {
    if (!includeHidden && (entry.name.startsWith('.') || entry.name === 'node_modules')) continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await filesBelow(directory, path, includeHidden));
    else files.push(path);
  }
  return files.sort();
}

export async function verifyRelease({ source = root, live } = {}) {
  const expected = await publicationFiles(source);
  const actual = await filesBelow(resolve(source, '.public'), '', true);
  assert.deepEqual(actual, expected, 'Publication must contain exactly the allowed files');
  for (const file of expected) {
    assert((await readFile(resolve(source, file))).equals(await readFile(resolve(source, '.public', file))), `${file}: packaged bytes are stale`);
  }
  const htmlFiles = (await filesBelow(source)).filter(file => file.endsWith('.html'));
  assert.deepEqual(htmlFiles.sort(), [...PUBLIC_PAGES.map(page => page.file), '404.html', 'infographic_procurement_2026_EN.html'].sort(), 'Every HTML file must be a canonical page or an explicit 404/legacy alias');
  const documents = new Map(await Promise.all(PUBLIC_PAGES.map(async page => [page.route, await readFile(resolve(source, page.file), 'utf8')])));
  for (const page of PUBLIC_PAGES) {
    assert(!page.route.endsWith('.html'), `Canonical route redirects on Pages: ${page.route}`);
    const html = await readFile(resolve(source, page.file), 'utf8');
    for (const anchor of html.matchAll(/<a\b[^>]*href="mailto:[^"]+"[^>]*>[\s\S]*?<\/a>/g)) {
      assert(html.slice(0, anchor.index).endsWith('<!--email_off-->') && html.slice(anchor.index + anchor[0].length).startsWith('<!--/email_off-->'), `${page.file}: native email must survive Cloudflare transformation`);
    }
    if (page.pair) assert(html.includes(`href="${page.lang === 'en' ? '/en' : ''}/prywatnosc/"`), `${page.file}: missing privacy link`);
    for (const anchor of html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>/g)) {
      const url = new URL(anchor[1].replaceAll('&amp;', '&'), `https://mamcarz.com${page.route}`);
      if (url.origin !== 'https://mamcarz.com') continue;
      const target = documents.get(url.pathname);
      assert(target, `${page.file}: link does not point to a canonical public page: ${anchor[1]}`);
      if (url.hash) {
        const id = decodeURIComponent(url.hash.slice(1));
        const ids = [...target.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
        assert(ids.includes(id), `${page.file}: missing fragment ${anchor[1]}`);
      }
    }
  }
  if (live) {
    const base = new URL(live);
    assert.equal(base.protocol, 'https:');
    const get = async path => fetch(new URL(path, base), { redirect: 'manual', signal: AbortSignal.timeout(20000) });
    for (const page of PUBLIC_PAGES) {
      const response = await get(page.route);
      assert.equal(response.status, 200, `${page.route}: canonical must return 200 without redirect`);
      const html = await response.text();
      const canonical = [...html.matchAll(/<link\b[^>]*rel="canonical"[^>]*href="([^"]+)"[^>]*>/g)];
      assert.deepEqual(canonical.map(match => match[1]), [`https://mamcarz.com${page.route}`], `${page.route}: canonical mismatch`);
      assert(!html.includes('/cdn-cgi/l/email-protection'), `${page.route}: email is dependent on JS`);
    }
    for (const path of [...PRIVATE_PATHS, '/audit-missing-page/', '/en/audit-missing-page/']) {
      const response = await get(path);
      assert.equal(response.status, 404, `${path}: must not be publicly served`);
    }
    const alias = await get('/infographic_procurement_2026_EN');
    assert.equal(alias.status, 301);
    assert.equal(new URL(alias.headers.get('location'), base).pathname, '/diagrams/infographic');
    if (base.hostname === 'mamcarz.com') {
      const response = await fetch('https://www.mamcarz.com/en/lotnictwo/?release=quality', { redirect: 'manual', signal: AbortSignal.timeout(20000) });
      assert.equal(response.status, 301);
      assert.equal(response.headers.get('location'), 'https://mamcarz.com/en/lotnictwo/?release=quality');
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await verifyRelease({ live: process.argv.find(arg => arg.startsWith('--live='))?.slice(7) });
  console.log('OK publication boundary, public inventory and release checks');
}
