import { createRoot } from 'react-dom/client';
import { LinePoolUIProvider } from '@linepool/ui-react';
import '@linepool/ui-react/styles.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/jetbrains-mono/400.css';
import App from './app/App';
import { normalizeAddress } from './app/router';
import './app/site.css';

normalizeAddress();
const root: ReturnType<typeof createRoot> = import.meta.hot?.data.root ?? createRoot(document.getElementById('root')!);
if (import.meta.hot) import.meta.hot.data.root = root;
root.render(<LinePoolUIProvider><App /></LinePoolUIProvider>);
