import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { serviceWorkerManager } from '../../utils/serviceWorkerManager';
import { parseXML, extractMetadata } from '../../utils/xmlParser';

export default function Home() {
  const navigate = useNavigate();
  const [cid, setCid] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState({ step: '', message: '' });
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const [isServiceWorkerReady, setIsServiceWorkerReady] = useState(false);
  const [cacheStats, setCacheStats] = useState(null);
  const [backgroundProgress, setBackgroundProgress] = useState([]);
  const [itemThumbnails, setItemThumbnails] = useState({}); // Map of baseName -> thumbnail URL

  // Initialize service worker and handle URL fragments on component mount
  useEffect(() => {
    initializeServiceWorker();
    
    // Handle URL fragment for CID
    if (typeof window !== 'undefined') {
      const hash = window.location.hash.slice(1); // Remove the '#'
      if (hash) {
        setCid(hash);
      }
    }

    // Handle browser back/forward navigation
    const handleHashChange = () => {
      const newHash = window.location.hash.slice(1);
      setCid(newHash);
    };

    window.addEventListener('hashchange', handleHashChange);

    // Set up persistent background progress callback for thumbnails
    const backgroundProgressHandler = (progressData) => {
      console.log('🚀 FRONTEND: Entered background_processing branch!', progressData);
      // Handle background subdirectory processing updates
      const timestamp = new Date().toLocaleTimeString();
      setBackgroundProgress(prev => [...prev, {
        timestamp,
        type: progressData.type,
        message: progressData.message,
        subdirectory: progressData.subdirectory,
        files: progressData.files,
        error: progressData.error
      }]);

      // CRITICAL: Also integrate newly discovered files into the main results
      if (progressData.type === 'SUBDIRECTORY_FILES_FOUND' && progressData.files) {
        console.log(`🔍 Processing subdirectory: ${progressData.subdirectory}`);
        console.log(`📁 Files found:`, progressData.files.map(f => f.name));
        
        // Check if this is a .thumbs directory and extract thumbnail
        if (progressData.subdirectory && progressData.subdirectory.endsWith('.thumbs')) {
          console.log(`🎯 Detected .thumbs directory: ${progressData.subdirectory}`);
          const identifier = progressData.subdirectory.replace('.thumbs', '');
          console.log(`🔍 Looking for identifier: ${identifier}`);
          
          const expectedThumbnailName = `${progressData.subdirectory}/${identifier}_master.intros_000001.jpg`;
          console.log(`🔍 Expected thumbnail file: ${expectedThumbnailName}`);
          
          const thumbnailFile = progressData.files.find(file => {
            console.log(`🔍 Checking file: ${file.name} vs ${expectedThumbnailName}`);
            return file.name === expectedThumbnailName;
          });
          
          if (thumbnailFile) {
            console.log(`🖼️ Found thumbnail for ${identifier}: ${thumbnailFile.name} (CID: ${thumbnailFile.cid})`);
            const thumbnailUrl = `/ipfs-sw/${thumbnailFile.cid}?filename=${encodeURIComponent(thumbnailFile.name)}`;
            console.log(`🔗 Generated thumbnail URL: ${thumbnailUrl}`);
            setItemThumbnails(prev => {
              const updated = {
                ...prev,
                [identifier]: thumbnailUrl
              };
              console.log(`🖼️ Updated thumbnails state:`, updated);
              return updated;
            });
          } else {
            console.log(`❌ No thumbnail found for ${identifier} in ${progressData.subdirectory}`);
            console.log(`📋 Available files:`, progressData.files.map(f => f.name));
          }
        }

        setResults(prevResults => {
          if (!prevResults) return prevResults;
          
          // Add the new files to originalFiles array
          const updatedOriginalFiles = [...prevResults.originalFiles, ...progressData.files];
          
          console.log(`🔄 Integrating ${progressData.files.length} files from ${progressData.subdirectory} into main results`);
          
          // Update cache with new files
          serviceWorkerManager.setCachedDirectoryListing(cid, updatedOriginalFiles);
          
          return {
            ...prevResults,
            originalFiles: updatedOriginalFiles
          };
        });
      }
    };

    // Register the background progress handler
    if (serviceWorkerManager) {
      serviceWorkerManager.addBackgroundProgressCallback(backgroundProgressHandler);
    }

    // Cleanup: remove the callback when component unmounts
    return () => {
      if (serviceWorkerManager) {
        serviceWorkerManager.removeBackgroundProgressCallback(backgroundProgressHandler);
      }
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, [cid]); // Include cid as dependency since we use it in the callback

  // Auto-load cached content when service worker is ready and CID is set
  useEffect(() => {
    const autoLoadCachedContent = async () => {
      if (isServiceWorkerReady && cid && !results && !isLoading) {
        try {
          // Check if this CID is already cached
          const cachedData = serviceWorkerManager.getCachedDirectoryListing(cid);
          if (cachedData) {
            console.log(`CID ${cid} found in cache, auto-loading...`);
            await handleSubmit({ preventDefault: () => {} }); // Simulate form submission
          }
        } catch (error) {
          console.error('Error checking cache or auto-loading:', error);
        }
      }
    };

    autoLoadCachedContent();
  }, [isServiceWorkerReady, cid]);

  // Update URL fragment when CID changes
  useEffect(() => {
    if (typeof window !== 'undefined' && cid) {
      // Only update if it's different from current hash to avoid infinite loops
      const currentHash = window.location.hash.slice(1);
      if (currentHash !== cid) {
        // Use pushState to create a new history entry when navigating to a different CID
        // This ensures back button works as expected
        window.history.pushState(null, null, `#${cid}`);
      }
    } else if (typeof window !== 'undefined' && !cid && window.location.hash) {
      // Clear the hash if CID is empty
      window.history.pushState(null, null, window.location.pathname);
    }
  }, [cid]);

  // Update document title
  useEffect(() => {
    document.title = 'IPFS Media Browser';
  }, []);

  const initializeServiceWorker = async () => {
    try {
      if (!serviceWorkerManager.constructor.isSupported()) {
        throw new Error('Service Worker not supported in this browser');
      }

      await serviceWorkerManager.init();
      setIsServiceWorkerReady(true);
    } catch (error) {
      console.error('Failed to initialize service worker:', error);
      setError(`Service Worker initialization failed: ${error.message}`);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!cid.trim()) {
      setError('Please enter a CID');
      return;
    }

    if (!isServiceWorkerReady) {
      setError('Service Worker not ready. Please wait or refresh the page.');
      return;
    }

    setIsLoading(true);
    setError('');
    setResults(null);
    setProgress({ step: '', message: '' });
    setItemThumbnails({}); // Clear thumbnails from previous search

    try {
      // Step 1: Get directory listing and pairs only
      setProgress({ step: 'listing', message: 'Getting directory listing...' });
      setBackgroundProgress([]); // Reset background progress
      
      const data = await serviceWorkerManager.getItemListing(cid, (progressData) => {
        if (progressData.step === 'directory_listing') {
          setProgress({ 
            step: 'directory_listing', 
            message: progressData.message,
            entriesFound: progressData.entriesFound,
            stage: progressData.stage
          });
        } else {
          setProgress(progressData);
        }
      });
      
      // Step 2: Fetch only meta.xml files for card display
      setProgress({ step: 'fetch_meta', message: `Fetching metadata for ${data.pairs.length} items...` });
      const processedItems = [];
      
      for (let i = 0; i < data.pairs.length; i++) {
        const pair = data.pairs[i];
        try {
          setProgress({ 
            step: 'fetch_meta', 
            message: `Fetching metadata for ${pair.baseName}... (${i + 1}/${data.pairs.length})` 
          });
          
          // Fetch only the meta.xml file
          const response = await fetch(`/ipfs-sw/${pair.metaXml.cid}?filename=${pair.metaXml.name}`);
          const metaXmlContent = await response.text();
          
          // Parse only the metadata (no files info needed for cards)
          const parsedMeta = parseXML(metaXmlContent);
          const metadata = extractMetadata(parsedMeta);
          
          processedItems.push({
            baseName: pair.baseName,
            metadata: metadata,
            // Store the pair info for later use on detail page
            pair: pair
          });
        } catch (error) {
          console.error(`Error processing metadata for ${pair.baseName}:`, error);
          // Fallback to filename-based info
          processedItems.push({
            baseName: pair.baseName,
            metadata: {
              title: pair.baseName.replace(/[_-]/g, ' '),
              identifier: pair.baseName,
              creator: null
            },
            pair: pair,
            error: error.message
          });
        }
      }

      setProgress({ step: 'complete', message: 'Metadata loaded successfully!' });
      
      setResults({
        originalFiles: data.originalFiles,
        pairs: data.pairs,
        processedContent: processedItems
      });

      // TEMP: Add a test thumbnail to verify the thumbnail system works
      if (processedItems.length > 0) {
        console.log(`🧪 TEST: Adding test thumbnail for first item: ${processedItems[0].baseName}`);
        setItemThumbnails(prev => ({
          ...prev,
          [processedItems[0].baseName]: '/archive.png' // Use archive.png as test thumbnail
        }));
      }

      // Update cache stats after successful operation
      const updatedStats = serviceWorkerManager.getCacheStats();
      setCacheStats(updatedStats);

    } catch (error) {
      console.error('Error processing CID:', error);
      setError(`Error: ${error.message}`);
    } finally {
      setIsLoading(false);
      setProgress({ step: '', message: '' });
    }
  };

  const navigateToDownload = (baseName) => {
    navigate(`/download/${encodeURIComponent(baseName)}?cid=${encodeURIComponent(cid)}`);
  };

  return (
    <div className="min-h-screen">
      <div className="py-8">
        <div className="max-w-6xl mx-auto px-4">
        <div className="archive-container rounded-lg overflow-hidden">
          {/* Header Bar */}
          <div className="bg-black py-6 px-8 flex items-center justify-center relative">
            <div className="absolute left-8 flex items-center space-x-6">
              <img 
                src="/ia.png" 
                alt="Internet Archive" 
                className="h-12 object-contain"
              />
              <img 
                src="/ffdw.png" 
                alt="Freedom of the Press Foundation" 
                className="h-12 object-contain"
              />
            </div>
            <div className="text-white text-xl font-bold">
              IPFS Media Browser
            </div>
          </div>
          
          <div className="p-8">

          <div className="mb-6">
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-200">
              <div className="flex items-center space-x-6">
                <div className="flex items-center space-x-3">
                  <div className={`w-3 h-3 rounded-full ${isServiceWorkerReady ? 'bg-green-500' : 'bg-red-500'}`}></div>
                  <span className={`archive-metadata ${isServiceWorkerReady ? 'text-green-600' : 'text-red-600'}`}>
                    Service Worker: {isServiceWorkerReady ? 'Ready' : 'Not Ready'}
                  </span>
                </div>
                {cacheStats && cacheStats.total.count > 0 && (
                  <div className="flex items-center space-x-2">
                    <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                    <span className="archive-metadata text-blue-600">
                      Cache: {cacheStats.directories.count} dirs, {cacheStats.files.count} files ({cacheStats.total.sizeKB}KB)
                    </span>
                  </div>
                )}
              </div>
              <div className="flex items-center space-x-2">
                {cacheStats && cacheStats.count > 0 && (
                  <button
                    onClick={() => {
                      const cleared = serviceWorkerManager.clearDirectoryCache();
                      setCacheStats(serviceWorkerManager.getCacheStats());
                      setError(`Cleared ${cleared} cached directories`);
                      setTimeout(() => setError(''), 3000);
                    }}
                    className="px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                    title="Clear directory cache"
                  >
                    Clear Cache
                  </button>
                )}
                <button
                  onClick={() => serviceWorkerManager.forceClearAndReload()}
                  className="px-3 py-1 text-xs bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
                  title="Clear service worker cache and reload"
                >
                  Force Reload SW
                </button>
              </div>
            </div>
            
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label htmlFor="cid" className="block font-medium mb-3" style={{color: 'var(--archive-text)'}}>
                  Browse IPFS Content (CID):
                </label>
                <input
                  type="text"
                  id="cid"
                  value={cid}
                  onChange={(e) => setCid(e.target.value)}
                  placeholder="Enter CID (e.g., bafybeick43ir6cxobbeb4yonfrqw4kmt5srqphe3z6jwfw44ccqc5tdwsy)"
                  className="w-full px-4 py-3 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  style={{borderColor: 'var(--archive-border)'}}
                  disabled={isLoading}
                />
              </div>
              
              <button
                type="submit"
                disabled={isLoading || !isServiceWorkerReady}
                className="archive-button w-full py-3 px-6 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Loading...' : 'Browse Content'}
              </button>
            </form>
          </div>

          {progress.message && (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
              <div className="flex items-center space-x-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                <span className="text-blue-800">
                  {progress.message}
                  {progress.entriesFound && (
                    <span className="ml-2 text-blue-600 font-medium">
                      ({progress.entriesFound} entries)
                    </span>
                  )}
                </span>
              </div>
            </div>
          )}

          {backgroundProgress.length > 0 && (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-md">
              <div className="flex items-center space-x-2 mb-2">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-green-800 font-medium">Background Processing</span>
              </div>
              <div className="max-h-32 overflow-y-auto space-y-1">
                {backgroundProgress.slice(-5).map((update, idx) => (
                  <div key={idx} className="text-sm text-green-700">
                    <span className="text-green-600">[{update.timestamp}]</span> {update.message}
                    {update.error && <span className="text-red-600 ml-2">Error: {update.error}</span>}
                  </div>
                ))}
                {backgroundProgress.length > 5 && (
                  <div className="text-xs text-green-600 italic">
                    ...and {backgroundProgress.length - 5} more updates
                  </div>
                )}
              </div>
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-red-800">{error}</p>
            </div>
          )}

          {results && (
            <div className="space-y-6">
              <div className="bg-green-50 border border-green-200 rounded p-4" style={{backgroundColor: '#f0f8f0', borderColor: 'var(--archive-green)'}}>
                <h3 className="font-semibold mb-2" style={{color: 'var(--archive-green)'}}>Content Loaded Successfully!</h3>
                <p className="archive-metadata" style={{color: 'var(--archive-green)'}}>
                  Found {results.originalFiles.length} total files, 
                  {results.pairs.length} media items with metadata loaded.
                </p>
              </div>

              <div className="space-y-6">
                <h2 className="text-2xl font-bold" style={{color: 'var(--archive-text)'}}>Media Items</h2>

                {results.processedContent.length === 0 ? (
                  <div className="text-center py-12 archive-metadata">
                    <p className="text-lg mb-2">No media items found in this CID.</p>
                    <p className="text-sm">This browser looks for items with metadata and file information.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {results.processedContent.map((item, index) => {
                      const thumbnailUrl = itemThumbnails[item.baseName];
                      console.log(`🖼️ Rendering card for ${item.baseName}, thumbnail URL: ${thumbnailUrl}`);
                      return (
                        <div 
                          key={index} 
                          className="archive-card p-5 hover:shadow-lg transition-shadow duration-200 cursor-pointer"
                          onClick={() => navigateToDownload(item.baseName)}
                        >
                          {/* Archive Logo or Thumbnail */}
                          <div className="w-full h-32 mb-4 flex items-center justify-center p-4 bg-gray-100 rounded">
                            {thumbnailUrl ? (
                              <img 
                                src={thumbnailUrl} 
                                alt={`Thumbnail for ${item.metadata.title}`}
                                className="max-w-full max-h-full object-contain rounded"
                                onError={(e) => {
                                  // Fallback to archive logo if thumbnail fails to load
                                  e.target.src = "/archive.png";
                                  e.target.alt = "Internet Archive";
                                }}
                              />
                            ) : (
                              <img 
                                src="/archive.png" 
                                alt="Internet Archive"
                                className="max-w-full max-h-full object-contain"
                              />
                            )}
                          </div>

                          {/* Title */}
                          <h3 className="font-bold text-base mb-2 line-clamp-2 min-h-[3rem]" 
                              style={{color: 'var(--archive-text)'}}
                              title={item.metadata.title}>
                            {item.metadata.title}
                          </h3>

                          {/* Creator/Uploader */}
                          <div className="archive-metadata text-sm mb-4">
                            {item.metadata.creator ? (
                              <p>by <span className="font-medium">{item.metadata.creator}</span></p>
                            ) : (
                              <p>by <span className="font-medium">Unknown</span></p>
                            )}
                          </div>

                          {/* Action Button */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigateToDownload(item.baseName);
                            }}
                            className="w-full px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
                            title="Browse and view files from this item"
                          >
                            Browse & View Files
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
    </div>
    </div>
  );
} 