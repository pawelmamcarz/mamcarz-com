import { lstat, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PUBLIC_PAGES } from './verify-site.mjs';

const assets = JSON.parse(await readFile(new URL('./public-assets.json', import.meta.url), 'utf8'));
export const PUBLIC_FILES = Object.freeze([...PUBLIC_PAGES.map(page => page.file), ...assets]);

// The output path is deliberately fixed: never recursively delete a CLI-supplied path.
export async function packageSite(root = resolve(import.meta.dirname, '..')) {
  root = resolve(root);
  const output = join(root, 'dist');
  try {
    if ((await lstat(output)).isSymbolicLink()) throw new Error('Output must not be a symlink');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (new Set(PUBLIC_FILES).size !== PUBLIC_FILES.length) throw new Error('Duplicate public path');
  const contents = [];
  for (const file of PUBLIC_FILES) {
    if (!file || file.includes('\\') || file.split('/').some(part => !part || part.startsWith('.')) || file.startsWith('dist/')) {
      throw new Error(`Invalid public path: ${file}`);
    }
    let current = root;
    for (const part of file.split('/')) {
      current = join(current, part);
      if ((await lstat(current)).isSymbolicLink()) throw new Error(`Source symlink: ${file}`);
    }
    // Read all sources before touching an existing package; missing files fail closed.
    contents.push([file, await readFile(current)]);
  }
  await rm(output, { recursive: true, force: true });
  for (const [file, bytes] of contents) {
    const target = join(output, file);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  return contents.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(`Packaged ${await packageSite()} public files in dist/`);
}
