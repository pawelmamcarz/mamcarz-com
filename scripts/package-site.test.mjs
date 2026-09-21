import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { packageSite, PUBLIC_FILES } from './package-site.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'mamcarz-package-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const file of PUBLIC_FILES) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), await readFile(new URL('../' + file, import.meta.url)));
  }
  return root;
}

test('ships public pages byte-for-byte, excludes private files and removes stale output', async t => {
  const root = await fixture(t);
  await mkdir(join(root, 'dist'), { recursive: true });
  await writeFile(join(root, 'dist/old-secret.txt'), 'private');
  await writeFile(join(root, 'assets/img/private.txt'), 'private');
  await writeFile(join(root, '.env'), 'private');
  await packageSite(root);
  const files = (await readdir(join(root, 'dist'), { recursive: true })).map(String);
  assert(!files.includes('.env'));
  assert(!files.includes('old-secret.txt'));
  assert(!files.includes('assets/img/private.txt'));
  for (const file of ['index.html', 'en/index.html', '404.html', '_headers', 'assets/js/main.js']) {
    assert.deepEqual(await readFile(join(root, 'dist', file)), await readFile(join(root, file)));
  }
  assert.equal(await readFile(join(root, '.env'), 'utf8'), 'private');
});

test('missing approved asset fails before replacing output', async t => {
  const root = await fixture(t);
  await mkdir(join(root, 'dist'));
  await writeFile(join(root, 'dist/previous.txt'), 'previous');
  await rm(join(root, 'favicon.svg'));
  await assert.rejects(packageSite(root), /ENOENT/);
  assert.equal(await readFile(join(root, 'dist/previous.txt'), 'utf8'), 'previous');
});

test('refuses a symlinked source asset', async t => {
  const root = await fixture(t);
  await rm(join(root, 'favicon.svg'));
  await symlink(join(root, 'index.html'), join(root, 'favicon.svg'));
  await assert.rejects(packageSite(root), /symlink/i);
});

test('refuses a symlinked output directory', async t => {
  const root = await fixture(t);
  await symlink(join(root, 'assets'), join(root, 'dist'));
  await assert.rejects(packageSite(root), /symlink/i);
  assert((await readFile(join(root, 'assets/js/main.js'))).length > 0);
});

test('every packaged HTML/CSS local reference resolves inside the public package', async t => {
  const root = await fixture(t);
  await packageSite(root);
  const allowed = new Set(PUBLIC_FILES);
  for (const file of PUBLIC_FILES) {
    assert.deepEqual(await readFile(join(root, 'dist', file)), await readFile(join(root, file)), file);
    if (!/\.(html|css)$/.test(file)) continue;
    const text = await readFile(join(root, 'dist', file), 'utf8');
    const refs = [...text.matchAll(/(?:href|src)=["']([^"']+)["']/g)].map(match => match[1]);
    for (const match of text.matchAll(/srcset=["']([^"']+)["']/g)) {
      refs.push(...match[1].split(',').map(item => item.trim().split(/\s+/)[0]));
    }
    for (const match of text.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/g)) refs.push(match[1]);
    for (const ref of refs) {
      const url = new URL(ref.replaceAll('&amp;', '&'), `https://mamcarz.com/${file}`);
      if (url.origin !== 'https://mamcarz.com') continue;
      let path = decodeURIComponent(url.pathname).slice(1);
      if (!path || path.endsWith('/')) path += 'index.html';
      assert(allowed.has(path), `${file}: missing public target ${ref}`);
    }
  }
});

test('preserves the already published PL and EN privacy pages', async t => {
  const root = await fixture(t);
  await packageSite(root);
  for (const file of ['prywatnosc/index.html', 'en/prywatnosc/index.html']) {
    assert.deepEqual(await readFile(join(root, 'dist', file)), await readFile(new URL('../' + file, import.meta.url)));
  }
});
