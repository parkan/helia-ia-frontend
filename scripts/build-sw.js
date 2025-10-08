#!/usr/bin/env node

// Build script for Helia Service Worker using esbuild
// Inspired by ipshipyard/drop-in-service-worker approach

import esbuild from 'esbuild';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProduction = process.env.NODE_ENV === 'production';
const isWatch = process.argv.includes('--watch');

console.log(`📦 Building service worker (${isProduction ? 'production' : 'development'} mode)...`);

const buildOptions = {
  entryPoints: ['sw/sw.ts'],
  bundle: true,
  outfile: 'public/sw.js',
  format: 'esm', // Use ES modules for modern service workers
  target: 'es2022', // Modern target with EventTarget support
  platform: 'browser',
  sourcemap: true,  // Always generate sourcemaps for debugging
  minify: false,  // Disabled - minifier is breaking libp2p initialization
  // NO production optimizations - debugging compatibility issues
  // ...(isProduction && {
  //   treeShaking: true,
  //   drop: ['debugger'],
  //   legalComments: 'none',
  //   mangleProps: /^_/,
  //   keepNames: false,
  // }),
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
    'global': 'globalThis',
    ...(isProduction && {
      // Define environment variables to help with tree shaking
      'process.env.LIBP2P_FORCE_PNET': 'false',
      'process.env.DEBUG': 'false',
    }),
  },
  banner: {
    js: `// Helia Service Worker - Built with esbuild at ${new Date().toISOString()}`
  },
  logLevel: 'info',
  ...(isProduction && {
    metafile: true,
  }),
};

async function build() {
  try {
    if (isWatch) {
      console.log('👀 Starting watch mode...');
      const context = await esbuild.context(buildOptions);
      await context.watch();
      console.log('👁️ Watching for changes to sw/sw.ts...');
    } else {
      const result = await esbuild.build(buildOptions);
      
      // Log build results
      const outputPath = path.resolve(buildOptions.outfile);
      const stats = fs.statSync(outputPath);
      const sizeKB = (stats.size / 1024).toFixed(2);
      
      console.log(`✅ Service worker built successfully!`);
      console.log(`📍 Output: ${outputPath}`);
      console.log(`📊 Size: ${sizeKB} KB`);
      
      // Bundle analysis for production builds
      if (isProduction && result.metafile) {
        console.log('\n📋 Bundle Analysis:');
        const analysis = await esbuild.analyzeMetafile(result.metafile, { verbose: false });
        console.log(analysis);
      }
      
      if (result.warnings.length > 0) {
        console.warn('⚠️ Build warnings:');
        result.warnings.forEach(warning => console.warn(warning));
      }
    }
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}

// Ensure public directory exists
const publicDir = path.dirname(buildOptions.outfile);
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

build(); 