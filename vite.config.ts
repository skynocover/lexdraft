import { defineConfig } from 'vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import path from 'path'

export default defineConfig({
  environments: {
    lexdraft: {
      optimizeDeps: {
        include: ['mongodb'],
        esbuildOptions: {
          plugins: [
            {
              name: 'fix-punycode',
              setup(build) {
                // tr46 does require("punycode/") — the trailing slash confuses
                // esbuild and leaves a dynamic require.  Rewrite to the npm package.
                build.onResolve({ filter: /^punycode\/?$/ }, () => ({
                  path: path.resolve(__dirname, 'node_modules/punycode/punycode.js'),
                }))
              },
            },
          ],
        },
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/pdfjs-dist/cmaps/*',
          dest: 'cmaps',
        },
        {
          src: 'node_modules/pdfjs-dist/standard_fonts/*',
          dest: 'standard_fonts',
        },
      ],
    }),
    cloudflare(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/client'),
    },
  },
})
