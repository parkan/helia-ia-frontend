import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import path from 'path';

export default defineConfig({
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
      '@': path.resolve(__dirname, './src')
    }
  },
  
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
      },
      output: {
        manualChunks: {
          'helia': ['helia', '@helia/unixfs', '@helia/http', '@helia/strings'],
          'bookreader': ['@internetarchive/bookreader'],
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
}); 