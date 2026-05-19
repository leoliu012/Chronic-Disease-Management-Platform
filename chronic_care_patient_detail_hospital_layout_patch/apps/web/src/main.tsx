import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './functional-fixes.css';
import './his-integration-fixes.css';
import './patient-detail-form-fix.css';
import './timeline-cleanup-fixes.css';
import './previous-style-lock.css';
import './patient-detail-hospital-layout.css';
import App from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);


