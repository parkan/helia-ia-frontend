// Helia Service Worker for IPFS operations (built with esbuild)

import { createHeliaHTTP } from '@helia/http';
import { unixfs } from '@helia/unixfs';
import { CID } from 'multiformats/cid';
import { trustlessGateway } from '@helia/block-brokers';
import { httpGatewayRouting, delegatedHTTPRouting } from '@helia/routers';
import { createVerifiedFetch } from '@helia/verified-fetch';
import { IDBBlockstore } from 'blockstore-idb';
import type { Helia } from '@helia/interface';
import type { UnixFS } from '@helia/unixfs';

console.log('Helia Service Worker loading...');

let helia: Helia | null = null;
let fs: UnixFS | null = null;
let verifiedFetch: any = null;
let isInitializing = false;
let initializationPromise: Promise<any> | null = null;

// Initialize Helia immediately when service worker loads
console.log('🚀 Auto-initializing Helia...');
initHelia().then(() => {
  console.log('✅ Helia auto-initialization completed');
}).catch(error => {
  console.error('❌ Helia auto-initialization failed:', error);
});

// Note: Stream management is now handled by verified-fetch

// MIME type utility function
function getMimeType(filename?: string): string {
  if (!filename) return 'application/octet-stream';
  const ext = filename.split('.').pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    // Common image formats in Internet Archive
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'tif': 'image/tiff',
    'tiff': 'image/tiff',
    'jp2': 'image/jp2',
    'webp': 'image/webp',
    'bmp': 'image/bmp',
    // Documents
    'pdf': 'application/pdf',
    'txt': 'text/plain',
    'html': 'text/html',
    'xml': 'application/xml',
    'css': 'text/css',
    'js': 'application/javascript',
    'json': 'application/json'
  };
  return mimeTypes[ext || ''] || 'application/octet-stream';
}

// Initialize Helia instance with trustless gateway support
async function initHelia(): Promise<{ helia: Helia; fs: UnixFS; verifiedFetch: any }> {
  // If already initialized, return immediately
  if (helia && fs) {
    console.log('♻️ Helia already initialized, reusing existing instance');
    return { helia, fs, verifiedFetch };
  }
  
  // If currently initializing, wait for the existing promise
  if (isInitializing && initializationPromise) {
    console.log('⏳ Helia initialization already in progress, waiting...');
    return await initializationPromise;
  }
  
  // Start new initialization
  isInitializing = true;
  initializationPromise = doInitialization();
  
  try {
    const result = await initializationPromise;
    isInitializing = false;
    return result;
  } catch (error) {
    isInitializing = false;
    initializationPromise = null;
    throw error;
  }
}

async function doInitialization(): Promise<{ helia: Helia; fs: UnixFS; verifiedFetch: any }> {
  try {
    console.log('🚀 Starting Helia initialization with trustless gateway support...');
    const initStartTime = performance.now();
    
    console.log('📋 Creating IndexedDB blockstore...');
    const blockstore = new IDBBlockstore('helia-ia-frontend');
    console.log('🔧 Opening IndexedDB blockstore...');
    await blockstore.open();
    
    console.log('📋 Creating Helia HTTP configuration...');
    const config = {
      // Use IndexedDB blockstore for persistent storage
      blockstore,
      // Configure block brokers - trustlessGateway without parameters
      blockBrokers: [
        trustlessGateway()
      ],
      // Configure routers with custom gateways
      routers: [
        //delegatedHTTPRouting('http://delegated-ipfs.dev'),
        httpGatewayRouting({
          gateways: [
            'https://ia.dcentnetworks.nl',
            //'https://trustless-gateway.link',
            //'https://blocks.ipfs.io',
            //'https://dweb.link'
          ]
        })
      ]
      // No complex libp2p configuration needed with @helia/http
    };
    
    console.log('⚙️ Configuration created, calling createHeliaHTTP() with 8s timeout...');
    
    // Create a more robust timeout mechanism
    let timeoutId: NodeJS.Timeout;
    let isResolved = false;
    
    const heliaPromise = createHeliaHTTP(config).then(result => {
      console.log('🎯 createHeliaHTTP() promise resolved successfully!');
      isResolved = true;
      if (timeoutId) clearTimeout(timeoutId);
      return result;
    }).catch(error => {
      console.error('🔥 createHeliaHTTP() promise rejected:', error);
      isResolved = true;
      if (timeoutId) clearTimeout(timeoutId);
      throw error;
    });
    
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        if (!isResolved) {
          console.error('🚨 TIMEOUT: Helia initialization timeout reached after 8 seconds');
          console.error('🚨 This indicates createHelia() is hanging - likely gateway connection issues');
          reject(new Error('Helia initialization timed out after 8 seconds. Gateway connection may be blocked or slow.'));
        }
      }, 8000);
    });
    
    console.log('🏁 Starting createHelia() race condition...');
    
    // Add periodic logging during the race
    const progressInterval = setInterval(() => {
      if (!isResolved) {
        console.log('⏳ Still waiting for createHelia() to complete...');
      }
    }, 2000);
    
    try {
      helia = await Promise.race([heliaPromise, timeoutPromise]);
      clearInterval(progressInterval);
      console.log('🎊 createHelia() race completed successfully!');
    } catch (error) {
      clearInterval(progressInterval);
      console.error('💥 createHelia() race failed:', error);
      throw error;
    }
    
    const heliaCreatedTime = performance.now();
    console.log(`✅ createHelia() completed in ${(heliaCreatedTime - initStartTime).toFixed(2)}ms`);
    
    console.log('🗂️ Creating UnixFS interface...');
    // Create UnixFS interface
    fs = unixfs(helia);
    
    console.log('🔗 Creating Verified Fetch instance...');
    // Create Verified Fetch instance with our custom Helia node
    // Note: Type assertion needed because DAGWalkers and hashers are required by type constraint?
    verifiedFetch = await createVerifiedFetch(helia as any);
    
    const totalTime = performance.now();
    console.log(`🎉 Helia initialization completed successfully in ${(totalTime - initStartTime).toFixed(2)}ms`);
    
    return { helia, fs, verifiedFetch };
  } catch (error) {
    console.error('❌ Failed to initialize Helia HTTP:', error);
    console.error('❌ Error details:', (error as Error).message);
    
    // Reset state on failure
    helia = null;
    fs = null;
    verifiedFetch = null;
    
    throw new Error(`Helia HTTP initialization failed: ${(error as Error).message}`);
  }
}

interface FileEntry {
  name: string;
  cid: string;
  size?: number;
  type: string;
}

interface SubdirectoryEntry {
  name: string;
  cid: string;
  path: string;
}

interface ProgressMessage {
  type: string;
  stage?: string;
  entriesFound?: number;
  lastEntry?: string;
  message?: string;
  duration?: string;
  error?: string;
  subdirectory?: string;
  files?: FileEntry[];
}

// Perform fast root directory listing, then queue subdirectories for background processing
async function performShallowRetrieval(cidString: string, clientId: any = null): Promise<FileEntry[]> {
  try {
    console.log(`🔍 About to initialize Helia for CID: ${cidString}`);
    const { fs } = await initHelia();
    console.log('✅ Helia initialization completed, parsing CID...');
    
    const cid = CID.parse(cidString);
    console.log('✅ CID parsed successfully, starting fast root listing...');
    
    console.log(`🔍 Starting fast root directory listing on CID: ${cidString}`);
    console.log('Using trustless gateways including ia.dcentnetworks.nl');
    
    const startTime = performance.now();
    const files: FileEntry[] = [];
    const subdirectoriesToProcess: SubdirectoryEntry[] = [];
    
    // Send initial progress message
    if (clientId) {
      await sendProgressMessage(clientId, {
        type: 'DIRECTORY_LISTING_PROGRESS',
        stage: 'starting',
        entriesFound: 0,
        message: 'Starting directory listing...'
      });
    }
    
    // Fast root-only listing
    let entryCount = 0;
    for await (const entry of fs.ls(cid)) {
      entryCount++;
      console.log(`📄 Found entry ${entryCount}: ${entry.name} (${entry.type}) - ${entry.cid.toString()}`);
      
      files.push({
        name: entry.name,
        cid: entry.cid.toString(),
        size: entry.size ? Number(entry.size) : undefined,
        type: entry.type
      });
      
      // Queue subdirectories for background processing
      if (entry.type === 'directory') {
        subdirectoriesToProcess.push({
          name: entry.name,
          cid: entry.cid.toString(),
          path: entry.name
        });
        console.log(`📁 Queued subdirectory for background processing: ${entry.name}`);
      }
      
      // Send progress update every 50 entries to avoid overwhelming the client
      if (clientId && (entryCount % 50 === 0 || entryCount <= 10)) {
        await sendProgressMessage(clientId, {
          type: 'DIRECTORY_LISTING_PROGRESS',
          stage: 'listing',
          entriesFound: entryCount,
          lastEntry: entry.name,
          message: `Found ${entryCount} entries...`
        });
      }
    }
    
    // Start background subdirectory processing (don't await - let it run async)
    if (subdirectoriesToProcess.length > 0) {
      console.log(`🔄 Starting background processing of ${subdirectoriesToProcess.length} subdirectories`);
      processSubdirectoriesInBackground(subdirectoriesToProcess, clientId);
    }
    
    const endTime = performance.now();
    const duration = (endTime - startTime).toFixed(2);
    
    // Send completion message
    if (clientId) {
      await sendProgressMessage(clientId, {
        type: 'DIRECTORY_LISTING_PROGRESS',
        stage: 'complete',
        entriesFound: files.length,
        duration: duration,
        message: `Completed! Found ${files.length} entries in ${duration}ms`
      });
    }
    
    console.log(`✅ Fast root directory listing completed in ${duration}ms`);
    console.log(`Found ${files.length} root files and directories via trustless gateways`);
    return files;
  } catch (error) {
    console.error('❌ Error in root directory retrieval:', error);
    
    // Send error message
    if (clientId) {
      await sendProgressMessage(clientId, {
        type: 'DIRECTORY_LISTING_PROGRESS',
        stage: 'error',
        error: (error as Error).message,
        message: `Error: ${(error as Error).message}`
      });
    }
    
    throw error;
  }
}

// Process subdirectories in background without blocking UI
async function processSubdirectoriesInBackground(subdirectories: SubdirectoryEntry[], clientId: any = null): Promise<void> {
  const { fs } = await initHelia();
  
  console.log(`🔄 Background processing started for ${subdirectories.length} subdirectories`);
  
  for (const subdir of subdirectories) {
    try {
      console.log(`📁 Processing subdirectory: ${subdir.path}`);
      const subdirCid = CID.parse(subdir.cid);
      const subdirFiles: FileEntry[] = [];
      
      for await (const entry of fs.ls(subdirCid)) {
        const fullPath = `${subdir.path}/${entry.name}`;
        subdirFiles.push({
          name: fullPath,
          cid: entry.cid.toString(),
          size: entry.size ? Number(entry.size) : undefined,
          type: entry.type
        });
        
        console.log(`📄 Background found: ${fullPath} (${entry.type}) - ${entry.cid.toString()}`);
      }
      
      // Send update to client with new files found
      if (clientId && subdirFiles.length > 0) {
        await sendProgressMessage(clientId, {
          type: 'SUBDIRECTORY_FILES_FOUND',
          subdirectory: subdir.path,
          files: subdirFiles,
          message: `Found ${subdirFiles.length} files in ${subdir.path}`
        });
      }
      
      console.log(`✅ Completed background processing of ${subdir.path}: ${subdirFiles.length} files`);
      
    } catch (error) {
      console.warn(`⚠️ Failed to process subdirectory ${subdir.path}:`, (error as Error).message);
      
      // Send error update to client
      if (clientId) {
        await sendProgressMessage(clientId, {
          type: 'SUBDIRECTORY_ERROR',
          subdirectory: subdir.path,
          error: (error as Error).message,
          message: `Could not access ${subdir.path}: ${(error as Error).message}`
        });
      }
    }
  }
  
  console.log(`🎉 Background subdirectory processing completed for all ${subdirectories.length} directories`);
}

// Send progress messages to client
async function sendProgressMessage(clientId: any, data: ProgressMessage): Promise<void> {
  if (!clientId) return;
  
  try {
    // clientId might be a Client object already (when passed as 'source') or a string ID
    const client = (typeof clientId === 'string') ? await self.clients.get(clientId) : clientId;
    if (client && client.postMessage) {
      console.log(`📤 SW: Sending progress message to client:`, data.type);
      client.postMessage({
        type: 'SW_PROGRESS_UPDATE',
        data: data,
        timestamp: Date.now()
      });
    }
  } catch (error) {
    console.warn('Failed to send progress message to client:', error);
  }
}

interface FilePair {
  baseName: string;
  filesXml: FileEntry;
  metaXml: FileEntry;
}

// Extract matching file pairs (*_files.xml and *_meta.xml)
function extractMatchingPairs(files: FileEntry[]): FilePair[] {
  const pairs: FilePair[] = [];
  const filesMap = new Map<string, { files?: FileEntry; meta?: FileEntry }>();
  
  // Group files by their base name
  files.forEach(file => {
    if (file.name.endsWith('_files.xml') || file.name.endsWith('_meta.xml')) {
      const baseName = file.name.replace(/_(?:files|meta)\.xml$/, '');
      
      if (!filesMap.has(baseName)) {
        filesMap.set(baseName, {});
      }
      
      const fileSet = filesMap.get(baseName)!;
      if (file.name.endsWith('_files.xml')) {
        fileSet.files = file;
      } else if (file.name.endsWith('_meta.xml')) {
        fileSet.meta = file;
      }
    }
  });
  
  // Create pairs where both files exist
  for (const [baseName, fileSet] of filesMap.entries()) {
    if (fileSet.files && fileSet.meta) {
      pairs.push({
        baseName,
        filesXml: fileSet.files,
        metaXml: fileSet.meta
      });
    }
  }
  
  console.log(`Found ${pairs.length} matching pairs`);
  return pairs;
}



// Send message back to the main thread
async function sendMessageToClient(message: any): Promise<void> {
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage(message);
  });
}

interface MessageEvent {
  data: {
    type: string;
    payload?: any;
    id: string;
  };
  source?: any;
}

// Handle client claiming for immediate activation
self.addEventListener('message', async (event: MessageEvent) => {
  const { type, payload, id } = event.data;
  const { source } = event;
  
  console.log(`📨 Service worker received message: ${type} (id: ${id})`);
  
  // Handle control messages without response
  if (type === 'CLAIM_CLIENTS') {
    console.log('Service worker claiming clients...');
    await self.clients.claim();
    console.log('Service worker clients claimed successfully');
    return;
  }
  
  try {
    let result: any;
    
    switch (type) {

        

        
      case 'SHALLOW_RETRIEVAL':
        const files = await performShallowRetrieval(payload.cid, source);
        result = { 
          type: 'SHALLOW_RETRIEVAL_RESPONSE', 
          id, 
          success: true, 
          data: files 
        };
        break;
        
      case 'EXTRACT_PAIRS':
        const pairs = extractMatchingPairs(payload.files);
        result = { 
          type: 'EXTRACT_PAIRS_RESPONSE', 
          id, 
          success: true, 
          data: pairs 
        };
        break;
        

        
      default:
        throw new Error(`Unknown message type: ${type}`);
    }
    
    // Send response back to the specific client
    console.log(`📤 Sending response for ${type} (id: ${id}):`, result.success ? 'SUCCESS' : 'ERROR');
    if (source) {
      source.postMessage(result);
    } else {
      // Fallback to broadcasting to all clients
      await sendMessageToClient(result);
    }
    
  } catch (error) {
    console.error('Service worker error:', error);
    const errorResult = { 
      type: `${type}_RESPONSE`, 
      id, 
      success: false, 
      error: (error as Error).message 
    };
    
    // Send error response back to the specific client
    console.log(`📤 Sending error response for ${type} (id: ${id}):`, (error as Error).message);
    if (source) {
      source.postMessage(errorResult);
    } else {
      // Fallback to broadcasting to all clients
      await sendMessageToClient(errorResult);
    }
  }
});

// Add fetch event listener to intercept requests to /ipfs-sw/[cid]
self.addEventListener('fetch', async (event: FetchEvent) => {
  const url = new URL(event.request.url);
  
  // Simple and robust: check if request is within our scope and contains ipfs-sw/
  const scope = self.registration.scope;
  
  if (url.href.startsWith(scope) && url.pathname.includes('/ipfs-sw/')) {
    console.log(`📥 SW: Intercepting IPFS request`);
    console.log(`📥 SW: Full URL: ${url.href}`);
    console.log(`📥 SW: Pathname: ${url.pathname}`);
    console.log(`📥 SW: Scope: ${scope}`);
    
    event.respondWith(
      (async () => {
        try {
          // Extract CID using flexible pattern matching that works with any base path
          const match = url.pathname.match(/\/ipfs-sw\/([^/?]+)(\/.*)?/);
          if (!match) {
            console.error('❌ SW: Invalid IPFS URL format:', url.pathname);
            console.error('❌ SW: Full URL was:', url.href);
            return new Response('Invalid IPFS URL format', { status: 400 });
          }
          
          const cid = match[1];
          const filePath = match[2]?.slice(1) || ''; // Remove leading slash if present
          
          console.log(`🔍 SW: Extracted CID: ${cid}, filePath: ${filePath}`);
          
          // Get filename from path or query parameter
          const filename = filePath || url.searchParams.get('filename');
          const fileSizeParam = url.searchParams.get('size');
          
          if (!cid) {
            console.error('❌ SW: No CID provided in URL:', url.pathname);
            return new Response('CID required', { status: 400 });
          }
          
          console.log(`📥 SW: Fetching content for CID: ${cid}, filename: ${filename}`);
          
          // Check for Range request
          const rangeHeader = event.request.headers.get('range');
          console.log(`🎯 SW: Range header: ${rangeHeader}`);
          

          
          // Determine content type
          const mimeType = getMimeType(filename || undefined);
          console.log(`🔍 SW: Detected MIME type: ${mimeType} for file: ${filename}`);
          
          // Initialize verified-fetch for simplified content delivery
          const { verifiedFetch } = await initHelia();
          
          // Use verified-fetch for simplified, reliable content delivery
          console.log(`🌊 SW: Using verified-fetch for ${filename} (${mimeType})`);
          
          // Let verified-fetch handle range requests, streaming, and all the complexity
          // Construct IPFS URL with optional file path
          const ipfsUrl = filePath ? `ipfs://${cid}/${filePath}` : `ipfs://${cid}`;
          console.log(`🔗 SW: Fetching from IPFS URL: ${ipfsUrl}`);
          
          const response = await verifiedFetch(ipfsUrl, {
            headers: event.request.headers
          });
          
          // Enhance response headers with our custom metadata
          const responseHeaders = new Headers(response.headers);
          responseHeaders.set('Content-Type', mimeType);
          responseHeaders.set('Cache-Control', 'public, max-age=86400');
          responseHeaders.set('Access-Control-Allow-Origin', '*');
          responseHeaders.set('Accept-Ranges', 'bytes');
          
          // Add Content-Length if we have file size metadata
          if (fileSizeParam) {
            const fileSize = parseInt(fileSizeParam, 10);
            responseHeaders.set('Content-Length', fileSize.toString());
            console.log(`📏 SW: Added Content-Length header from metadata: ${fileSize} bytes`);
          }
          
          console.log(`✅ SW: Serving verified-fetch response for ${filename} (${response.status})`);
          
          // Return response with enhanced headers
          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders
          });
          
        } catch (error) {
          console.error('❌ SW: Error serving content:', error);
          return new Response(`Error: ${(error as Error).message}`, { status: 500 });
        }
      })()
    );
    
    return; // Don't proceed with normal fetch
  }
  
  // For all other requests, let them proceed normally
});

// Handle service worker installation
self.addEventListener('install', (event: ExtendableEvent) => {
  console.log('Service Worker installing...');
  self.skipWaiting();
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  console.log('Service worker activated, claiming clients...');
  event.waitUntil(
    self.clients.claim().then(() => {
      console.log('Service worker claimed all clients successfully');
    })
  );
});

console.log('Helia Service Worker with trustless gateway support loaded successfully'); 
