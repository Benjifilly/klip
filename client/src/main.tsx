import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import Palette from './components/Palette';
import './index.css';

// The quick-paste palette is a second frameless window pointed at `#palette`.
const isPalette = window.location.hash === '#palette';

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isPalette ? <Palette /> : <App />}</StrictMode>,
);
