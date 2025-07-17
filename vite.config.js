import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig(() => ({
  // Use relative paths for better deployment flexibility
  base: '',
  plugins: [
    react(),
    nodePolyfills({
      // Include specific polyfills needed for Helia/IPFS
      include: [
        'buffer',
        'crypto',
        'events',
        'path',
        'process',
        'stream',
        'util'
      ],
      globals: {
        Buffer: true,
        global: true,
        process: true
      }
    })
  ],
  
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
      },
      output: {
        manualChunks: {
          'helia': ['helia', '@helia/unixfs', '@helia/http', '@helia/strings'],
          'vendor': ['react', 'react-dom', 'react-router-dom']
        }
      }
    }
  },
  
  server: {
    port: 3000,
    open: true
  },
  
  optimizeDeps: {
    esbuildOptions: {
      // Node.js global to browser globalThis
      define: {
        global: 'globalThis',
      },
    },
  }
})); 