/**
 * Constructs URLs with the correct base path for deployment
 */

// Get the base URL from Vite's environment
const BASE_URL = import.meta.env.BASE_URL || '/';

/**
 * Create an IPFS service worker URL with the correct base path
 * @param {string} cid - The IPFS CID
 * @param {string} filename - Optional filename
 * @param {number} size - Optional file size
 * @returns {string} - Complete URL with base path
 */
export function createIpfsSwUrl(cid, filename = null, size = null) {
  const basePath = BASE_URL.endsWith('/') ? BASE_URL.slice(0, -1) : BASE_URL;
  let url = `${basePath}/ipfs-sw/${cid}`;
  
  const params = new URLSearchParams();
  if (filename) {
    params.set('filename', filename);
  }
  if (size) {
    params.set('size', size.toString());
  }
  
  if (params.toString()) {
    url += `?${params.toString()}`;
  }
  
  return url;
}

/**
 * Create a download URL for a file
 * @param {string} baseName - The base name of the item
 * @param {string} filename - Optional specific filename
 * @param {string} cid - The CID of the directory
 * @returns {string} - Complete download URL with base path
 */
export function createDownloadUrl(baseName, filename = null, cid = null) {
  const basePath = BASE_URL.endsWith('/') ? BASE_URL.slice(0, -1) : BASE_URL;
  let url = `${basePath}/download/${encodeURIComponent(baseName)}`;
  
  if (filename) {
    url += `/${encodeURIComponent(filename)}`;
  }
  
  if (cid) {
    url += `?cid=${encodeURIComponent(cid)}`;
  }
  
  return url;
}

/**
 * Get the current base URL
 * @returns {string} - The base URL
 */
export function getBaseUrl() {
  return BASE_URL;
}

/**
 * Create any relative URL with the base path
 * @param {string} path - The relative path
 * @returns {string} - Complete URL with base path
 */
export function createUrl(path) {
  const basePath = BASE_URL.endsWith('/') ? BASE_URL.slice(0, -1) : BASE_URL;
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${basePath}${cleanPath}`;
} 