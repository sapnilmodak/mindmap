import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './idea/App';
import ErrorBoundary from './idea/ui/ErrorBoundary';

createRoot(document.getElementById('root')!).render(<StrictMode><ErrorBoundary><App /></ErrorBoundary></StrictMode>);
