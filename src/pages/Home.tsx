import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { serviceWorkerManager } from '../serviceWorkerManager';
import { parseXML, extractMetadata, extractFilesInfo } from '../xmlParser';
// @ts-ignore - ipfsUrl.js doesn't have types but works fine
import { ipfsUrl } from '../utils/ipfsUrl';

// Type definitions for Home component
interface ProgressState {
  step: string;
  message: string;
}

interface ServiceWorkerProgressData {
  step?: string;
  type?: string;
  message?: string;
  entriesFound?: number;
  [key: string]: any;
}

interface ItemListingData {
  originalFiles: FileItem[];
  pairs: any[];
}

interface ProcessedItem {
  baseName: string;
  metadata: any;
  pair: any;
  error?: string;
  filesInfo?: any[];
}

type ItemCategory = 'Videos' | 'Documents' | 'Photos' | 'Other';

interface CategorizedItems {
  Videos: ProcessedItem[];
  Documents: ProcessedItem[];
  Photos: ProcessedItem[];
  Other: ProcessedItem[];
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



interface ItemThumbnails {
  [baseName: string]: string;
}

export default function Home(): React.ReactElement {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [cid, setCid] = useState<string>(''); // The active CID we're viewing
  const [inputCid, setInputCid] = useState<string>(''); // The CID in the input field
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [progress, setProgress] = useState<ProgressState>({ step: '', message: '' });
  const [results, setResults] = useState<Results | null>(null);
  const [error, setError] = useState<string>('');
  const [isServiceWorkerReady, setIsServiceWorkerReady] = useState<boolean>(false);
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);

  const [itemThumbnails, setItemThumbnails] = useState<ItemThumbnails>({}); // Map of baseName -> thumbnail URL
  const [categorizedView, setCategorizedView] = useState<boolean>(false); // Toggle for categorized vs list view

  // Categorization function - determines item category based on file types
  const categorizeItem = (item: ProcessedItem): ItemCategory => {
    // Extract files from the item's filesInfo (from XML parsing) or pair data as fallback
    const files = item.filesInfo || item.pair?.files || [];
    
    // Check for video formats (common video extensions)
    const hasVideo = files.some((file: any) => {
      const name = file.name?.toLowerCase() || '';
      return name.match(/\.(mp4|avi|mov|wmv|flv|webm|mkv|m4v|3gp|ogv)$/);
    });
    
    if (hasVideo) return 'Videos';
    
    // Check for PDF documents
    const hasPDF = files.some((file: any) => {
      const name = file.name?.toLowerCase() || '';
      return name.endsWith('.pdf');
    });
    
    if (hasPDF) return 'Documents';
    
    // Check for image formats
    const hasImages = files.some((file: any) => {
      const name = file.name?.toLowerCase() || '';
      return name.match(/\.(jpg|jpeg|png|gif|bmp|tiff|svg|webp)$/);
    });
    
    if (hasImages) return 'Photos';
    
    // Default to Other
    return 'Other';
  };

  // Function to organize items by category
  const categorizeItems = (items: ProcessedItem[]): CategorizedItems => {
    const categorized: CategorizedItems = {
      Videos: [],
      Documents: [],
      Photos: [],
      Other: []
    };
    
    items.forEach(item => {
      const category = categorizeItem(item);
      categorized[category].push(item);
    });
    
    return categorized;
  };



  // Initialize service worker on mount
  useEffect(() => {
    initializeServiceWorker();
  }, []); // Only run once on mount

  // Simple URL → State sync: When URL changes, update CID
  useEffect(() => {
    const cidFromQuery = searchParams.get('cid') || '';
    if (cidFromQuery !== cid) {
      setCid(cidFromQuery);
    }
  }, [searchParams]);

  // Auto-load data when service worker is ready and CID is set
  useEffect(() => {
    const needsData = isServiceWorkerReady && cid && !isLoading && 
                     (!results || results.cid !== cid);
    
    if (needsData) {
      processData(cid);
    }
  }, [isServiceWorkerReady, cid]);

  // URL is updated explicitly when form is submitted, not automatically

  // Update document title
  useEffect(() => {
    document.title = 'IPFS Media Browser';
  }, []);

  // Sync inputCid with cid when cid changes (e.g., from navigation)
  useEffect(() => {
    setInputCid(cid);
  }, [cid]);

  const initializeServiceWorker = async () => {
    try {
      // @ts-ignore - isSupported method exists at runtime
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

  // Core data processing function (can be called from form submit or auto-load)
  const processData = async (cidToProcess: string) => {
    if (!isServiceWorkerReady) {
      setError('Service Worker not ready. Please wait or refresh the page.');
      return;
    }

    // Check if we already have processed content for this CID
    if (results && results.processedContent && results.processedContent.length > 0 && results.cid === cidToProcess) {
      setProgress({ step: 'complete', message: `Already loaded ${results.processedContent.length} items!` });
      return;
    }

    setIsLoading(true);
    setError('');
    setProgress({ step: '', message: '' });
    // Don't clear results or thumbnails - let React preserve state naturally

    try {
      // Step 1: Get directory listing and pairs only
      setProgress({ step: 'listing', message: 'Getting directory listing...' });
  
      
      // @ts-ignore - ServiceWorker callback typing is complex, but this works
      const data = await serviceWorkerManager.getItemListing(cidToProcess, (progressData: ServiceWorkerProgressData) => {
        if (progressData.step === 'directory_listing') {
          setProgress({ 
            step: 'directory_listing', 
            message: progressData.message || ''
          });
        } else {
          setProgress({
            step: progressData.step || '',
            message: progressData.message || ''
          });
        }
      }) as ItemListingData;
      
      // Step 2: Initialize results immediately and populate progressively
      setProgress({ step: 'fetch_meta', message: `Found ${data.pairs.length} items! Loading metadata progressively...` });
      
      // 🚀 PROGRESSIVE LOADING: Initialize results with empty processed content
      setResults({
        cid: cidToProcess, // Track which CID these results are for
        originalFiles: data.originalFiles,
        pairs: data.pairs,
        processedContent: [] // Start empty, will be populated progressively
      });
      
      // 🔄 Fetch metadata progressively and update results as we go
      const processedItems: ProcessedItem[] = [];
      
      for (let i = 0; i < data.pairs.length; i++) {
        const pair = data.pairs[i];
        try {
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
          let thumbnailFile = null;
          
          // Check if we already have a thumbnail for this item
          if (!itemThumbnails[pair.baseName]) {
          
            // First, look for .thumbs directory files and take the 2nd one (index 1)
            const thumbsFiles = filesInfo.filter(file => 
              file.name && file.name.includes('.thumbs/') && file.name.includes('.jpg')
            ).sort((a, b) => a.name.localeCompare(b.name)); // Sort to ensure consistent order
          
          if (thumbsFiles.length >= 2) {
            thumbnailFile = thumbsFiles[1]; // Take 2nd file (index 1)
          } else if (thumbsFiles.length === 1) {
            thumbnailFile = thumbsFiles[0]; // Fallback to 1st if only one
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
            
          }
          
            if (thumbnailFile) {
              // Use root CID + path for UnixFS directory access
              const thumbnailUrl = ipfsUrl(`ipfs-sw/${cidToProcess}/${thumbnailFile.name}?filename=${encodeURIComponent(thumbnailFile.name)}`);
              
              setItemThumbnails(prev => ({
                ...prev,
                [pair.baseName]: thumbnailUrl
              }));
            }
          }
          
          const newItem = {
            baseName: pair.baseName,
            metadata: metadata,
            // Store the pair info for later use on detail page
            pair: pair,
            // Store files info for categorization
            filesInfo: filesInfo
          };
          
          processedItems.push(newItem);
          
          // Progressive update: Update results immediately with new item
          // Use setTimeout to break out of React batching and force immediate update
          await new Promise<void>(resolve => {
                      setTimeout(() => {
            // @ts-ignore - Complex Results type update, but this works correctly
            setResults(prev => ({
              ...prev,
              processedContent: [...processedItems] // Update with current items
            }));
            resolve();
          }, 10); // Small delay to force React to flush the update
          });
          
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          console.error(`Error processing metadata for ${pair.baseName}:`, error);
          // Fallback to filename-based info
          const fallbackItem: ProcessedItem = {
            baseName: pair.baseName,
            metadata: {
              title: pair.baseName.replace(/[_-]/g, ' '),
              identifier: pair.baseName,
              creator: null
            },
            pair: pair,
            error: errorMessage
          };
          
          processedItems.push(fallbackItem);
          
          // Progressive update: Update results with fallback item too
          await new Promise<void>(resolve => {
            setTimeout(() => {
              setResults(prev => ({
                ...prev,
                processedContent: [...processedItems]
              }));
              resolve();
            }, 10);
          });
        }
      }

      setProgress({ step: 'complete', message: `All ${processedItems.length} items loaded!` });

      // Update cache stats after successful operation
      // @ts-ignore - CacheStats typing is complex but this works
      const updatedStats = serviceWorkerManager.getCacheStats();
      setCacheStats(updatedStats);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error processing CID:', error);
      setError(`Error: ${errorMessage}`);
    } finally {
      setIsLoading(false);
      setProgress({ step: '', message: '' });
    }
  };

  // Form submission handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const trimmedInput = inputCid.trim();
    if (!trimmedInput) {
      setError('Please enter a CID');
      return;
    }

    // If submitting a different CID than current, update both state and URL
    if (trimmedInput !== cid) {
      setCid(trimmedInput);
      setSearchParams({ cid: trimmedInput }); // Explicitly update URL
      // Clear old results when changing to a new root CID
      setResults(null);
      setItemThumbnails({});
      // This will trigger the auto-load effect to process the new CID
      return;
    }

    // If same CID, process it directly
    processData(trimmedInput);
  };

  // Helper function to render an individual item card
  const renderItemCard = (item: ProcessedItem, index: number) => {
    const thumbnailUrl = itemThumbnails[item.baseName];
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
                // @ts-ignore - event target properties exist
                e.target.src = "./archive.png";
                // @ts-ignore - event target properties exist  
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
  };

  const navigateToDownload = (baseName: string) => {
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
                {/* @ts-ignore - count property exists at runtime */}
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
                  value={inputCid}
                  onChange={(e) => setInputCid(e.target.value)}
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
            
            {/* Categorized View Toggle */}
            {results && results.processedContent && results.processedContent.length > 0 && (
              <div className="mt-4 flex items-center space-x-3">
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={categorizedView}
                    onChange={(e) => setCategorizedView(e.target.checked)}
                    className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium text-gray-700">
                    Categorized View
                  </span>
                </label>
                <span className="text-xs text-gray-500">
                  Group items by type (
                  <a href="#category-videos" className="text-blue-600 hover:text-blue-800 underline">Videos</a>, 
                  <a href="#category-documents" className="text-blue-600 hover:text-blue-800 underline">Documents</a>, 
                  <a href="#category-photos" className="text-blue-600 hover:text-blue-800 underline">Photos</a>, 
                  <a href="#category-other" className="text-blue-600 hover:text-blue-800 underline">Other</a>)
                </span>
              </div>
            )}
          </div>

          {progress.message && (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
              <div className="flex items-center space-x-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                <span className="text-blue-800">
                  {progress.message}
                  {/* @ts-ignore - entriesFound exists at runtime */}
                  {progress.entriesFound && (
                    <span className="ml-2 text-blue-600 font-medium">
                      {/* @ts-ignore - entriesFound exists at runtime */}
                      ({progress.entriesFound} entries)
                    </span>
                  )}
                </span>
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
                {results.processedContent.length === 0 ? (
                  <div className="text-center py-12 archive-metadata">
                    <p className="text-lg mb-2">No media items found in this CID.</p>
                    <p className="text-sm">This browser looks for items with metadata and file information.</p>
                  </div>
                ) : categorizedView ? (
                  // Categorized View
                  (() => {
                    const categorized = categorizeItems(results.processedContent);
                    const categories: ItemCategory[] = ['Videos', 'Documents', 'Photos', 'Other'];
                    
                    return (
                      <div className="space-y-8">
                        {categories.map(category => {
                          const categoryItems = categorized[category];
                          if (categoryItems.length === 0) return null;
                          
                          return (
                            <div key={category} id={`category-${category.toLowerCase()}`} className="space-y-4">
                              <div className="flex items-center space-x-2">
                                <h2 className="text-2xl font-bold" style={{color: 'var(--archive-text)'}}>
                                  {category}
                                </h2>
                                <span className="bg-gray-100 text-gray-600 text-sm font-medium px-2 py-1 rounded-full">
                                  {categoryItems.length}
                                </span>
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                                {categoryItems.map((item, index) => renderItemCard(item, index))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()
                ) : (
                  // List View
                  <div className="space-y-4">
                    <h2 className="text-2xl font-bold" style={{color: 'var(--archive-text)'}}>Media Items</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                      {results.processedContent.map((item: ProcessedItem, index: number) => renderItemCard(item, index))}
                    </div>
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