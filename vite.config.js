import { defineConfig } from 'vite';

export default defineConfig({
  // Allow access through preview/tunnel hostnames (e.g. *.preview.niteshift.dev).
  server: { host: '0.0.0.0', allowedHosts: true },
  preview: { host: '0.0.0.0', allowedHosts: true },
});
