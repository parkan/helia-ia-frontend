import React from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import Home from './pages/Home';
import DownloadId from './pages/DownloadId';

function App(): React.ReactElement {
  const location = useLocation();
  const isHomePage = location.pathname === '/';

  try {
    return (
      <>
        {/* Only mount Home component when on home page */}
        {isHomePage && <Home />}
        
        {/* Render download routes when not on home page */}
        {!isHomePage && (
          <Routes>
            <Route path="/download/:id" element={<DownloadId />} />
            <Route path="/download/:id/:filename" element={<DownloadId />} />
            <Route path="*" element={<div style={{padding: '20px', color: 'red'}}>🔍 Route not found for: {location.pathname}</div>} />
          </Routes>
        )}
      </>
    );
  } catch (error) {
    console.error('🔴 Error in App component:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return <div style={{padding: '20px', color: 'red'}}>App Error: {errorMessage}</div>;
  }
}

export default App; 