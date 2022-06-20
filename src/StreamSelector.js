import './StreamSelector.css';
import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Drawer from '@mui/material/Drawer';
import { getStreams } from './BamApi';
import { Button, Card, CardActionArea, CardActions, CardContent, CardMedia } from '@mui/material';
import tuinfeest from './tuinfeest.svg';
import { formatBitrate, formatDateTime } from 'FormatUtil';

const UPDATE_INTERVAL = 5000;

var refreshKey = Date.now();
var updateScheduled = false;

export default function StreamSelector({ 
    open=false,
    onClose=()=>{},
}) {
    const [streams, setStreams] = useState([]);
    const [selectedStream, setSelectedStream] = useState(null);
    const [selectedProtocol, setSelectedProtocol] = useState(null);
   
    useEffect(() => { onOpenChanged() }, [open])

    function updateStreamsOnce() {
        return getStreams().then(streams => {
            refreshKey = Date.now();
            setStreams(streams);
        });
    }

    function updateStreams() {
        updateStreamsOnce().then(() => {
            if (open) {
                if (!updateScheduled) {
                    setTimeout(() => { 
                        updateScheduled = false;
                        updateStreams();
                    }, UPDATE_INTERVAL);
                }
                updateScheduled = true;
            }
        });
    }

    function onOpenChanged() {
        if (open) {
            updateStreams();
        }
    }

    function selectStream(stream, protocol) {
        if (stream === selectedStream && selectedProtocol === protocol) {
            setSelectedStream(null);
            setSelectedProtocol(null);
        } else {
            setSelectedStream(stream);
            setSelectedProtocol(protocol);
        }
    }

    var content;
    if (Object.entries(streams).length === 0) {
        content = <Box className="waiting-box">
            <img src={tuinfeest} className="waiting-icon" alt="waiting" /><br />
            Waiting for someone to start streaming...
        </Box>
    } else {
        content = Object.entries(streams).map(([stream, props], i) => {
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
                key={stream} 
                sx={{ maxWidth: 345 }}
                className={selectedStream === stream ? "selected-stream-card" : ""}
            >
                <CardActionArea
                    onClick={() => selectStream(stream, null)}
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
                        onClick={() => selectStream(stream, protocol)}
                    >
                        {protocol}
                    </Button>
                ))}
                </CardActions>
            </Card>);
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
