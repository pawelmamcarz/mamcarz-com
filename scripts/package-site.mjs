import { copyFile, lstat, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PUBLIC_PAGES } from './verify-site.mjs';

export const PUBLIC_ROOT_FILES = Object.freeze([
  ...PUBLIC_PAGES.map(page => page.file), '404.html', 'favicon.svg', 'logo.png',
  '_headers', '_redirects', 'robots.txt', 'sitemap.xml', 'llms.txt', 'llms-full.txt'
]);

export async function publicationFiles(root) {
  const files = [...PUBLIC_ROOT_FILES];
  async function visit(directory) {
    for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const path = `${directory}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`Symbolic link cannot be published: ${path}`);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && (
        path === 'assets/css/style.css' || path === 'assets/js/main.js'
        || /^assets\/img\/.+\.(?:jpg|jpeg|png|webp|svg)$/i.test(path)
        || /^assets\/fonts\/[^/]+\.(?:woff2|txt)$/i.test(path)
      )) files.push(path);
    }
  }
  await visit('assets');
  for (const file of files) if (!(await lstat(resolve(root, file))).isFile()) throw new Error(`Not a regular public file: ${file}`);
  return files.sort();
}

export async function packageSite(root = resolve(import.meta.dirname, '..')) {
  const output = resolve(root, '.public');
  const files = await publicationFiles(root);
  // Only this fixed, generated directory may be replaced. Never publish the repository root.
  await rm(output, { recursive: true, force: true });
  for (const file of files) {
    const target = resolve(output, file);
    if (relative(output, target).startsWith('..')) throw new Error(`Unsafe publication path: ${file}`);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(resolve(root, file), target);
  }
  return { output, files };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await packageSite();
  console.log(`Packaged ${result.files.length} public files in ${result.output}`);
}
