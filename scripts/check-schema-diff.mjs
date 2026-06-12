import { spawnSync } from 'node:child_process';

const result = spawnSync('supabase', ['db', 'diff', '--local', '--schema', 'public'], {
  encoding: 'utf8',
  shell: process.platform === 'win32'
});

if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout);
  process.exit(result.status ?? 1);
}

const output = `${result.stdout}\n${result.stderr}`.trim();
const noChanges = output.length === 0 || /no schema changes/i.test(output);

if (!noChanges) {
  console.error('Schema diff is not empty. Create a timestamped migration for these changes:\n');
  console.error(output);
  process.exit(1);
}

console.log('Schema diff check passed.');
