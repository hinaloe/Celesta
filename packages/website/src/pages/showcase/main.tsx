import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ShowcasePage } from './ShowcasePage';
import '../../styles/style.css';

createRoot(document.getElementById('root')!).render(<StrictMode><ShowcasePage /></StrictMode>);
