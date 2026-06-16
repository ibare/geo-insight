import React from 'react';
import { createRoot } from 'react-dom/client';
import * as Tooltip from '@radix-ui/react-tooltip';
import { App } from './App.js';
import '@geo-insight/runtime/styles.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Tooltip.Provider delayDuration={300}>
      <App />
    </Tooltip.Provider>
  </React.StrictMode>,
);
