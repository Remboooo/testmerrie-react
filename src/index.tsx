import ReactDOM from 'react-dom/client';
import './index.css';
import 'typeface-roboto'
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import theme from './theme';
import App from './App';
import { SnackbarProvider } from 'notistack';
import { Error, WarningOutlined } from '@mui/icons-material';

const root = ReactDOM.createRoot(document.getElementById('root') as Element);
root.render(
  // <React.StrictMode>
  <ThemeProvider theme={theme}>
    <CssBaseline />
    <SnackbarProvider iconVariant={{error: <Error sx={{margin: "0 .5em 0 0"}} />}}>
      <App />
    </SnackbarProvider>
  </ThemeProvider>
  // </React.StrictMode>
);