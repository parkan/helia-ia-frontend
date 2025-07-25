// Use Vite's native BASE_URL (set from VITE_BASE_PATH during build)
const baseUrl = import.meta.env.BASE_URL || '/';

// Ensure base path always ends with a slash for proper URL construction
const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;

export function ipfsUrl(path) {
  // Ensure path doesn't start with /
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  return `${base}${cleanPath}`;
}

// For iframe/img src attributes that need explicit relative paths
export function ipfsSrc(path) {
  // This returns a proper relative URL for src attributes
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  return `./${cleanPath}`;
} 