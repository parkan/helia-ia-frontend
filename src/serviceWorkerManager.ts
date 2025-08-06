// Service Worker Manager for IPFS operations

// Type definitions for service worker communication
interface ServiceWorkerMessage {
  type: string;
  id: number;
  data?: any;
}

interface ServiceWorkerResponse {
  id: number;
  type: string;
  success: boolean;
  data?: any;
  error?: string;
}

interface PendingMessage {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  onProgress?: (progress: any) => void;
}

interface CacheEntry {
  files: any[];
  timestamp: number;
  cid: string;
}

interface CacheStats {
  directories: {
    count: number;
    sizeBytes: number;
    sizeKB: number;
  };
  total: {
    count: number;
    sizeBytes: number;
    sizeKB: number;
  };
  oldestEntry: { timestamp: number; cid: string } | null;
  newestEntry: { timestamp: number; cid: string } | null;
}

type ProgressCallback = (progress: any) => void;

class ServiceWorkerManager {
  private worker: ServiceWorker | null = null;
  private messageId: number = 0;
  private pendingMessages: Map<number, PendingMessage> = new Map();
  private isInitialized: boolean = false;
  private registration: ServiceWorkerRegistration | null = null;
  private messageHandlerSet: boolean = false;
  private cachePrefix: string = 'helia_directory_';
  private backgroundProgressCallbacks: Set<ProgressCallback> = new Set();
  private initPromise: Promise<ServiceWorkerRegistration> | null = null;
  
  // Cache configuration: IndexedDB handles blocks, LocalStorage handles processed directories


  constructor() {
    // Property initialization moved to class field declarations above
  }

  /**
   * Initialize the service worker
   */
  async init() {
    if (!('serviceWorker' in navigator)) {
      throw new Error('Service Worker not supported in this browser');
    }

    // If already initialized, return the existing registration
    if (this.isInitialized && this.registration) {
      return this.registration;
    }

          // If initialization is in progress, wait for it
      if (this.initPromise) {
        return this.initPromise;
      }

    // Create and store the initialization promise
    this.initPromise = this.performInit();
    return this.initPromise;
  }

  private async performInit(): Promise<ServiceWorkerRegistration> {
    try {
      
      // Register service worker
      const baseUrl = import.meta.env.BASE_URL || '/';
      const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
      const swUrl = `${base}sw.js`;
      
      this.registration = await navigator.serviceWorker.register(swUrl, {
        scope: base,
        updateViaCache: 'none'
      });
      
      // Wait for service worker to be ready and active
      await navigator.serviceWorker.ready;
      
              // Wait for controller to be available to prevent race condition
        if (!navigator.serviceWorker.controller) {
        await new Promise<void>((resolve) => {
          const onControllerChange = () => {
            if (navigator.serviceWorker.controller) {
              navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
              resolve();
            }
          };
          navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
          
          // Also check every 100ms in case event was missed
          const checkInterval = setInterval(() => {
            if (navigator.serviceWorker.controller) {
              clearInterval(checkInterval);
              navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
              resolve();
            }
          }, 100);
          
                      // Timeout after 3 seconds
            setTimeout(() => {
              clearInterval(checkInterval);
              navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
              resolve(); // Continue anyway
            }, 3000);
        });
      }
      
      // Set up message handler
      if (!this.messageHandlerSet) {
        navigator.serviceWorker.addEventListener('message', this.handleMessage.bind(this));
        this.messageHandlerSet = true;
      }
      
      // Get the active service worker
      this.worker = navigator.serviceWorker.controller || this.registration.active;
      this.isInitialized = true;
      

      return this.registration!;
      
    } catch (error) {
      console.error('Service Worker registration failed:', error);
      this.initPromise = null; // Reset on error so we can try again
      throw error;
    } finally {
      // Clear the promise when done (success or failure)
      if (this.isInitialized) {
        this.initPromise = null;
      }
    }
  }



  /**
   * Check if service worker is initialized and ready
   */
  get ready(): boolean {
    return this.isInitialized;
  }

  /**
   * Handle messages from service worker
   */
  handleMessage(event) {
    const { type, id, success, data, error } = event.data;
    
    // Handle progress updates separately
    if (type === 'PROGRESS_UPDATE') {
      // Find any pending messages that might want this progress update
      for (const [, pendingMessage] of this.pendingMessages) {
        if (pendingMessage.onProgress && typeof pendingMessage.onProgress === 'function') {
          pendingMessage.onProgress(data);
        }
      }
      return;
    }
    
    // Handle service worker progress updates (background subdirectory processing)
    if (type === 'SW_PROGRESS_UPDATE') {
      console.log('📢 Background processing update:', data);
      
      const progressData = {
        step: 'background_processing',
        type: data.type,
        message: data.message,
        subdirectory: data.subdirectory,
        files: data.files,
        error: data.error
      };
      
      // Send to any pending messages that might want this progress update
      for (const [, pendingMessage] of this.pendingMessages) {
        if (pendingMessage.onProgress && typeof pendingMessage.onProgress === 'function') {
          pendingMessage.onProgress(progressData);
        }
      }
      
      // Also send to persistent background progress callbacks
      for (const callback of this.backgroundProgressCallbacks) {
        if (typeof callback === 'function') {
          try {
            callback(progressData);
          } catch (error) {
            console.warn('Error in background progress callback:', error);
          }
        }
      }
      
      return;
    }
    
    console.log(`📬 Received response from service worker: ${type} (id: ${id})`, success ? 'SUCCESS' : 'ERROR');
    
    if (this.pendingMessages.has(id)) {
      const { resolve, reject } = this.pendingMessages.get(id);
      this.pendingMessages.delete(id);
      
      if (success) {
        resolve(data);
      } else {
        reject(new Error(error));
      }
    } else {
      console.warn(`⚠️ Received response for unknown message id: ${id}`);
    }
  }

  /**
   * Send message to service worker and wait for response
   */
  async sendMessage(type, payload = {}, onProgress = null) {
    // Always verify controller is current before sending
    await this.ensureValidController();
    
    if (!this.worker) {
      throw new Error('Service Worker controller not available');
    }
    
    const id = ++this.messageId;
    
    return new Promise((resolve, reject) => {
      this.pendingMessages.set(id, { resolve, reject, onProgress });
      
      try {
        console.log(`📤 Sending ${type} message to service worker (id: ${id})`);
        // Send message to service worker
        this.worker.postMessage({
          type,
          payload,
          id
        });
      } catch (error) {
        console.error(`❌ Failed to send ${type} message:`, error);
        this.pendingMessages.delete(id);
        reject(error);
        return;
      }
      
      // Set timeout for message
      setTimeout(() => {
        if (this.pendingMessages.has(id)) {
                      console.error(`⏰ Message timeout for ${type} (id: ${id}) after 5 minutes`);
          this.pendingMessages.delete(id);
                      reject(new Error(`Message timeout after 5 minutes for type: ${type}. Service worker may not be responding.`));
        }
              }, 300000); // 5 minute timeout for IPFS operations
    });
  }

  /**
   * Ensure the controller is current and valid
   */
  async ensureValidController() {
    // Use current controller or active service worker
    this.worker = navigator.serviceWorker.controller || this.registration?.active;
    
    if (!this.worker) {
      throw new Error('Service Worker not available');
    }
  }



  /**
   * Register a persistent callback for background progress updates
   */
  addBackgroundProgressCallback(callback) {
    this.backgroundProgressCallbacks.add(callback);
  }

  /**
   * Remove a background progress callback
   */
  removeBackgroundProgressCallback(callback) {
    this.backgroundProgressCallbacks.delete(callback);
  }



  /**
   * Get cached directory listing from browser storage
   */
  getCachedDirectoryListing(cid) {
    try {
      const cacheKey = `${this.cachePrefix}${cid}`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const data = JSON.parse(cached);
        const now = Date.now();
        
        // Optional: Add expiry (though IPFS content is immutable, so this is mostly for storage management)
        if (data.timestamp && (now - data.timestamp) < (30 * 24 * 60 * 60 * 1000)) { // 30 days
          console.log(`📦 Using cached directory listing for CID: ${cid} (${data.files.length} files)`);
          return data.files;
        } else {
          // Expired cache, remove it
          localStorage.removeItem(cacheKey);
        }
      }
      return null;
    } catch (error) {
      console.warn('Failed to read directory cache:', error);
      return null;
    }
  }



  /**
   * Store directory listing in browser storage
   */
  setCachedDirectoryListing(cid, files) {
    try {
      const cacheKey = `${this.cachePrefix}${cid}`;
      
      // Convert BigInt values to strings for JSON serialization
      const serializableFiles = files.map(file => {
        const serializable = { ...file };
        
        // Convert any BigInt values to strings
        Object.keys(serializable).forEach(key => {
          if (typeof serializable[key] === 'bigint') {
            serializable[key] = serializable[key].toString();
          }
        });
        
        return serializable;
      });
      
      const data = {
        files: serializableFiles,
        timestamp: Date.now(),
        cid
      };
      localStorage.setItem(cacheKey, JSON.stringify(data));
      console.log(`💾 Cached directory listing for CID: ${cid} (${files.length} files)`);
    } catch (error) {
      console.warn('Failed to cache directory listing:', error);
      // If localStorage is full, try to clear old entries
      this.clearOldCacheEntries();
    }
  }



  /**
   * Clear old cache entries to free up space
   */
  clearOldCacheEntries() {
    try {
      const cutoffTime = Date.now() - (7 * 24 * 60 * 60 * 1000); // 7 days
      const keysToRemove = [];
      
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(this.cachePrefix)) {
          try {
            const data = JSON.parse(localStorage.getItem(key));
            if (data.timestamp && data.timestamp < cutoffTime) {
              keysToRemove.push(key);
            }
          } catch (e) {
            // Invalid cache entry, mark for removal
            keysToRemove.push(key);
          }
        }
      }
      
      keysToRemove.forEach(key => localStorage.removeItem(key));
      if (keysToRemove.length > 0) {
        console.log(`🧹 Cleared ${keysToRemove.length} old cache entries`);
      }
    } catch (error) {
      console.warn('Failed to clear old cache entries:', error);
    }
  }

  /**
   * Perform shallow retrieval on a CID (with caching and progress tracking)
   */
  async performShallowRetrieval(cid, onProgress = null) {
    // Check cache first
    const cachedFiles = this.getCachedDirectoryListing(cid);
    if (cachedFiles) {
      return cachedFiles;
    }

    // If not cached, fetch from IPFS with progress tracking
    const files = await this.sendMessage('SHALLOW_RETRIEVAL', { cid }, onProgress);
    
    // Cache the result
    this.setCachedDirectoryListing(cid, files);
    
    return files;
  }

  /**
   * Extract matching XML file pairs
   */
  async extractPairs(files) {
    return this.sendMessage('EXTRACT_PAIRS', { files });
  }







  /**
   * Get directory listing and extract XML pairs (no file fetching)
   * Uses existing service worker message types
   */
  async getItemListing(cid, onProgress = null) {
    try {
      // Check if we have cached data first
      const cachedFiles = this.getCachedDirectoryListing(cid);
      if (cachedFiles) {
        onProgress?.({ step: 'cache_hit', message: 'Using cached directory listing...' });
        
        // Still need to extract pairs from cached data
        onProgress?.({ step: 'extract_pairs', message: 'Finding XML file pairs...' });
        const pairs = await this.extractPairs(cachedFiles);
        
        // @ts-ignore - pairs is array at runtime
        if (pairs.length === 0) {
          throw new Error('No matching XML pairs found (looking for *_files.xml and *_meta.xml)');
        }
        
        // @ts-ignore - pairs length exists at runtime
        onProgress?.({ step: 'complete', message: `Found ${pairs.length} items available to browse (cached).` });
        
        return {
          originalFiles: cachedFiles,
          pairs: pairs
        };
      }

      // Step 1: Perform shallow retrieval using existing message type (will cache automatically)
      onProgress?.({ step: 'shallow_retrieval', message: 'Connecting to IPFS and getting directory listing...' });
      
      // Create progress handler for directory listing
      const listingProgress = (progressData) => {
        if (progressData.type === 'DIRECTORY_LISTING_PROGRESS') {
          onProgress?.({
            step: 'directory_listing',
            message: progressData.message,
            entriesFound: progressData.entriesFound,
            stage: progressData.stage
          });
        }
      };
      
      const files = await this.performShallowRetrieval(cid, listingProgress);
      
      // Step 2: Extract matching pairs using existing message type
      onProgress?.({ step: 'extract_pairs', message: 'Finding XML file pairs...' });
      const pairs = await this.extractPairs(files);
      
            // @ts-ignore - pairs is array at runtime  
      if (pairs.length === 0) {
        throw new Error('No matching XML pairs found (looking for *_files.xml and *_meta.xml)');
      }

      // @ts-ignore - pairs length exists at runtime
      onProgress?.({ step: 'complete', message: `Found ${pairs.length} items available to browse.` });
      
      return {
        originalFiles: files,
        pairs: pairs
      };
    } catch (error) {
      console.error('Error in getItemListing:', error);
      throw error;
    }
  }

  /**
   * Fetch XML content for a specific item by basename
   * Uses existing service worker message types
   */
  async getSpecificItem(cid, baseName, onProgress = null) {
    try {
      // First get the directory listing to find the specific files
      onProgress?.({ step: 'find_item', message: `Looking for ${baseName} in directory...` });
      
      // Create progress handler for directory listing
      const listingProgress = (progressData) => {
        if (progressData.type === 'DIRECTORY_LISTING_PROGRESS') {
          onProgress?.({
            step: 'directory_listing',
            message: progressData.message,
            entriesFound: progressData.entriesFound,
            stage: progressData.stage
          });
        }
      };
      
      const files = await this.performShallowRetrieval(cid, listingProgress);
      const pairs = await this.extractPairs(files);
      
      // Find the specific pair
      // @ts-ignore - pairs is array at runtime
      const targetPair = pairs.find(pair => pair.baseName === baseName);
      if (!targetPair) {
        throw new Error(`Item "${baseName}" not found in the directory`);
      }
      
      // Fetch only the two XML files for this specific item using existing message types
      onProgress?.({ step: 'retrieve_files', message: `Fetching XML files for ${baseName}...` });
      
      // Use Vite's BASE_URL for fetch requests
      const baseUrl = import.meta.env.BASE_URL || '/';
      const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
      const [filesXmlContent, metaXmlContent] = await Promise.all([
        fetch(`${base}ipfs-sw/${targetPair.filesXml.cid}?filename=${targetPair.filesXml.name}`).then(r => r.text()),
        fetch(`${base}ipfs-sw/${targetPair.metaXml.cid}?filename=${targetPair.metaXml.name}`).then(r => r.text())
      ]);
      
      onProgress?.({ step: 'complete', message: 'XML files retrieved successfully.' });
      
      return {
        baseName: targetPair.baseName,
        filesXml: {
          ...targetPair.filesXml,
          content: filesXmlContent
        },
        metaXml: {
          ...targetPair.metaXml,
          content: metaXmlContent
        }
      };
    } catch (error) {
      console.error('Error in getSpecificItem:', error);
      throw error;
    }
  }

  /**
   * Check if service worker is supported and available
   */
  static isSupported() {
    return 'serviceWorker' in navigator;
  }

  /**
   * Force reload service worker
   */
  async reloadServiceWorker() {
    if (this.registration) {
      await this.registration.update();
    }
  }

  /**
   * Clear all directory cache entries
   */
  clearDirectoryCache() {
    try {
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(this.cachePrefix)) {
          keysToRemove.push(key);
        }
      }
      
      keysToRemove.forEach(key => localStorage.removeItem(key));
      console.log(`🧹 Cleared all directory cache (${keysToRemove.length} entries)`);
      return keysToRemove.length;
    } catch (error) {
      console.warn('Failed to clear directory cache:', error);
      return 0;
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    try {
      let directoryCount = 0;
      let directorySize = 0;
      const oldestEntry = { timestamp: Date.now(), cid: null };
      const newestEntry = { timestamp: 0, cid: null };
      
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(this.cachePrefix)) {
          const value = localStorage.getItem(key);
          if (value) {
            try {
              const data = JSON.parse(value);
              
              // Directory cache
              directoryCount++;
              directorySize += value.length;
              
              if (data.timestamp) {
                if (data.timestamp < oldestEntry.timestamp) {
                  oldestEntry.timestamp = data.timestamp;
                  oldestEntry.cid = data.cid;
                }
                if (data.timestamp > newestEntry.timestamp) {
                  newestEntry.timestamp = data.timestamp;
                  newestEntry.cid = data.cid;
                }
              }
            } catch (e) {
              // Ignore invalid entries
            }
          }
        }
      }
      
      return {
        directories: {
          count: directoryCount,
          sizeBytes: directorySize,
          sizeKB: Math.round(directorySize / 1024)
        },
        total: {
          count: directoryCount,
          sizeBytes: directorySize,
          sizeKB: Math.round(directorySize / 1024)
        },
        oldestEntry: oldestEntry.cid ? oldestEntry : null,
        newestEntry: newestEntry.cid ? newestEntry : null
      };
    } catch (error) {
      console.warn('Failed to get cache stats:', error);
      return { 
        directories: { count: 0, sizeBytes: 0, sizeKB: 0 },
        total: { count: 0, sizeBytes: 0, sizeKB: 0 },
        oldestEntry: null, 
        newestEntry: null 
      };
    }
  }

  /**
   * Force clear all service workers, caches, and directory cache, then reload
   */
  async forceClearAndReload() {
    try {
      // Clear directory cache first
      const clearedEntries = this.clearDirectoryCache();
      
      // Unregister all service workers
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        await registration.unregister();
      }
      
      // Clear all caches
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map(name => caches.delete(name)));
      
      console.log(`Cleared all service workers, caches, and ${clearedEntries} directory cache entries`);
      
      // Reload page to start fresh
      window.location.reload();
    } catch (error) {
      console.error('Error clearing service workers and caches:', error);
      // Still try to reload
      window.location.reload();
    }
  }
}

// Export singleton instance
export const serviceWorkerManager = new ServiceWorkerManager();

// Export class for multiple instances if needed
export default ServiceWorkerManager; 