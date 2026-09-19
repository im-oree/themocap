import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { installNetworkGuard } from './lib/networkGuard';
import './styles/index.css';

// Installed before anything else so no module-level fetch can slip past it.
installNetworkGuard();

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
