// @ts-check
import { defineConfig } from 'astro/config';

// Static output works with Cloudflare Pages by deploying the `dist/` folder.
// https://docs.astro.build/en/guides/deploy/cloudflare/
export default defineConfig({
  site: 'https://max3.dev',
  output: 'static',
});
