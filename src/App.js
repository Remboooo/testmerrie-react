import './App.css';

import { useEffect, useState } from 'react';
import OvenPlayerComponent from './OvenPlayer.js'
import StreamSelector from './StreamSelector';

export default function App({}) {
  const [streamSelectorOpen, setStreamSelectorOpen] = useState(false);

  useEffect(() => setStreamSelectorOpen(true), []);

  return (
    <div className="App">
      <OvenPlayerComponent
        onClicked={() => setStreamSelectorOpen(true)}
      />
      <StreamSelector open={streamSelectorOpen} onClose={() => setStreamSelectorOpen(false)} />
    </div>
  );
}
