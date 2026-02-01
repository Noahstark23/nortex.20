import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

console.log("Index.tsx executing...");

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

console.log("Mounting root...");
const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
console.log("Root rendered.");
