import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { captureNextParam } from '@/lib/next-param';

// Snapshot `?next=` before React (and Refine's router) mounts — the
// in-SPA navigations that follow strip the query string.
captureNextParam();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
