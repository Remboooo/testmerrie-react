import './App.css';

import React, { Component, createRef } from 'react';
import OvenPlayerComponent from './OvenPlayer.js'
import StreamSelector from './StreamSelector';

export default class App extends Component {
  constructor(props) {
    super(props);
    this.selector = null;
    this.setSelectorRef = (ref) => this.selector = ref;
  }

  render() {
    return (
      <div className="App">
        <OvenPlayerComponent
          onClicked={() => this.selector.open()}
        />
        <StreamSelector defaultOpen={true} ref={(ref) => this.setSelectorRef(ref)} />
      </div>
    );
  }
}
