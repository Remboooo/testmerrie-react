import './App.css';

import { useEffect, useState } from 'react';
import OvenPlayerComponent from './OvenPlayer'
import StreamSelector from './StreamSelector';

export default function App() {
  const [streamSelectorOpen, setStreamSelectorOpen] = useState<boolean>(false);

  useEffect(() => setStreamSelectorOpen(true), []);

  return (
    <div className="App">
      <OvenPlayerComponent
        onClicked={() => setStreamSelectorOpen(true)}
      />
      <StreamSelector 
        open={streamSelectorOpen} 
        onClose={() => setStreamSelectorOpen(false)} 
        onSelectionChange={(selection) => console.log(selection)}
      />
    </div>
  );
}
