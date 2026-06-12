import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const criticalRoots = [
  { root: 'test', suffix: '.spec.ts' },
  { root: 'supabase/tests/database', suffix: '.sql' }
];
const forbiddenPatterns = [
  /\bdescribe\.skip\b/,
  /\bit\.skip\b/,
  /\btest\.skip\b/,
  /\bskip\(/i,
  /\btodo\(/i
];
const failures = [];

async function collectFiles(root, suffix) {
  const collected = [];
  const entries = await readdir(join(process.cwd(), root), { withFileTypes: true });
  for (const entry of entries) {
    const child = `${root}/${entry.name}`;
    if (entry.isDirectory()) {
      collected.push(...(await collectFiles(child, suffix)));
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      collected.push(child);
    }
  }
  return collected;
}

for (const { root, suffix } of criticalRoots) {
  for (const file of await collectFiles(root, suffix)) {
    const content = await readFile(join(process.cwd(), file), 'utf8');
    const matchedPattern = forbiddenPatterns.find((forbiddenPattern) =>
      forbiddenPattern.test(content)
    );
    if (matchedPattern !== undefined) {
      failures.push(`${file} contains ${matchedPattern}`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('No skipped or todo critical tests found.');
