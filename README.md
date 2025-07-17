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

This is a fully static SPA that can be deployed to any static hosting service:

- Netlify
- Vercel
- GitHub Pages
- IPFS
- Any web server that can serve static files

Just deploy the contents of the `dist` directory after running `npm run build`.

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

No environment variables are required for basic operation. The app runs entirely in the browser.

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