import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit and integration tests are *.test.ts. The *.spec.ts files in e2e/ are Playwright's (`pnpm e2e`).
    include: ['{shared,server,web}/src/**/*.test.ts'],
  },
});
