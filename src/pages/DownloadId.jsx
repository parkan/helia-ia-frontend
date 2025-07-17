import { useState, useEffect } from 'react';
import { useParams, useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { serviceWorkerManager } from '../serviceWorkerManager';
import { processXmlPair } from '../xmlParser';

export default function DownloadId() {
  const { id: baseName } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const cid = searchParams.get('cid');
  
  // Extract filename from path if present
  const pathParts = location.pathname.split('/').filter(part => part);
  const filenameFromPath = pathParts.length > 2 ? decodeURIComponent(pathParts[2]) : null;
  
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState({ step: '', message: '' });
  const [downloadData, setDownloadData] = useState(null);
  const [error, setError] = useState('');
  const [isServiceWorkerReady, setIsServiceWorkerReady] = useState(false);
  const [downloadingFiles, setDownloadingFiles] = useState(new Set());
  const [viewingPdf, setViewingPdf] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [viewingImage, setViewingImage] = useState(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [viewingVideo, setViewingVideo] = useState(null);
  const [videoLoading, setVideoLoading] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState(null);
  const [backgroundProgress, setBackgroundProgress] = useState([]);
  const [allDirectoryFiles, setAllDirectoryFiles] = useState([]);

  useEffect(() => {
    initializeServiceWorker();
  }, []);

  useEffect(() => {
    if (isServiceWorkerReady && baseName && cid) {
      loadDownloadData();
    }
  }, [isServiceWorkerReady, baseName, cid]);

  // Auto-open file when filename is in URL and data is loaded
  useEffect(() => {
    if (downloadData && filenameFromPath && !viewingPdf && !viewingImage && !viewingVideo) {
      const file = downloadData.files.find(f => f.name === filenameFromPath);
      if (file) {
        handleFileClick(file, true); // Pass true to skip navigation
      }
    }
  }, [downloadData, filenameFromPath]);

  // Re-correlate files with CIDs when allDirectoryFiles changes (from background processing)
  useEffect(() => {
    if (downloadData && allDirectoryFiles.length > 0) {
      console.log(`🔄 Re-correlating ${downloadData.files.length} files with ${allDirectoryFiles.length} directory files`);
      
      // Debug: Show some example file names from both sets
      const sampleXmlFiles = downloadData.files.slice(0, 3).map(f => f.name);
      const sampleDirFiles = allDirectoryFiles.slice(0, 3).map(f => f.name);
      console.log(`📄 Sample XML files:`, sampleXmlFiles);
      console.log(`📁 Sample directory files:`, sampleDirFiles);
      
      const updatedFilesWithCids = downloadData.files.map(file => {
        const directoryFile = allDirectoryFiles.find(df => df.name === file.name);
        const hadCid = file.cid != null;
        const nowHasCid = directoryFile?.cid != null;
        
        // Debug: Log files that still have no CID
        if (!hadCid && !nowHasCid) {
          console.log(`❌ Still no CID for ${file.name} - not found in directory files`);
        }
        
        if (!hadCid && nowHasCid) {
          console.log(`✅ Found CID for ${file.name}: ${directoryFile.cid}`);
        }
        
        return {
          ...file,
          cid: directoryFile?.cid || file.cid,
          path: directoryFile?.path || file.name
        };
      });
      
      setDownloadData(prevData => ({
        ...prevData,
        files: updatedFilesWithCids
      }));
    }
  }, [allDirectoryFiles.length, downloadData?.baseName]); // Use length and baseName to trigger re-correlation

  // Update document title
  useEffect(() => {
    document.title = downloadData?.metadata?.title || `${baseName} - View & Download`;
  }, [downloadData, baseName]);

  const initializeServiceWorker = async () => {
    try {
      if (!serviceWorkerManager.constructor.isSupported()) {
        throw new Error('Service Worker not supported in this browser');
      }

      console.log('🔧 Download page: Initializing service worker...');
      await serviceWorkerManager.init();
      
      // Service worker is ready after successful initialization
      console.log('✅ Download page: Service worker ready');
      setIsServiceWorkerReady(true);
    } catch (error) {
      console.error('Failed to initialize service worker:', error);
      setError(`Service Worker initialization failed: ${error.message}`);
    }
  };

  const loadDownloadData = async () => {
    setIsLoading(true);
    setError('');
    setProgress({ step: '', message: '' });

    try {
      // Check if we have cached directory data first
      const cachedFiles = serviceWorkerManager.getCachedDirectoryListing(cid);
      if (cachedFiles && cachedFiles.length > 0) {
        console.log(`🎯 Found cached directory data for CID: ${cid} (${cachedFiles.length} files)`);
        setProgress({ step: 'cache_hit', message: 'Using cached directory data...' });
        
        // Use cached data to find and load the specific item
        setAllDirectoryFiles(cachedFiles);
        
        // Extract pairs and find the specific item
        const pairs = await serviceWorkerManager.extractPairs(cachedFiles);
        const targetPair = pairs.find(pair => pair.baseName === baseName);
        
        if (!targetPair) {
          throw new Error(`Item "${baseName}" not found in cached directory data.`);
        }
        
        // Fetch the XML files using the cached CIDs (hash-based, not path-based)
        setProgress({ step: 'retrieve_cached_xml', message: 'Loading XML files from cache info...' });
        
        const [filesXmlContent, metaXmlContent] = await Promise.all([
          fetch(`/ipfs-sw/${targetPair.filesXml.cid}?filename=${targetPair.filesXml.name}`).then(r => r.text()),
          fetch(`/ipfs-sw/${targetPair.metaXml.cid}?filename=${targetPair.metaXml.name}`).then(r => r.text())
        ]);
        
        // Process the XML content
        setProgress({ step: 'process_xml', message: 'Processing XML content...' });
        const processedPair = processXmlPair(filesXmlContent, metaXmlContent);
        
        // Correlate XML file data with cached directory listing to get proper CIDs
        const filesWithCids = processedPair.files.map(file => {
          const directoryFile = cachedFiles.find(df => df.name === file.name);
          return {
            ...file,
            cid: directoryFile?.cid || null,
            path: directoryFile?.path || file.name
          };
        });

        setDownloadData({
          baseName,
          ...processedPair,
          files: filesWithCids,
          rawXml: {
            filesXml: filesXmlContent,
            metaXml: metaXmlContent
          }
        });
        
        setProgress({ step: 'complete', message: 'Item loaded from cache!' });
        setAllDirectoryFiles(cachedFiles);
        
        // Clear success message after 2 seconds
        setTimeout(() => {
          setProgress({ step: '', message: '' });
        }, 2000);
        
        return; // Exit early if cache hit
      }
      
      // If no cache hit, try direct XML fetch
      try {
        console.log(`🚀 Attempting direct XML fetch for ${baseName} in CID: ${cid}`);
        
        // Construct the direct XML file paths
        const metaXmlUrl = `/ipfs-sw/${cid}/${baseName}_meta.xml`;
        const filesXmlUrl = `/ipfs-sw/${cid}/${baseName}_files.xml`;
        
        console.log(`📥 Fetching XML files directly:`, { metaXmlUrl, filesXmlUrl });
        
        // Fetch both XML files directly
        const [metaResponse, filesResponse] = await Promise.all([
          fetch(metaXmlUrl),
          fetch(filesXmlUrl)
        ]);
        
        // Check if both files exist
        if (!metaResponse.ok) {
          throw new Error(`Meta XML not found (${metaResponse.status}): ${baseName}_meta.xml`);
        }
        if (!filesResponse.ok) {
          throw new Error(`Files XML not found (${filesResponse.status}): ${baseName}_files.xml`);
        }
        
        // Get the XML content
        const [metaXmlContent, filesXmlContent] = await Promise.all([
          metaResponse.text(),
          filesResponse.text()
        ]);
        
        console.log(`✅ Successfully fetched XML files directly for ${baseName}`);
        
        // Process the XML content
        setProgress({ step: 'process_xml', message: 'Processing XML content...' });
        const processedPair = processXmlPair(filesXmlContent, metaXmlContent);
        
        // For direct fetch, construct CIDs as ${root_cid}/${file_name}
        // This allows viewing and downloading files without full directory listing
        setDownloadData({
          baseName,
          ...processedPair,
          files: processedPair.files.map(file => ({
            ...file,
            cid: `${cid}/${file.name}`, // Construct path-based CID
            path: file.name
          })),
          rawXml: {
            filesXml: filesXmlContent,
            metaXml: metaXmlContent
          },
          directFetch: true // Flag to indicate this was a direct fetch
        });
        
        console.log(`📚 Loaded ${processedPair.files.length} files for ${baseName} (direct fetch mode)`);
        
        // Set up background progress callback for subdirectory processing
        const backgroundProgressHandler = (progressData) => {
          console.log('🚀 DOWNLOAD: Background progress update:', progressData);
          
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
          
          // Update the allDirectoryFiles when new files are found
          if (progressData.type === 'SUBDIRECTORY_FILES_FOUND' && progressData.files) {
            console.log(`🔍 Processing subdirectory: ${progressData.subdirectory}`);
            console.log(`📁 Files found:`, progressData.files.map(f => f.name));
            
            setAllDirectoryFiles(prev => {
              const updated = [...prev, ...progressData.files];
              console.log(`📊 Total directory files: ${updated.length}`);
              return updated;
            });
          }
        };
        
        // Register the background progress handler
        if (serviceWorkerManager) {
          serviceWorkerManager.addBackgroundProgressCallback(backgroundProgressHandler);
        }
        
        // Trigger background subdirectory processing in direct fetch mode
        console.log(`🔄 Starting background subdirectory processing for CID: ${cid}`);
        serviceWorkerManager.processSubdirectoriesInBackground(cid);
        
        // Store cleanup function to remove the callback on unmount
        const cleanup = () => {
          if (serviceWorkerManager) {
            serviceWorkerManager.removeBackgroundProgressCallback(backgroundProgressHandler);
          }
        };
        
        // Store cleanup function for component unmount
        window.addEventListener('beforeunload', cleanup);
        
        setProgress({ step: 'complete', message: 'Item loaded! Subdirectories processing in background...' });
        
        // Clear success message after 3 seconds
        setTimeout(() => {
          setProgress({ step: '', message: '' });
        }, 3000);
        
        return; // Exit after direct fetch
        
      } catch (directFetchError) {
        console.log(`📥 Direct fetch failed: ${directFetchError.message}, falling back to full directory listing...`);
        // Continue to full directory fetch if direct fetch fails
      }
      
      // Get full directory listing as fallback (or if direct fetch failed)
      setProgress({ step: 'listing', message: 'Getting full directory listing...' });
      setBackgroundProgress([]); // Reset background progress
      
      // Set up background progress callback before making the request
      const backgroundProgressHandler = (progressData) => {
        console.log('🚀 DOWNLOAD: Background progress update:', progressData);
        
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
        
        // Update the allDirectoryFiles when new files are found
        if (progressData.type === 'SUBDIRECTORY_FILES_FOUND' && progressData.files) {
          console.log(`🔍 Processing subdirectory: ${progressData.subdirectory}`);
          console.log(`📁 Files found:`, progressData.files.map(f => f.name));
          
          setAllDirectoryFiles(prev => {
            const updated = [...prev, ...progressData.files];
            console.log(`📊 Total directory files: ${updated.length}`);
            return updated;
          });
        }
      };
      
      // Register the background progress handler BEFORE making the request
      if (serviceWorkerManager) {
        serviceWorkerManager.addBackgroundProgressCallback(backgroundProgressHandler);
      }
      
      const directoryData = await serviceWorkerManager.getItemListing(cid, (progressData) => {
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
      
      // Initialize the all directory files with the initial root files
      setAllDirectoryFiles(directoryData.originalFiles);
      
      // Then fetch the specific item's XML files
      const itemData = await serviceWorkerManager.getSpecificItem(cid, baseName, setProgress);
      
      // Process the XML content for this specific item
      const processedPair = processXmlPair(
        itemData.filesXml.content,
        itemData.metaXml.content
      );

      // Correlate XML file data with directory listing to get CIDs (use directoryData.originalFiles for initial correlation)
      const filesWithCids = processedPair.files.map(file => {
        const directoryFile = directoryData.originalFiles.find(df => df.name === file.name);
        return {
          ...file,
          cid: directoryFile?.cid || null,
          path: directoryFile?.path || file.name
        };
      });

      setDownloadData({
        baseName,
        ...processedPair,
        files: filesWithCids,
        rawXml: {
          filesXml: itemData.filesXml.content,
          metaXml: itemData.metaXml.content
        }
      });

    } catch (error) {
      console.error('Error loading download:', error);
      setError(`Error: ${error.message}`);
    } finally {
      setIsLoading(false);
      setProgress({ step: '', message: '' });
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return 'Unknown';
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  };

  const getMimeType = (format) => {
    const formatLower = (format || '').toLowerCase();
    
    // PDF variations
    if (formatLower.includes('pdf')) return 'application/pdf';
    
    // Image types
    if (formatLower.includes('jpeg') || formatLower.includes('jpg')) return 'image/jpeg';
    if (formatLower.includes('png')) return 'image/png';
    if (formatLower.includes('gif')) return 'image/gif';
    if (formatLower.includes('webp')) return 'image/webp';
    if (formatLower.includes('tiff')) return 'image/tiff';
    
    // Video types
    if (formatLower.includes('mp4')) return 'video/mp4';
    if (formatLower.includes('avi')) return 'video/x-msvideo';
    if (formatLower.includes('mkv')) return 'video/x-matroska';
    if (formatLower.includes('mov')) return 'video/quicktime';
    if (formatLower.includes('webm')) return 'video/webm';
    
    // Text types
    if (formatLower.includes('text')) return 'text/plain';
    if (formatLower.includes('xml')) return 'application/xml';
    if (formatLower.includes('json')) return 'application/json';
    
    // Default
    return 'application/octet-stream';
  };

  const handleFileClick = async (file, skipNavigation = false) => {
    if (!file.cid) {
      setError(`Cannot access ${file.name}: No CID available`);
      return;
    }

    if (!skipNavigation) {
      // Update URL to include filename in path
      const newUrl = `/download/${baseName}/${encodeURIComponent(file.name)}?cid=${cid}`;
      navigate(newUrl, { replace: true });
    }

    // If it's a PDF (including variations like "Text PDF", "Additional PDF", etc.), show in iframe viewer
    const isPdf = file.format?.toLowerCase().includes('pdf') || 
                  file.format?.toLowerCase().includes('portable document') ||
                  file.name?.toLowerCase().endsWith('.pdf');
    
    if (isPdf) {
      const pdfUrl = `/ipfs-sw/${file.cid}?filename=${encodeURIComponent(file.name)}${file.size ? `&size=${file.size}` : ''}`;
      setPdfLoading(true);
      setViewingPdf({ 
        name: file.name, 
        url: pdfUrl,
        size: file.size 
      });
      return;
    }

    // If it's an image, show in image viewer
    const isImage = /\b(jpe?g|png|gif|webp|tiff?)\b/i.test(file.format || '') ||
                    /\.(jpe?g|png|gif|webp|tiff?)$/i.test(file.name || '');
    
    if (isImage) {
      const imageUrl = `/ipfs-sw/${file.cid}?filename=${encodeURIComponent(file.name)}${file.size ? `&size=${file.size}` : ''}`;
      setImageLoading(true);
      setViewingImage({ 
        name: file.name, 
        url: imageUrl,
        size: file.size 
      });
      return;
    }

    // If it's a video, show in video viewer
    const isVideoFile = /\b(mp4|avi|mkv|mov|webm|wmv|flv|m4v)\b/i.test(file.format || '') ||
                        /\.(mp4|avi|mkv|mov|webm|wmv|flv|m4v)$/i.test(file.name || '');
    
    if (isVideoFile) {
      const videoUrl = `/ipfs-sw/${file.cid}?filename=${encodeURIComponent(file.name)}${file.size ? `&size=${file.size}` : ''}`;
      setVideoLoading(true);
      setViewingVideo({ 
        name: file.name, 
        url: videoUrl,
        size: file.size 
      });
      return;
    }

    // Otherwise, download the file
    downloadFile(file);
  };

  const downloadFile = async (file) => {
    if (downloadingFiles.has(file.name)) {
      return; // Already downloading
    }

    try {
      setDownloadingFiles(prev => new Set(prev).add(file.name));
      setProgress({ step: 'download', message: `Downloading ${file.name}...` });

      // Fetch file content from IPFS
      const response = await fetch(`/ipfs-sw/${file.cid}?filename=${encodeURIComponent(file.name)}${file.size ? `&size=${file.size}` : ''}`);
      const fileContent = await response.text();
      
      // Determine MIME type based on file extension
      const mimeType = getMimeType(file.format);
      
      // Convert string content to proper binary data for blob creation
      let binaryData;
      if (typeof fileContent === 'string') {
        // For text files, use UTF-8 encoding
        binaryData = new TextEncoder().encode(fileContent);
      } else {
        // For binary files, use as-is
        binaryData = fileContent;
      }
      
      // Create blob and download URL
      const blob = new Blob([binaryData], { type: mimeType });
      const downloadUrl = URL.createObjectURL(blob);
      
      // Create temporary download link and trigger download
      const downloadLink = document.createElement('a');
      downloadLink.href = downloadUrl;
      downloadLink.download = file.name;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
      
      // Clean up blob URL
      URL.revokeObjectURL(downloadUrl);
      
      setProgress({ step: 'complete', message: `${file.name} downloaded successfully!` });
      
      // Clear success message after 3 seconds
      setTimeout(() => {
        setProgress({ step: '', message: '' });
      }, 3000);

    } catch (error) {
      console.error('Download error:', error);
      setError(`Failed to download ${file.name}: ${error.message}`);
    } finally {
      setDownloadingFiles(prev => {
        const newSet = new Set(prev);
        newSet.delete(file.name);
        return newSet;
      });
    }
  };

  const groupFilesByFormat = (files) => {
    const groups = {};
    
    files.forEach(file => {
      // Use the actual format field from files.xml, with fallback for missing formats
      let groupName = file.format || 'Unknown Format';
      
      // Clean up the format name for display
      groupName = groupName.trim();
      
      if (!groups[groupName]) {
        groups[groupName] = [];
      }
      groups[groupName].push(file);
    });
    
    // Sort files within each group by name
    Object.keys(groups).forEach(groupName => {
      groups[groupName].sort((a, b) => a.name.localeCompare(b.name));
    });
    
    return groups;
  };

  const selectFormat = (formatName) => {
    setSelectedFormat(formatName);
  };

  const goBackToFormats = () => {
    setSelectedFormat(null);
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
            {/* Back navigation */}
            <div className="mb-6">
              <button
                onClick={() => navigate(`/#${cid}`)}
                className="text-blue-600 hover:text-blue-800 flex items-center gap-2"
              >
                ← Back to items list
              </button>
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

            {isLoading && !downloadData ? (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto mb-4"></div>
                <p className="text-gray-600">Loading item details...</p>
              </div>
            ) : downloadData ? (
              <>
                {/* Item Metadata */}
                <div className="mb-8">
                  <h1 className="text-3xl font-bold mb-4" style={{color: 'var(--archive-text)'}}>
                    {downloadData.metadata.title}
                  </h1>
                  {downloadData.metadata.creator && (
                    <p className="archive-metadata mb-2">
                      by <span className="font-medium">{downloadData.metadata.creator}</span>
                    </p>
                  )}
                  {downloadData.metadata.date && (
                    <p className="archive-metadata mb-2">
                      Published: {downloadData.metadata.date}
                    </p>
                  )}
                  {downloadData.metadata.description && (
                    <div className="mt-4 p-4 bg-gray-50 rounded-md">
                      <p className="text-gray-700">{downloadData.metadata.description}</p>
                    </div>
                  )}
                </div>

                {/* PDF Viewer Modal */}
                {viewingPdf && (
                  <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-lg flex flex-col" style={{ width: '90vw', height: '90vh', maxWidth: '1200px' }}>
                      {/* Modal Header */}
                      <div className="flex items-center justify-between p-4 border-b">
                        <h3 className="text-lg font-semibold truncate">{viewingPdf.name}</h3>
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => downloadFile(downloadData.files.find(f => f.name === viewingPdf.name))}
                            className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                          >
                            Download
                          </button>
                          <button
                            onClick={() => {
                              setViewingPdf(null);
                              setPdfLoading(false);
                              // Update URL to remove filename
                              navigate(`/download/${baseName}?cid=${cid}`, { replace: true });
                            }}
                            className="text-gray-500 hover:text-gray-700 p-1"
                          >
                            <span className="text-xl">×</span>
                          </button>
                        </div>
                      </div>
                      
                      {/* PDF Iframe */}
                      <div className="flex-1 relative">
                        {pdfLoading && (
                          <div className="absolute inset-0 bg-white bg-opacity-90 flex items-center justify-center z-10">
                            <div className="flex flex-col items-center space-y-4">
                              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                              <p className="text-gray-600">Loading PDF from IPFS...</p>
                            </div>
                          </div>
                        )}
                        <iframe
                          src={viewingPdf.url}
                          className="w-full h-full border-none"
                          title={`${viewingPdf.name} - PDF Viewer`}
                          onLoad={() => setPdfLoading(false)}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Image Viewer Modal */}
                {viewingImage && (
                  <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4" onClick={() => {
                    setViewingImage(null);
                    setImageLoading(false);
                    navigate(`/download/${baseName}?cid=${cid}`, { replace: true });
                  }}>
                    <div className="bg-white rounded-lg p-4 max-w-6xl max-h-full flex flex-col" onClick={e => e.stopPropagation()}>
                      {/* Modal Header */}
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold truncate">{viewingImage.name}</h3>
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => downloadFile(downloadData.files.find(f => f.name === viewingImage.name))}
                            className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                          >
                            Download
                          </button>
                          <button
                            onClick={() => {
                              setViewingImage(null);
                              setImageLoading(false);
                              navigate(`/download/${baseName}?cid=${cid}`, { replace: true });
                            }}
                            className="text-gray-500 hover:text-gray-700 p-1"
                          >
                            <span className="text-xl">×</span>
                          </button>
                        </div>
                      </div>
                      
                      {/* Image Container */}
                      <div className="relative overflow-auto flex-1 flex items-center justify-center">
                        {imageLoading && (
                          <div className="absolute inset-0 bg-white bg-opacity-90 flex items-center justify-center z-10">
                            <div className="flex flex-col items-center space-y-4">
                              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                              <p className="text-gray-600">Loading image from IPFS...</p>
                            </div>
                          </div>
                        )}
                        <img
                          src={viewingImage.url}
                          alt={viewingImage.name}
                          className="max-w-full max-h-full object-contain"
                          onLoad={() => setImageLoading(false)}
                          onError={() => {
                            setImageLoading(false);
                            setError('Failed to load image');
                          }}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Video Viewer Modal */}
                {viewingVideo && (
                  <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-lg flex flex-col" style={{ width: '90vw', height: '90vh', maxWidth: '1200px' }}>
                      {/* Modal Header */}
                      <div className="flex items-center justify-between p-4 border-b">
                        <h3 className="text-lg font-semibold truncate">{viewingVideo.name}</h3>
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => downloadFile(downloadData.files.find(f => f.name === viewingVideo.name))}
                            className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                          >
                            Download
                          </button>
                          <button
                            onClick={() => {
                              setViewingVideo(null);
                              setVideoLoading(false);
                              navigate(`/download/${baseName}?cid=${cid}`, { replace: true });
                            }}
                            className="text-gray-500 hover:text-gray-700 p-1"
                          >
                            <span className="text-xl">×</span>
                          </button>
                        </div>
                      </div>
                      
                      {/* Video Container */}
                      <div className="flex-1 relative p-4 flex items-center justify-center bg-black">
                        {videoLoading && (
                          <div className="absolute inset-0 bg-black bg-opacity-90 flex items-center justify-center z-10">
                            <div className="flex flex-col items-center space-y-4">
                              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                              <p className="text-white">Loading video from IPFS...</p>
                            </div>
                          </div>
                        )}
                        <video
                          src={viewingVideo.url}
                          controls
                          className="max-w-full max-h-full"
                          onLoadedData={() => setVideoLoading(false)}
                          onError={() => {
                            setVideoLoading(false);
                            setError('Failed to load video');
                          }}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Files List */}
                <div>
                  <h2 className="text-3xl font-bold mb-6" style={{color: 'var(--archive-text)'}}>
                    DOWNLOAD OPTIONS
                  </h2>
                  
                  {downloadData.files.length === 0 ? (
                    <p className="text-center py-12 text-lg">No files found in this item.</p>
                  ) : (
                    (() => {
                      const fileGroups = groupFilesByFormat(downloadData.files);
                      
                      // Show format list or specific format files
                      if (!selectedFormat) {
                        // Format list view (main download options)
                        return (
                          <div className="bg-gray-100 border border-gray-300">
                            {Object.entries(fileGroups).map(([format, formatFiles]) => (
                              <div 
                                key={format}
                                className="border-b border-gray-300 last:border-b-0"
                              >
                                <div 
                                  className="px-4 py-3 cursor-pointer hover:bg-gray-200 flex justify-between items-center"
                                  onClick={() => selectFormat(format)}
                                >
                                  <span className="text-blue-600 hover:underline font-normal">
                                    {format.toUpperCase()}
                                  </span>
                                  <span className="text-gray-600 text-sm">
                                    {formatFiles.length} files
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      } else {
                        // Specific format files view
                        const formatFiles = fileGroups[selectedFormat] || [];
                        
                        return (
                          <div>
                            <button
                              onClick={goBackToFormats}
                              className="mb-4 text-blue-600 hover:text-blue-800"
                            >
                              ← Back to formats
                            </button>
                            
                            <h3 className="text-xl font-bold mb-4">
                              {selectedFormat.toUpperCase()} FILES
                            </h3>
                            
                            <div className="bg-gray-100 border border-gray-300">
                              {formatFiles.map((file, index) => {
                                const isDownloading = downloadingFiles.has(file.name);
                                const hasValidCid = file.cid != null;
                                const isPdf = file.format?.toLowerCase().includes('pdf') || file.format?.toLowerCase().includes('portable document');
                                const isImage = /\b(jpe?g|png|gif|webp|tiff?)\b/i.test(file.format || '') ||
                                                /\.(jpe?g|png|gif|webp|tiff?)$/i.test(file.name || '');
                                const isVideoFile = /\b(mp4|avi|mkv|mov|webm|wmv|flv|m4v)\b/i.test(file.format || '') ||
                                                    /\.(mp4|avi|mkv|mov|webm|wmv|flv|m4v)$/i.test(file.name || '');
                                
                                return (
                                  <div 
                                    key={index}
                                    className="border-b border-gray-300 last:border-b-0 px-4 py-3 hover:bg-gray-200"
                                  >
                                    <div className="flex justify-between items-center">
                                      <div className="flex-1 min-w-0">
                                        <span 
                                          className={`${hasValidCid ? 'text-blue-600 hover:underline cursor-pointer' : 'text-gray-600 cursor-not-allowed'}`}
                                          onClick={() => {
                                            if (hasValidCid && !isDownloading) {
                                              handleFileClick(file);
                                            }
                                          }}
                                        >
                                          {file.name} {isPdf && '[View PDF]'} {isImage && '[View Image]'} {isVideoFile && '[View Video]'}
                                        </span>
                                        {!hasValidCid && (
                                          <span className="text-red-500 ml-2 text-xs">[No CID]</span>
                                        )}
                                      </div>
                                      <div className="flex items-center space-x-4 text-sm text-gray-600">
                                        <span>{formatFileSize(file.size)}</span>
                                        {isDownloading && (
                                          <span className="text-blue-600">Downloading...</span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      }
                    })()
                  )}
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
    </div>
  );
} 