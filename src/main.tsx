console.log('🟢 main.tsx module loaded');

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles/globals.css';

// Determine the base path for React Router from build environment
// Can be set via VITE_BASE_PATH environment variable during build
const getBasename = (): string => {
  // Read from environment variable set during build
  const envBasePath = import.meta.env.VITE_BASE_PATH;
  
  if (envBasePath) {
    // Ensure it starts with / and doesn't end with /
    const normalized = envBasePath.startsWith('/') ? envBasePath : `/${envBasePath}`;
    return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  }
  
  // Default to empty for local development
  return '';
};

const basename = getBasename();
console.log('🟢 Environment VITE_BASE_PATH:', import.meta.env.VITE_BASE_PATH);
console.log('🟢 Using basename:', basename);

// Add global error handlers for better debugging
window.addEventListener('error', (event) => {
  console.error('🔴 Global error:', event.error);
  console.error('🔴 Error details:', {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    stack: event.error?.stack
  });
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('🔴 Unhandled promise rejection:', event.reason);
  console.error('🔴 Promise:', event.promise);
});

// React Error Boundary Component
interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true, error: null, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('🔴 React Error Boundary caught error:', error);
    console.error('🔴 Error Info:', errorInfo);
    this.setState({ error, errorInfo });
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px', color: 'red', fontFamily: 'monospace' }}>
          <h2>🔴 React Error Boundary</h2>
          <p><strong>Error:</strong> {this.state.error?.toString()}</p>
          <p><strong>Stack:</strong></p>
          <pre style={{ background: '#f5f5f5', padding: '10px', overflow: 'auto' }}>
            {this.state.error?.stack}
          </pre>
          <p><strong>Component Stack:</strong></p>
          <pre style={{ background: '#f5f5f5', padding: '10px', overflow: 'auto' }}>
            {this.state.errorInfo?.componentStack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

console.log('🟢 All imports successful, mounting React...');

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter basename={basename}>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);

console.log('🟢 React.createRoot called'); 