import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const standaloneRoot = join(root, '.next', 'standalone');
const standaloneNextDir = join(standaloneRoot, '.next');

if (!existsSync(standaloneRoot)) {
  throw new Error('Missing .next/standalone output. Run Next.js build first.');
}

mkdirSync(standaloneNextDir, { recursive: true });

const copyTargets = [
  [join(root, '.next', 'static'), join(standaloneNextDir, 'static')],
  [join(root, 'public'), join(standaloneRoot, 'public')],
];

for (const [source, destination] of copyTargets) {
  if (existsSync(source)) {
    cpSync(source, destination, { recursive: true, force: true });
  }
}
