import { Component, ErrorInfo, ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';

type Props = { children: ReactNode };
type State = { hasError: boolean };

// Last-resort guard: turn any render/lifecycle throw (e.g. a player edge case)
// into a graceful, reloadable fallback instead of a white screen.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled error, showing fallback:', error, info);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }
    return (
      <Box sx={{
        position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 2,
        color: '#fff', backgroundColor: '#000', textAlign: 'center', p: 2,
      }}>
        <Typography variant="h5">Er ging iets goed mis 😞</Typography>
        <Typography variant="body1">Probeer de pagina te herladen.</Typography>
        <Button variant="contained" onClick={() => window.location.reload()}>Herladen</Button>
      </Box>
    );
  }
}
