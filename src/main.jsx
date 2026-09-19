import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './App.css';

// Deliberately not wrapped in <React.StrictMode> — the underlying script
// (src/driftline.js) is an imperative, single-mount app with a requestAnimationFrame
// loop and global window/document listeners. StrictMode's dev-only double-invoke
// of effects would run that setup twice, which this app isn't designed for.
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
