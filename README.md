# Helia Frontend - IPFS Media Browser

A client-side only, static file single-page application (SPA) for browsing and exploring media items on IPFS using Helia.

## Technology Stack

- **Vite** - Fast build tool and dev server
- **React 18** - UI framework
- **React Router v6** - Client-side routing
- **Helia** - IPFS implementation in JavaScript
- **Service Worker** - For caching and offline IPFS content access
- **Tailwind CSS** - Utility-first CSS framework

## Features

- Browse IPFS content by CID
- View and download media files
- Built-in viewers for PDFs, images, and videos
- XML metadata parsing for media items
- Service Worker caching for offline access
- Background processing for subdirectories
- Thumbnail support for media items

## Prerequisites

- Node.js >= 24.0.0
- npm or yarn

## Installation

```bash
npm install
```

## Development

```bash
# Build service worker and start dev server
npm run dev
```

The application will be available at `http://localhost:3000`

## Production Build

```bash
# Build service worker and create production build
npm run build

# Preview production build locally
npm run preview
```

The production build will be output to the `dist` directory.

## Deployment

This is a fully static SPA that can be deployed to any static hosting service.

### GitHub Pages (Automatic)

This repository includes a GitHub Actions workflow that automatically builds and deploys to GitHub Pages on every push to the `main` branch.

**Setup Instructions:**
1. Go to your repository Settings → Pages
2. Set Source to "GitHub Actions"
3. Push to the `main` branch
4. The site will be available at `https://username.github.io/repository-name/`

The workflow automatically:
- Builds the project with the correct base path
- Copies the service worker to the output directory
- Creates a 404.html for SPA routing support
- Deploys to GitHub Pages

### Manual Deployment

For other hosting services:

```bash
# Build for production
npm run build

# For custom base paths (e.g., subdirectory hosting)
VITE_BASE_PATH=/my-subdirectory/ npm run build
```

**Hosting Services:**
- **Netlify**: Deploy the `dist` directory
- **Vercel**: Deploy the `dist` directory  
- **GitHub Pages**: Use the included GitHub Actions workflow
- **IPFS**: Perfect for hosting on IPFS itself
- **Any web server**: Serve the `dist` directory contents

**Important for SPA Routing:**
Most hosting services need configuration to handle client-side routing. The built-in GitHub Actions workflow handles this automatically by creating a 404.html file. For other services:

- **Netlify**: Add `_redirects` file with `/* /index.html 200`
- **Vercel**: Add `vercel.json` with rewrites configuration
- **Apache**: Configure `.htaccess` for fallback routing

## Service Worker

The service worker is built separately using esbuild and handles:
- IPFS content caching
- Offline access
- Background processing of subdirectories

To rebuild the service worker manually:
```bash
npm run build-sw
```

To watch for service worker changes during development:
```bash
npm run build-sw:watch
```

## Routes

- `/` - Home page for entering CIDs
- `/download/:id` - View and download files for a specific item
- `/download/:id/:filename` - Direct link to view a specific file

## Environment Variables

- `VITE_BASE_PATH` - Set the base path for deployment (e.g., `/my-repo/` for GitHub Pages)

No other environment variables are required for basic operation. The app runs entirely in the browser.

## Architecture

This application is designed to be entirely client-side with no server dependencies:

- All IPFS operations happen in the browser
- Service Worker provides caching and offline functionality
- React Router handles all routing client-side
- No API routes or server-side rendering

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

[Add your license information here] 