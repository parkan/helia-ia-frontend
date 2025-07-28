import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { serviceWorkerManager } from '../serviceWorkerManager';
import { parseXML, extractMetadata, extractFilesInfo } from '../xmlParser';
import { ipfsUrl } from '../utils/ipfsUrl';

// Type definitions for Home component
interface ProgressState {
  step: string;
  message: string;
}

interface FileItem {
  name: string;
  size: number;
  cid: string;
  [key: string]: any;
}

interface Results {
  originalFiles: FileItem[];
  [key: string]: any;
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

interface BackgroundProgressItem {
  [key: string]: any;
}

interface ItemThumbnails {
  [baseName: string]: string;
}

export default function Home(): React.ReactElement {
  console.log('🟢 Home component rendering');
  
  const navigate = useNavigate();
  const [cid, setCid] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [progress, setProgress] = useState<ProgressState>({ step: '', message: '' });
  const [results, setResults] = useState<Results | null>(null);
  const [error, setError] = useState<string>('');
  const [isServiceWorkerReady, setIsServiceWorkerReady] = useState<boolean>(false);
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [backgroundProgress, setBackgroundProgress] = useState<BackgroundProgressItem[]>([]);
  const [itemThumbnails, setItemThumbnails] = useState<ItemThumbnails>({}); // Map of baseName -> thumbnail URL

  // Debug logging for state changes
  console.log(`🔍 HOME DEBUG - CID: "${cid}", Results: ${results ? `${results.processedContent?.length || 0} items` : 'null'}, Loading: ${isLoading}`);

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
      console.log(`🔍 BACKGROUND: Received ${progressData.type}`);
      
      // Update the originalFiles when subdirectory files are found (needed for thumbnail CIDs)
      if (progressData.type === 'SUBDIRECTORY_FILES_FOUND' && progressData.files) {
        console.log(`📁 Adding ${progressData.files.length} subdirectory files to originalFiles`);
        console.log(`🔍 Files from ${progressData.subdirectory}:`, progressData.files.map(f => f.name));
        
        setResults(prev => {
          if (!prev) return prev;
          
          const updatedOriginalFiles = [...prev.originalFiles, ...progressData.files];
          console.log(`📊 Total originalFiles count: ${updatedOriginalFiles.length}`);
          
          return {
            ...prev,
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
      // Only auto-load if we don't already have processed content for this CID
      const hasProcessedContent = results && results.processedContent && results.processedContent.length > 0;
      
      console.log(`🔍 AUTO-LOAD DEBUG - SW Ready: ${isServiceWorkerReady}, CID: "${cid}", Has Processed: ${hasProcessedContent}, Loading: ${isLoading}`);
      
      if (isServiceWorkerReady && cid && !hasProcessedContent && !isLoading) {
        try {
          // Check if this CID is already cached
          const cachedData = serviceWorkerManager.getCachedDirectoryListing(cid);
          if (cachedData) {
            console.log(`🔄 AUTO-LOAD: CID ${cid} found in cache, triggering auto-loading...`);
            await handleSubmit({ preventDefault: () => {} }); // Simulate form submission
          } else {
            console.log(`🔍 AUTO-LOAD: CID ${cid} not found in cache, skipping auto-load`);
          }
        } catch (error) {
          console.error('Error checking cache or auto-loading:', error);
        }
      } else {
        console.log(`🔍 AUTO-LOAD: Skipping auto-load due to conditions`);
      }
    };

    autoLoadCachedContent();
  }, [isServiceWorkerReady, cid, results]);

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

    // Check if we already have processed content for this CID
    console.log(`🔍 SUBMIT DEBUG - CID: "${cid}", Results exists: ${!!results}, Processed content: ${results?.processedContent?.length || 0}`);
    if (results && results.processedContent && results.processedContent.length > 0) {
      console.log(`🚀 Already have processed content for CID: ${cid} (${results.processedContent.length} items)`);
      setProgress({ step: 'complete', message: `✅ Already loaded ${results.processedContent.length} items!` });
      return;
    }
    
    console.log(`🔄 SUBMIT DEBUG - Proceeding with processing because: Results: ${!!results}, Processed: ${results?.processedContent?.length || 0}`);

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
      
      // Step 2: Initialize results immediately and populate progressively
      setProgress({ step: 'fetch_meta', message: `Found ${data.pairs.length} items! Loading metadata progressively...` });
      
      // 🚀 PROGRESSIVE LOADING: Initialize results with empty processed content
      setResults({
        originalFiles: data.originalFiles,
        pairs: data.pairs,
        processedContent: [] // Start empty, will be populated progressively
      });
      
      // 🔄 Fetch metadata progressively and update results as we go
      const processedItems = [];
      
      for (let i = 0; i < data.pairs.length; i++) {
        const pair = data.pairs[i];
        try {
          console.log(`🔄 PROGRESS: Processing item ${i + 1}/${data.pairs.length}: ${pair.baseName}`);
          setProgress({ 
            step: 'fetch_meta', 
            message: `Loading metadata: ${pair.baseName}... (${i + 1}/${data.pairs.length})` 
          });
          
          // Fetch both meta.xml and files.xml for this item
          const [metaResponse, filesResponse] = await Promise.all([
            fetch(ipfsUrl(`ipfs-sw/${pair.metaXml.cid}?filename=${pair.metaXml.name}`)),
            fetch(ipfsUrl(`ipfs-sw/${pair.filesXml.cid}?filename=${pair.filesXml.name}`))
          ]);
          
          const metaXmlContent = await metaResponse.text();
          const filesXmlContent = await filesResponse.text();
          
          // Parse metadata
          const parsedMeta = parseXML(metaXmlContent);
          const metadata = extractMetadata(parsedMeta);
          
          // Parse files and look for thumbnails
          const parsedFiles = parseXML(filesXmlContent);
          const filesInfo = extractFilesInfo(parsedFiles);
          
          // Look for thumbnail files (avoiding __ia_thumb*.jpg which get clobbered in merged items)
          console.log(`🔍 THUMBNAIL SEARCH for ${pair.baseName}:`);
          console.log(`📋 Available files:`, filesInfo.map(f => f.name));
          
          // First, look for .thumbs directory files and take the 2nd one (index 1)
          const thumbsFiles = filesInfo.filter(file => 
            file.name && file.name.includes('.thumbs/') && file.name.includes('.jpg')
          ).sort((a, b) => a.name.localeCompare(b.name)); // Sort to ensure consistent order
          
          let thumbnailFile = null;
          
          if (thumbsFiles.length >= 2) {
            thumbnailFile = thumbsFiles[1]; // Take 2nd file (index 1)
            console.log(`🖼️ Found .thumbs directory with ${thumbsFiles.length} files, using 2nd: ${thumbnailFile.name}`);
          } else if (thumbsFiles.length === 1) {
            thumbnailFile = thumbsFiles[0]; // Fallback to 1st if only one
            console.log(`🖼️ Found .thumbs directory with only 1 file, using: ${thumbnailFile.name}`);
          } else {
            // Fallback: look for other thumbnail patterns
            thumbnailFile = filesInfo.find(file => {
              if (!file.name) return false;
              
              const hasThumbJpg = file.name.includes('_thumb.jpg');
              const hasThumbnail = file.name.includes('thumbnail');
              const hasThumbAndJpg = file.name.includes('thumb') && file.name.includes('.jpg');
              const isNotIaThumb = !file.name.includes('__ia_thumb');
              
              const matches = (
                (hasThumbJpg && isNotIaThumb) ||
                (hasThumbnail && file.name.includes('.jpg') && isNotIaThumb) ||
                (hasThumbAndJpg && isNotIaThumb)
              );
              
              return matches;
            });
            
            if (thumbnailFile) {
              console.log(`🖼️ Found fallback thumbnail: ${thumbnailFile.name}`);
            } else {
              console.log(`❌ No thumbnail found for ${pair.baseName}`);
            }
          }
          
          if (thumbnailFile) {
            console.log(`🖼️ Found thumbnail for ${pair.baseName}: ${thumbnailFile.name}`);
            // Use root CID + path for UnixFS directory access
            const thumbnailUrl = ipfsUrl(`ipfs-sw/${cid}/${thumbnailFile.name}?filename=${encodeURIComponent(thumbnailFile.name)}`);
            console.log(`🔗 Setting thumbnail URL for ${pair.baseName}: ${thumbnailUrl}`);
            
            setItemThumbnails(prev => ({
              ...prev,
              [pair.baseName]: thumbnailUrl
            }));
          }
          
          const newItem = {
            baseName: pair.baseName,
            metadata: metadata,
            // Store the pair info for later use on detail page
            pair: pair
          };
          
          processedItems.push(newItem);
          console.log(`✅ PROGRESS: Processed ${processedItems.length} items so far`);
          
          // 🎯 PROGRESSIVE UPDATE: Update results immediately with new item
          // Use setTimeout to break out of React batching and force immediate update
          await new Promise<void>(resolve => {
            setTimeout(() => {
              setResults(prev => ({
                ...prev,
                processedContent: [...processedItems] // Update with current items
              }));
              console.log(`🔄 PROGRESS: UI updated with ${processedItems.length} items`);
              resolve();
            }, 10); // Small delay to force React to flush the update
          });
          
        } catch (error) {
          console.error(`Error processing metadata for ${pair.baseName}:`, error);
          // Fallback to filename-based info
          const fallbackItem = {
            baseName: pair.baseName,
            metadata: {
              title: pair.baseName.replace(/[_-]/g, ' '),
              identifier: pair.baseName,
              creator: null
            },
            pair: pair,
            error: error.message
          };
          
          processedItems.push(fallbackItem);
          console.log(`⚠️ PROGRESS: Fallback item created for ${pair.baseName}`);
          
          // 🎯 PROGRESSIVE UPDATE: Update results with fallback item too
          await new Promise<void>(resolve => {
            setTimeout(() => {
              setResults(prev => ({
                ...prev,
                processedContent: [...processedItems]
              }));
              console.log(`🔄 PROGRESS: UI updated with ${processedItems.length} items (including fallback)`);
              resolve();
            }, 10);
          });
        }
      }

      setProgress({ step: 'complete', message: `✅ All ${processedItems.length} items loaded!` });



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

  console.log('🟢 Home component about to return JSX');

  return (
    <div className="min-h-screen">
      <div className="py-8">
        <div className="max-w-6xl mx-auto px-4">
        <div className="archive-container rounded-lg overflow-hidden">
          {/* Header Bar */}
          <div className="bg-black py-6 px-8 flex items-center justify-center relative">
            <div className="absolute left-8 flex items-center space-x-6">
                          <img 
              src={ipfsUrl("ia.png")} 
              alt="Internet Archive" 
              className="h-12 object-contain"
            />
            <img 
              src={ipfsUrl("ffdw.png")} 
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
                      Cache: {cacheStats.directories.count} dirs ({cacheStats.total.sizeKB}KB)
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
                      console.log(`🗂️ Available thumbnails:`, Object.keys(itemThumbnails));
                      console.log(`📄 Item details:`, { baseName: item.baseName, pair: item.pair });
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
                                  e.target.src = "./archive.png";
                                  e.target.alt = "Internet Archive";
                                }}
                              />
                            ) : (
                              <img 
                                src={ipfsUrl("archive.png")} 
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