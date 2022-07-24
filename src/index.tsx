import ReactDOM from 'react-dom/client';
import './index.css';
import 'typeface-roboto'
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import theme from './theme';
import App from './App';
import { SnackbarProvider } from 'notistack';
import { authenticate } from './BamApi';

let authenticated = false;
try {
  authenticate();
  authenticated = true;
} catch (authError) {
  (document.getElementById('root') as Element).innerHTML = "Discord says: " + authError + " 😿";
}

const root = ReactDOM.createRoot(document.getElementById('root') as Element);
root.render(
  // <React.StrictMode>
  <ThemeProvider theme={theme}>
    <CssBaseline />
    <SnackbarProvider>
      <App />
    </SnackbarProvider>
  </ThemeProvider>
  // </React.StrictMode>
);