// Regenerate the golden images (golden/*.png). Look at them before committing!
// Run: npm run golden:update
import { spawnSync } from 'node:child_process';

const result = spawnSync('npx', ['vitest', 'run', 'golden'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, UPDATE_GOLDEN: '1' },
});
process.exit(result.status ?? 1);
