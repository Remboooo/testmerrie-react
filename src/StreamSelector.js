import './StreamSelector.css';
import { Component } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Drawer from '@mui/material/Drawer';
import { getStreams } from './BamApi';
import { Button, Card, CardActionArea, CardActions, CardContent, CardMedia } from '@mui/material';
import tuinfeest from './tuinfeest.svg';

const UPDATE_INTERVAL = 5000;

export default class StreamSelector extends Component {
    constructor(props) {
        super(props);
        this.state = {open: false, streams: {}, selectedStream: null};
        this.updateScheduled = false;
        this.refreshKey = Date.now();
        if (props.defaultOpen) {
            setTimeout(() => this.open(), 0);
        } else {
            this.updateStreamsOnce();
        }
    }

    open() {
        this.setState({open: true});
        this.updateStreams();
    }

    close() {
        this.setState({open: false});
    }

    updateStreams() {
        this.updateStreamsOnce().then(() => {
            if (this.state.open) {
                if (!this.updateScheduled) {
                    setTimeout(() => { 
                        this.updateScheduled = false;
                        this.updateStreams();
                    }, UPDATE_INTERVAL);
                }
                this.updateScheduled = true;
            }
        });
    }

    updateStreamsOnce() {
        return getStreams().then(streams => {
            this.refreshKey = Date.now();
            this.setState({streams: streams});
        });
    }

    render() {
        var content;
        if (Object.entries(this.state.streams).length != 0) {
            content = Object.entries(this.state.streams).map(([stream, props], i) => {
                var media;
                if (props.thumbnail) {
                    media = (<CardMedia
                        component="img"
                        height="140"
                        src={props.thumbnail + "?" + this.refreshKey}
                    />);
                }
                return (
                <Card 
                    key={stream} 
                    sx={{ maxWidth: 345 }}
                    className={this.state.selectedStream == stream ? "selected-stream-card" : ""}
                >
                    <CardActionArea
                        onClick={() => this.selectStream(stream, null)}
                    >
                        {media}
                        <CardContent>
                            <Typography gutterBottom variant="h5">
                                {props.name}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                                Went live at {formatDateTime(props.created)}<br />
                                In glorious {props.video.width}×{props.video.height} @ {formatBitrate(props.video.bitrate)}
                            </Typography>
                        </CardContent>
                    </CardActionArea>
                    <CardActions>
                    {Object.entries(props.streams.main.protocols).map(([protocol, protoProps], i) => (
                        <Button 
                            key={protocol} 
                            size="small"
                            onClick={() => this.selectStream(stream, protocol)}
                        >
                            {protocol}
                        </Button>
                    ))}
                    </CardActions>
                </Card>);
            });
        } else {
            content = <Box className="waiting-box">
                <img src={tuinfeest} className="waiting-icon" alt="waiting" /><br />
                Waiting for someone to start streaming...
            </Box>
        }

        return (
            <Drawer
                open={this.state.open}
                onClose={() => this.close()}
                anchor="top"
            >
                <Box sx={{p: 1}}>
                    {content}
                </Box>
            </Drawer>
        );
    }
    
    selectStream(stream, protocol) {
        if (stream == this.state.selectedStream && this.state.selectedProtocol == protocol) {
            this.setState({selectedStream: null, selectedProtocol: null});
        } else {
            this.setState({selectedStream: stream, selectedProtocol: protocol});
        }
    }
}

function formatDateTime(dt) {
    if (!(dt instanceof Date)) {
        dt = new Date(dt);
    }
    if (dt.toLocaleDateString() == new Date().toLocaleDateString()) {
        return dt.toLocaleTimeString();
    } else {
        return dt.toLocaleString();
    }
}

function formatBitrate(b) {
    let prefix = 0;
    while (b > 1000) {
        b /= 1000;
        prefix++;
    }
    return b.toFixed(1) + ["", "k", "M", "G", "T", "P"][prefix] + "bps";
}