import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './functional-fixes.css';
import './his-integration-fixes.css';
import './patient-detail-form-fix.css';
import './timeline-cleanup-fixes.css';
import './previous-style-lock.css';
import './patient-detail-hospital-layout.css';
import './stable-demo-v1.css';
import './auth-security.css';
import './patient-binding-v1.css';
import './clinical-rules-v1.css';
import './integration-center-v1.css';
import './unified-work-items-v1.css';
import './unified-work-items-v2.css';
import './nurse-patient-action-workflow.css';
import './previous-style-compat.css';
import './patient-index-page-fix.css';
import './hospital-workspace-reorg.css';
import './nurse-dashboard-clickthrough.css';
import './operation-feedback.css';
import './follow-up-next-visit.css';
import './release-hardening-v1.css';
import './task-followup-risk-disposal.css';
import './hospital-render-rescue.css';
import './patient-task-processing.css';
import './task-workbench-pro.css';
import './task-workbench-pro-v2.css';
import './patient-entry-detail-fix.css';
import './patient-intake-legacy-polish.css';
import App from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
