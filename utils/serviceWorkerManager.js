// Service Worker Manager for IPFS operations
class ServiceWorkerManager {
  constructor() {
    this.worker = null;
    this.messageId = 0;
    this.pendingMessages = new Map();
    this.isInitialized = false;
    this.registration = null;
    this.messageHandlerSet = false;
    this.cachePrefix = 'helia_directory_';
    this.fileCachePrefix = 'helia_file_';
    this.maxFileSize = 5 * 1024 * 1024; // 5MB max per file
    this.maxTotalCacheSize = 50 * 1024 * 1024; // 50MB total cache
    this.backgroundProgressCallbacks = new Set(); // Persistent callbacks for background updates
  }

  /**
   * Initialize the service worker
   */
  async init() {
    if ('serviceWorker' in navigator) {
      try {
        console.log('🔄 ServiceWorkerManager: Starting initialization...');
        console.log(`🔍 Current state - worker: ${this.worker ? 'exists' : 'null'}, registration: ${this.registration ? 'exists' : 'null'}`);
        
        // If already initialized and working, skip full re-initialization
        if (this.isInitialized && this.worker && this.worker === navigator.serviceWorker.controller) {
          console.log('✅ ServiceWorkerManager: Already initialized with valid controller, skipping');
          return this.registration;
        }
        
        // If we have a valid controller but haven't set up message handling, just set up handlers
        if (navigator.serviceWorker.controller && !this.isInitialized) {
          console.log('🔗 ServiceWorkerManager: Found existing controller, setting up handlers...');
          this.worker = navigator.serviceWorker.controller;
          
          // Get the registration
          this.registration = await navigator.serviceWorker.getRegistration();
          
          // Set up message listener (only once)
          if (!this.messageHandlerSet) {
            navigator.serviceWorker.addEventListener('message', this.handleMessage.bind(this));
            this.messageHandlerSet = true;
            console.log('📬 Message handler set up');
          }
          
                  // Service worker is ready - no need to test messaging for basic readiness
        console.log('✅ Service worker is ready and controlling the page');
          
          this.isInitialized = true;
          console.log('🎉 Service Worker Manager initialized successfully (reused existing)');
          return this.registration;
        }

        console.log('🔥 No existing controller found, doing full initialization...');
        
        // Only unregister if we need to do a full reset
        const existingRegistrations = await navigator.serviceWorker.getRegistrations();
        for (const registration of existingRegistrations) {
          console.log('🗑️ Unregistering existing service worker');
          await registration.unregister();
        }

        // Small delay to ensure cleanup
        await new Promise(resolve => setTimeout(resolve, 100));

        // Register service worker with cache busting
        const base = import.meta.env.BASE_URL || '/';
        const swUrl = `${base}sw.js?v=${Date.now()}`;
        
        this.registration = await navigator.serviceWorker.register(swUrl, {
          scope: base,
          updateViaCache: 'none', // Always fetch fresh service worker
          type: 'module' // ES module service worker
        });
        
        console.log('📝 Service Worker registered:', this.registration);
        
        // Wait for service worker to be ready
        await navigator.serviceWorker.ready;
        
        // Wait for the controller to be available
        await this.waitForController();
        
        // Set up message listener (only once)
        if (!this.messageHandlerSet) {
          navigator.serviceWorker.addEventListener('message', this.handleMessage.bind(this));
          this.messageHandlerSet = true;
          console.log('📬 Message handler set up');
        }
        
        // Service worker is ready and active
        console.log('✅ Service worker is ready and active');
        
        this.isInitialized = true;
        console.log('🎉 Service Worker Manager initialized successfully');
        
        return this.registration;
      } catch (error) {
        console.error('Service Worker registration failed:', error);
        throw error;
      }
    } else {
      throw new Error('Service Worker not supported in this browser');
    }
  }

  /**
   * Wait for service worker controller to be available and activated
   */
  async waitForController() {
    console.log('Waiting for service worker controller...');
    
    // Check if we already have an active controller
    if (navigator.serviceWorker.controller) {
      console.log('Service worker controller already available');
      this.worker = navigator.serviceWorker.controller;
      return;
    }

    // Check if there's an active service worker but no controller yet
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration && registration.active) {
      console.log('Service worker is active, waiting for controller...');
      
      // If there's an active service worker but no controller, 
      // we might need to reload the page or claim the client
      if (registration.active.state === 'activated') {
        this.worker = registration.active;
        
        // Try to trigger controllerchange by asking SW to claim clients
        try {
          await this.sendControlMessage('CLAIM_CLIENTS');
        } catch (error) {
          console.log('Could not send claim message, continuing...');
        }
        
        // Wait a bit for controller to be set
        await new Promise(resolve => setTimeout(resolve, 100));
        
        if (navigator.serviceWorker.controller) {
          this.worker = navigator.serviceWorker.controller;
          console.log('Service worker controller now available');
          return;
        }
      }
    }

    // If no controller, wait for the controllerchange event
    return new Promise((resolve) => {
      const handleControllerChange = () => {
        if (navigator.serviceWorker.controller) {
          console.log('Service worker controller activated via controllerchange event');
          this.worker = navigator.serviceWorker.controller;
          navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
          resolve();
        }
      };

      navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);
      
      // Also check periodically in case the event was missed
      const checkController = () => {
        if (navigator.serviceWorker.controller) {
          console.log('Service worker controller found via periodic check');
          this.worker = navigator.serviceWorker.controller;
          navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
          resolve();
        } else {
          console.log('Still waiting for service worker controller...');
          setTimeout(checkController, 500);
        }
      };
      
      // Start checking after a short delay
      setTimeout(checkController, 100);
    });
  }

  /**
   * Send a control message directly to the service worker
   */
  async sendControlMessage(type) {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration && registration.active) {
      registration.active.postMessage({ type });
    }
  }

  /**
   * Handle messages from service worker
   */
  handleMessage(event) {
    const { type, id, success, data, error } = event.data;
    
    // Handle progress updates separately
    if (type === 'PROGRESS_UPDATE') {
      // Find any pending messages that might want this progress update
      for (const [messageId, pendingMessage] of this.pendingMessages) {
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
      for (const [messageId, pendingMessage] of this.pendingMessages) {
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
                      console.error(`⏰ Message timeout for ${type} (id: ${id}) after 90 seconds`);
          this.pendingMessages.delete(id);
                      reject(new Error(`Message timeout after 90 seconds for type: ${type}. Service worker may not be responding.`));
        }
              }, 90000); // 90 second timeout for IPFS operations
    });
  }

  /**
   * Ensure the controller is current and valid
   */
  async ensureValidController() {
    // Check if current controller is still valid
    if (this.worker && this.worker === navigator.serviceWorker.controller) {
      return; // Controller is still valid
    }
    
    console.log('🔄 Controller validation failed, refreshing...');
    
    // Reset and re-establish controller
    this.worker = null;
    await this.waitForController();
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
    console.log(`🔍 Fetching directory listing from IPFS for CID: ${cid}`);
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
   * Get cached file content from localStorage
   */
  getCachedFile(cid) {
    try {
      const cacheKey = `${this.fileCachePrefix}${cid}`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const data = JSON.parse(cached);
        const now = Date.now();
        
        // Check expiry (7 days for files)
        if (data.timestamp && (now - data.timestamp) < (7 * 24 * 60 * 60 * 1000)) {
          console.log(`📦 Using cached file for CID: ${cid}`);
          // Convert base64 back to binary
          const binaryData = atob(data.content);
          const bytes = new Uint8Array(binaryData.length);
          for (let i = 0; i < binaryData.length; i++) {
            bytes[i] = binaryData.charCodeAt(i);
          }
          return bytes;
        } else {
          // Expired cache, remove it
          localStorage.removeItem(cacheKey);
        }
      }
      return null;
    } catch (error) {
      console.warn('Failed to read file cache:', error);
      return null;
    }
  }

  /**
   * Store file content in localStorage
   */
  setCachedFile(cid, content) {
    try {
      // Don't cache very large files
      if (content.length > this.maxFileSize) {
        console.log(`📦 Skipping cache for large file: ${cid} (${content.length} bytes)`);
        return;
      }

      // Check total cache size and clean up if needed
      this.cleanupFileCache();

      const cacheKey = `${this.fileCachePrefix}${cid}`;
      
      // Convert binary data to base64 for localStorage
      let binaryString = '';
      const bytes = new Uint8Array(content);
      for (let i = 0; i < bytes.length; i++) {
        binaryString += String.fromCharCode(bytes[i]);
      }
      const base64Content = btoa(binaryString);
      
      const data = {
        content: base64Content,
        timestamp: Date.now(),
        cid,
        size: content.length
      };
      
      localStorage.setItem(cacheKey, JSON.stringify(data));
      console.log(`💾 Cached file for CID: ${cid} (${content.length} bytes)`);
    } catch (error) {
      console.warn('Failed to cache file:', error);
      // If localStorage is full, try to clear old entries
      this.cleanupFileCache();
    }
  }

  /**
   * Clean up old file cache entries
   */
  cleanupFileCache() {
    try {
      const fileCacheKeys = [];
      let totalSize = 0;
      
      // Collect all file cache entries
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(this.fileCachePrefix)) {
          try {
            const data = JSON.parse(localStorage.getItem(key));
            fileCacheKeys.push({
              key,
              timestamp: data.timestamp || 0,
              size: data.size || 0
            });
            totalSize += data.size || 0;
          } catch (e) {
            // Invalid cache entry, remove it
            localStorage.removeItem(key);
          }
        }
      }
      
      // If total size exceeds limit, remove oldest entries
      if (totalSize > this.maxTotalCacheSize) {
        fileCacheKeys.sort((a, b) => a.timestamp - b.timestamp);
        
        while (totalSize > this.maxTotalCacheSize && fileCacheKeys.length > 0) {
          const oldest = fileCacheKeys.shift();
          localStorage.removeItem(oldest.key);
          totalSize -= oldest.size;
          console.log(`🧹 Removed old file cache entry: ${oldest.key}`);
        }
      }
    } catch (error) {
      console.warn('Failed to cleanup file cache:', error);
    }
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
        
        if (pairs.length === 0) {
          throw new Error('No matching XML pairs found (looking for *_files.xml and *_meta.xml)');
        }
        
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
      
      if (pairs.length === 0) {
        throw new Error('No matching XML pairs found (looking for *_files.xml and *_meta.xml)');
      }
      
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
      const targetPair = pairs.find(pair => pair.baseName === baseName);
      if (!targetPair) {
        throw new Error(`Item "${baseName}" not found in the directory`);
      }
      
      // Fetch only the two XML files for this specific item using existing message types
      onProgress?.({ step: 'retrieve_files', message: `Fetching XML files for ${baseName}...` });
      
      const [filesXmlContent, metaXmlContent] = await Promise.all([
        fetch(`ipfs-sw/${targetPair.filesXml.cid}?filename=${targetPair.filesXml.name}`).then(r => r.text()),
        fetch(`ipfs-sw/${targetPair.metaXml.cid}?filename=${targetPair.metaXml.name}`).then(r => r.text())
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
      let fileCount = 0;
      let fileSize = 0;
      const oldestEntry = { timestamp: Date.now(), cid: null };
      const newestEntry = { timestamp: 0, cid: null };
      

      
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith(this.cachePrefix) || key.startsWith(this.fileCachePrefix))) {
          const value = localStorage.getItem(key);
          if (value) {
            try {
              const data = JSON.parse(value);
              
              if (key.startsWith(this.cachePrefix)) {
                // Directory cache
                directoryCount++;
                directorySize += value.length;
              } else if (key.startsWith(this.fileCachePrefix)) {
                // File cache
                fileCount++;
                fileSize += value.length;
              }
              
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
        files: {
          count: fileCount,
          sizeBytes: fileSize,
          sizeKB: Math.round(fileSize / 1024)
        },
        total: {
          count: directoryCount + fileCount,
          sizeBytes: directorySize + fileSize,
          sizeKB: Math.round((directorySize + fileSize) / 1024)
        },
        oldestEntry: oldestEntry.cid ? oldestEntry : null,
        newestEntry: newestEntry.cid ? newestEntry : null
      };
    } catch (error) {
      console.warn('Failed to get cache stats:', error);
      return { 
        directories: { count: 0, sizeBytes: 0, sizeKB: 0 },
        files: { count: 0, sizeBytes: 0, sizeKB: 0 },
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