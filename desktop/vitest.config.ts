import { defineConfig } from 'vitest/config';
import { svelteTesting } from '@testing-library/svelte/vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/lib/testing/setup.ts'],
    include: ['./src/**/*.test.ts'],
    globals: false,
    clearMocks: true,
    restoreMocks: true,
    fakeTimers: {
      toFake: ['Date', 'setTimeout', 'clearTimeout'],
    },
  },
});
