import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Register offline PWA service worker in production / deployed origins
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && (import.meta.env.PROD || window.location.hostname !== 'localhost')) {
  const registerSW = () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        console.log('[PWA] Offline service worker active:', reg.scope);
        // Promptly check for updates
        reg.update().catch(() => {});
      })
      .catch((err) => console.warn('[PWA] Service worker registration failed:', err));
  };

  if (document.readyState === 'complete') {
    registerSW();
  } else {
    window.addEventListener('load', registerSW);
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
