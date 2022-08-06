import { checkAuthentication, discardAuthentication, startAuthentication } from './BamApi';
import { Fragment, useEffect, useState } from "react";
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import { Button, DialogActions } from '@mui/material';
import { useSnackbar } from 'notistack';

type DiscordAuthProps = {
    setAuthenticated?: (authenticated: boolean) => void;
    setLogout?: (logout: () => void) => void;
    children?: React.ReactNode;
}

export default function DiscordAuth(props: DiscordAuthProps): JSX.Element {
    let [authenticated, setAuthenticated] = useState<boolean|undefined>(undefined);
    let [authError, setAuthError] = useState<any>();
    const { enqueueSnackbar, } = useSnackbar();
    
    useEffect(() => {
        try {
            setAuthenticated(checkAuthentication());
        } catch (authError) {
            setAuthError(authError);
        }
    }, []);

    useEffect(() => {
        if (props.setLogout) {
            props.setLogout(() => {
                console.log("doei");
                discardAuthentication();
                window.location.reload(); // OvenPlayer does not like getting destructed.. this is my last resort
            });
        }
    }, []);

    useEffect(() => {
        if (props.setAuthenticated !== undefined && authenticated !== undefined) {
            props.setAuthenticated(authenticated);
        }
    }, [authenticated]);

    useEffect(() => {
        if (authError) {
            enqueueSnackbar("Discord zei: " + authError + " 😞", {variant: 'error', preventDuplicate: true, persist: true});
        }
    }, [authError]);

    const refuse = () => {
        window.location.href = "https://www.youtube.com/watch?v=2IXf3UAYvdM";
    }
    
    if (authenticated === undefined) {
        return <Fragment />;
    }
    else if (authenticated) {
        return <Fragment>{props.children}</Fragment>;
    } else {
        return (
            <Dialog
                open={true}
                aria-labelledby="alert-dialog-title"
                aria-describedby="alert-dialog-description"
            >
            <DialogTitle id="alert-dialog-title">
                Members only
            </DialogTitle>
            <DialogContent>
                <DialogContentText id="alert-dialog-description">
                    We moeten even controleren dat je wel een Cool Persoon™ bent.
                    Daarom vragen we je om via Discord in te loggen.
                </DialogContentText>
                </DialogContent>
            <DialogActions>
                <Button onClick={refuse}>Nee.</Button>
                <Button onClick={startAuthentication} autoFocus>
                    Naar Discord!
                </Button>
                </DialogActions>
            </Dialog>
        );
    }
}