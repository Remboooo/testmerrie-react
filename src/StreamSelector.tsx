import './StreamSelector.css';
import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Drawer from '@mui/material/Drawer';
import { getStreams, StreamMap, StreamProtocol, StreamSpec } from './BamApi';
import { Button, Card, CardActionArea, CardActions, CardContent, CardMedia } from '@mui/material';
import tuinfeest from './tuinfeest.svg';
import { formatBitrate, formatDateTime } from './FormatUtil';

const UPDATE_INTERVAL = 5000;

const DEFAULT_PROTOCOL = "webrtc-tcp";

export type StreamSelection = {
    key: string,
    stream: StreamSpec,
    protocol: StreamProtocol, 
};

type StreamListener = (newMap: StreamMap, refreshKey: number) => void;

class StreamRefresher {
    running: boolean = false;
    updateScheduled: boolean = false;
    refreshKey: number = 0;

    constructor(private listener: StreamListener) {}

    updateStreamsOnce() {
        return getStreams().then(streams => {
            if (this.running) {
                this.refreshKey = Date.now();
                this.listener(streams, this.refreshKey);
            }
        });
    }

    updateStreamsAndScheduleNext() {
        this.updateStreamsOnce().then(() => {
            if (this.running) {
                if (!this.updateScheduled) {
                    setTimeout(() => { 
                        this.updateScheduled = false;
                        this.updateStreamsAndScheduleNext();
                    }, UPDATE_INTERVAL);
                }
                this.updateScheduled = true;
            }
        });
    }

    start() {
        if (!this.running) {
            this.running = true;
            this.updateStreamsAndScheduleNext();
        }
    }

    stop() {
        this.running = false;
    }
}

export default function StreamSelector({ 
    open=false,
    onClose=()=>{},
    onSelectionChange=(selection: StreamSelection|null) => {},
}) {
    const [[streams, refreshKey], setStreamsAndRefreshKey] = useState<[StreamMap, number]>([{}, 0]);
    const [streamRefresher, ] = useState<StreamRefresher>(new StreamRefresher(((streams, refreshKey) => setStreamsAndRefreshKey([streams, refreshKey]))));
    const [selection, setSelection] = useState<StreamSelection|null>(null);
   
    useEffect(() => { 
        if (open) {
            streamRefresher.start();
        } else {
            streamRefresher.stop();
        }
    }, [open, streamRefresher]);

    useEffect(() => { onSelectionChange(selection); }, [selection, onSelectionChange]);

    function selectStream(stream: string, protocol: StreamProtocol) {
        if (stream === selection?.key && protocol === selection?.protocol) {
            setSelection(null);
        } else {
            setSelection({key: stream, stream: streams[stream], protocol: protocol});
        }
    }

    var content;
    if (Object.entries(streams).length === 0) {
        content = <Box className="waiting-box">
            <img src={tuinfeest} className="waiting-icon" alt="waiting" /><br />
            <Typography variant="body1">Je moet nog even iemand schoppen om te gaan streamen.</Typography>
            <Typography variant="body2">Of zelf doen. Maar dan zou je naar jezelf moeten gaan kijken en dat zou dan weer raar zijn.</Typography>
        </Box>
    } else {
        content = Object.entries(streams).map(([key, props], i) => {
            var media;
            if (props.thumbnail) {
                media = (<CardMedia
                    component="img"
                    height="140"
                    src={props.thumbnail + "?" + refreshKey}
                />);
            }
            return (
                <Card 
                    key={key} 
                    sx={{ maxWidth: 345 }}
                    className={selection?.key === key ? "selected-stream-card" : ""}
                >
                    <CardActionArea
                        onClick={() => selectStream(key, DEFAULT_PROTOCOL)}
                    >
                        {media}
                        <CardContent>
                            <Typography gutterBottom variant="h5">
                                {props.name}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                                Live sinds {formatDateTime(props.created)}<br />
                                In glorious {props.video.width}×{props.video.height} @ {formatBitrate(props.video.bitrate)}
                            </Typography>
                        </CardContent>
                    </CardActionArea>
                    <CardActions>
                    {Object.entries(props.streams.main.protocols).map(([protocolString, url], i) => {
                        const protocol = protocolString as StreamProtocol; // for some reason Object.entries(T) returns [string, string] tuples in stead of [keyof T, string]
                        return <Button 
                            key={protocol} 
                            size="small"
                            onClick={() => selectStream(key, protocol)}
                        >
                            {protocol}
                        </Button>
                    })}
                    </CardActions>
                </Card>
            );
        });
    } 

    return (
        <Drawer
            open={open}
            onClose={onClose}
            anchor="top"
        >
            <Box sx={{p: 1}}>
                {content}
            </Box>
        </Drawer>
    );
}
