import './StreamSelector.css';
import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Drawer from '@mui/material/Drawer';
import { StreamMap, StreamProtocol } from './BamApi';
import { Button, Card, CardActionArea, CardActions, CardContent, CardMedia, Checkbox, FormControlLabel, makeStyles } from '@mui/material';
import tuinfeest from './tuinfeest.svg';
import { formatBitrate, formatDateTime } from './FormatUtil';
import { NO_SELECTION, StreamSelection, StreamSelectionRequest } from './StreamManager';
import FormGroup from '@mui/material/FormGroup';
import theme from './theme';

export type StreamSelectorProps = {
    open: boolean,
    onClose: () => void,
    streams: StreamMap,
    screenshotTimestamp: number,
    onStreamRequested: (selection: StreamSelectionRequest) => void,
    currentStream: StreamSelection,
    onMouseOver?: React.MouseEventHandler<HTMLDivElement>,
    onMouseOut?: React.MouseEventHandler<HTMLDivElement>,
    startStreamWhenAvailable?: boolean,
    setStartStreamWhenAvailable?: (startStreamWhenAvailable: boolean) => void,
};

export default function StreamSelector(props: StreamSelectorProps) {
    const {
        open,
        onClose,
        streams,
        screenshotTimestamp,
        onStreamRequested,
        currentStream,
        onMouseOver = () => {},
        onMouseOut = () => {},
        startStreamWhenAvailable = true,
        setStartStreamWhenAvailable = (ignore) => {},
    } = props;

    const [selection, setSelection] = useState<StreamSelectionRequest>(NO_SELECTION);

    useEffect(() => { onStreamRequested(selection); }, [selection]);

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
        <Drawer
            open={open}
            onClose={onClose}
            anchor="top"
        >
            <Box
                onMouseOver={onMouseOver}
                onMouseOut={onMouseOut}
            >
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
                <Box sx={{paddingLeft: 2, paddingRight: 2}} display="flex" justifyContent="flex-end">
                    <FormGroup>
                        <FormControlLabel control={
                            <Checkbox checked={startStreamWhenAvailable} onChange={() => setStartStreamWhenAvailable(!startStreamWhenAvailable)} />
                        } label="Doe maar een streampie. Als het beweegt wil ik het zien." />
                    </FormGroup>
                </Box>
            </Box>
        </Drawer>
    );
}
