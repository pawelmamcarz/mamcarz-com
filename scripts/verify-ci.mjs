import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const commands = [
  ['npm', 'run', 'verify:home'],
  ['npm', 'run', 'verify:pages', '--', '--family=all'],
  ...['metadata', 'discovery', 'seo', 'foundation', 'facts', 'site'].map(scope => ['npm', 'run', `verify:${scope}`]),
  ...['verify-site', 'worker', 'package'].map(suite => ['npm', 'run', `test:${suite}`]),
  ...['assets/js/main.js', 'worker/index.js', 'scripts/package-site.mjs', 'scripts/verify-ci.mjs'].map(file => [process.execPath, '--check', file]),
  ['npm', 'run', 'package:site'],
];
for (const [command, ...args] of commands) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const [agents, claude] = await Promise.all(['AGENTS.md', 'CLAUDE.md'].map(file => readFile(resolve(root, file))));
if (!agents.equals(claude)) throw new Error('AGENTS.md and CLAUDE.md differ');
console.log('All local CI checks passed');
