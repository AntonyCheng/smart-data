import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ZhishuApp from './App';
import './index.css';
import './workbench.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ZhishuApp />
  </StrictMode>,
);
