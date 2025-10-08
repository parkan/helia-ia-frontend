import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { fileURLToPath, URL } from 'node:url';
import { execSync } from 'child_process';

// Get git commit hash for cache busting
const getGitHash = () => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch (e) {
    return Date.now().toString();
  }
};

export default defineConfig(() => ({
  // Use VITE_BASE_PATH if provided, otherwise empty string for relative paths
  // eslint-disable-next-line no-undef
  base: process.env.VITE_BASE_PATH ?? '',
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
    target: 'es2022', // Match service worker ES target
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
      },
      output: {
        manualChunks: {
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
  },
  
  define: {
    // Inject git hash for service worker cache busting
    __GIT_HASH__: JSON.stringify(getGitHash()),
  }
})); 