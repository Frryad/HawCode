import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { HawhostProvider, ToastProvider } from './lib/store';
import { ConfirmProvider } from './components/ui';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ToastProvider>
      <HawhostProvider>
        <ConfirmProvider>
          <App />
        </ConfirmProvider>
      </HawhostProvider>
    </ToastProvider>
  </React.StrictMode>
);
