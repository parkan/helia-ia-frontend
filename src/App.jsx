import { Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import DownloadId from './pages/DownloadId';

function App() {
  console.log('🟢 App component rendering');
  console.log('🟢 Current pathname:', window.location.pathname);
  
  try {
    return (
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/download/:id" element={<DownloadId />} />
        <Route path="/download/:id/:filename" element={<DownloadId />} />
        <Route path="*" element={<div style={{padding: '20px', color: 'red'}}>🔍 Route not found for: {window.location.pathname}</div>} />
      </Routes>
    );
  } catch (error) {
    console.error('🔴 Error in App component:', error);
    return <div style={{padding: '20px', color: 'red'}}>App Error: {error.message}</div>;
  }
}

export default App; 