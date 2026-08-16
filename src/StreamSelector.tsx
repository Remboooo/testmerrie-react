import './StreamSelector.css';
import { SyntheticEvent, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { StreamMap, StreamProtocol, StreamQuality } from './BamApi';
import { Card, CardActionArea, CardContent, CardMedia, Divider, FormControl, FormControlLabel, FormLabel, Link, Radio, RadioGroup } from '@mui/material';
import tuinfeest from './tuinfeest.svg';
import { formatBitrate, formatDateTime } from './FormatUtil';
import { NO_SELECTION, StreamSelection, StreamSelectionRequest } from './StreamManager';
import theme from './theme';
import { useSnackbar } from 'notistack';

export type StreamSelectorProps = {
    streams: StreamMap,
    screenshotTimestamp: number,
    onStreamRequested: (selection: StreamSelectionRequest) => void,
    currentStream: StreamSelection,
    endedStream: StreamSelection,
};

export default function StreamSelector(props: StreamSelectorProps) {
    const {
        streams,
        screenshotTimestamp,
        onStreamRequested,
        currentStream,
        endedStream,
    } = props;

    const { enqueueSnackbar, } = useSnackbar();

    function selectStream(stream: string|null, protocol: StreamProtocol|null, quality: StreamQuality|null) {
        var newSelection: StreamSelectionRequest;
        
        if (stream === null || (stream == currentStream?.key && (quality == currentStream?.quality || quality === null))) {
            newSelection = NO_SELECTION;
        } else {
            newSelection = {key: stream, protocol, quality};
        }
        console.log("select stream", newSelection);
        onStreamRequested(newSelection);
    }

    // A stream we were watching that dropped off the list: keep it visible,
    // greyed, until it comes back (the StreamManager auto-resumes it). Click to
    // stop waiting.
    const endedCard = endedStream ? (
        <Card
            key={"ended-" + endedStream.key}
            sx={{ maxWidth: 345, margin: theme.spacing(1), opacity: 0.55 }}
            className="ended-stream-card"
        >
            <CardActionArea onClick={() => selectStream(null, null, null)}>
                <CardContent>
                    <Typography gutterBottom variant="h5">{endedStream.stream.name}</Typography>
                    <Typography variant="body2" color="text.secondary">
                        Gestopt — komt vanzelf terug zodra er weer gestreamd wordt.<br />
                        Klik om te stoppen met wachten.
                    </Typography>
                </CardContent>
            </CardActionArea>
        </Card>
    ) : null;

    var content;
    if (streams === undefined) {
        content = <Box className="waiting-box">
            <Typography variant="body1">Er gaat iets mis, ik kon de streams niet ophalen 😞</Typography>
        </Box>
    }
    else if (Object.entries(streams).length === 0 && !endedStream) {
        content = <Box className="waiting-box">
            <img src={tuinfeest + "#svgView(viewBox(0,0,100,100))"} className="waiting-icon" alt="waiting" /><br />
            <Typography variant="body1">Je moet nog even iemand schoppen om te gaan streamen.</Typography>
            <Typography variant="body2">Of zelf doen. Maar dan zou je naar jezelf moeten gaan kijken en dat zou dan weer raar zijn.</Typography>
        </Box>
    } else {
        content = <>{endedCard}{Object.entries(streams).map(([key, props], i) => {
            var media;
            if (props.thumbnail) {
                media = (<CardMedia
                    component="img"
                    height="140"
                    className="thumbnail"
                    src={props.thumbnail + "&" + screenshotTimestamp}
                    onError={(e: SyntheticEvent<HTMLImageElement>) => {
                        (e.target as HTMLImageElement).src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
                    }}
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
                        onClick={() => isSelected ? selectStream(null, null, null) : selectStream(key, null, null)}
                    >
                        {media}
                        <CardContent>
                            <Typography gutterBottom variant="h5">
                                {props.name}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                                {props.created ? <>Live sinds {formatDateTime(props.created)}</>:null }<br />
                                {props.video ? <>In glorious {props.video.width || '?'}×{props.video.height || '?'} @ {formatBitrate(props.video.bitrate)}</>:null}                                
                            </Typography>
                        </CardContent>
                    </CardActionArea>
                </Card>
            );
        })}</>;
    }

    return (
        <Box 
            className="stream-selector"
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
