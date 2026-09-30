import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const localEnvPath = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(localEnvPath)) {
  loadEnvFile(localEnvPath);
}

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
