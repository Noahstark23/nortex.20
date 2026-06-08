import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';

// PWA: registra y auto-actualiza el service worker. Con registerType 'autoUpdate',
// `immediate: true` recarga la página una sola vez cuando hay una versión nueva,
// para que los visitantes recurrentes no queden servidos con el bundle viejo.
registerSW({ immediate: true });

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);