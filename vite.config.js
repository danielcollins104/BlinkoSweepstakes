import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { blinkoApiPlugin } from './server/vitePluginBlinko.js';

function nonBlockingCssPlugin() {
  return {
    name: 'non-blocking-css-lcp',
    enforce: 'post',
    transformIndexHtml(html) {
      return html.replace(
        /<link rel="stylesheet"([^>]*?)href="(\/assets\/[^"]+\.css)"([^>]*)>/g,
        '<link rel="preload" as="style"$1href="$2"$3><link rel="stylesheet"$1href="$2"$3 media="print" onload="this.media=\'all\'">'
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), blinkoApiPlugin(), nonBlockingCssPlugin()],
  build: {
    target: 'es2020',
    minify: 'esbuild',
    cssMinify: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) {
            return 'vendor-react';
          }
          if (id.includes('node_modules/lucide-react')) {
            return 'vendor-icons';
          }
          if (id.includes('node_modules/qrcode')) {
            return 'vendor-qrcode';
          }
        },
      },
    },
  },
  server: {
    port: 5174,
    host: true,
  },
});
