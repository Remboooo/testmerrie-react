import ReactDOM from 'react-dom/client';
import './index.css';
// Roboto, latin only, just the weights MUI's theme uses (light/regular/medium/bold).
import '@fontsource/roboto/latin-300.css';
import '@fontsource/roboto/latin-400.css';
import '@fontsource/roboto/latin-500.css';
import '@fontsource/roboto/latin-700.css';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import theme from './theme';
import App from './App';
import ErrorBoundary from './ErrorBoundary';
import { SnackbarProvider } from 'notistack';
import { Error, WarningOutlined } from '@mui/icons-material';

const root = ReactDOM.createRoot(document.getElementById('root') as Element);
root.render(
  // <React.StrictMode>
  <ThemeProvider theme={theme}>
    <CssBaseline />
    <SnackbarProvider iconVariant={{error: <Error sx={{margin: "0 .5em 0 0"}} />}}>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </SnackbarProvider>
  </ThemeProvider>
  // </React.StrictMode>
);