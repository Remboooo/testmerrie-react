import './StreamSelector.css';
import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { StreamMap, StreamProtocol } from './BamApi';
import { Button, Card, CardActionArea, CardActions, CardContent, CardMedia } from '@mui/material';
import tuinfeest from './tuinfeest.svg';
import { formatBitrate, formatDateTime } from './FormatUtil';
import { NO_SELECTION, StreamSelection, StreamSelectionRequest } from './StreamManager';
import theme from './theme';

export type StreamSelectorProps = {
    streams: StreamMap,
    screenshotTimestamp: number,
    onStreamRequested: (selection: StreamSelectionRequest) => void,
    currentStream: StreamSelection,
};

export default function StreamSelector(props: StreamSelectorProps) {
    const {
        streams,
        screenshotTimestamp,
        onStreamRequested,
        currentStream,
    } = props;

    const [selection, setSelection] = useState<StreamSelectionRequest|null>(null);

    useEffect(() => { 
        if (selection !== null) {
            onStreamRequested(selection);
        } 
    }, [selection]);

    function selectStream(stream: string, protocol: StreamProtocol|null) {
        var newSelection: StreamSelectionRequest;
        if (stream === selection?.key && (protocol === selection?.protocol || protocol === null)) {
            newSelection = NO_SELECTION;
        } else {
            newSelection = {key: stream, protocol: protocol};
        }
        console.log("New selection", newSelection);
        setSelection(newSelection);
    }

    var content;
    if (streams === undefined) {
        content = <Box className="waiting-box">
            <Typography variant="body1">Er gaat iets mis, ik kon de streams niet ophalen 😞</Typography>
        </Box>
    }
    else if (Object.entries(streams).length === 0) {
        content = <Box className="waiting-box">
            <img src={tuinfeest + "#svgView(viewBox(0,0,100,100))"} className="waiting-icon" alt="waiting" /><br />
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
                    src={props.thumbnail + "?" + screenshotTimestamp}
                />);
            }
            const isSelected = currentStream?.key === key;
            return (
                <Card 
                    key={key} 
                    sx={{ maxWidth: 345, margin: theme.spacing(1) }}
                    className={isSelected ? "selected-stream-card" : ""}
                >
                    <CardActionArea
                        onClick={() => selectStream(key, null)}
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
                        const isSelectedProtocol = isSelected && currentStream?.protocol === protocol;
                        return <Button 
                            key={protocol} 
                            variant={isSelectedProtocol ? "contained" : "text"}
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
        <Box 
            sx={{
                p: 1, 
                width: '100%',
                flexGrow: 1,
                display: 'flex'
            }}
        >
            {content}
        </Box>
    );
}
