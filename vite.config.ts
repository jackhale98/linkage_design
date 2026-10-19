/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Served from https://<user>.github.io/linkage_design/ on GitHub Pages.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/linkage_design/',
  plugins: [svelte()],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
