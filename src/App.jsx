import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import DownloadId from './pages/DownloadId';

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/download/:id" element={<DownloadId />} />
      <Route path="/download/:id/:filename" element={<DownloadId />} />
    </Routes>
  );
}

export default App; 