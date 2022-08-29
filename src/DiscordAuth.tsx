import { checkAuthentication, discardAuthentication, getUserInfo, startAuthentication, UserInfo } from './BamApi';
import { Fragment, useEffect, useState } from "react";
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import { Button, DialogActions, Typography } from '@mui/material';
import { useSnackbar } from 'notistack';

type DiscordAuthProps = {
    setUserInfo?: (userInfo: UserInfo) => void;
    setAuthenticated?: (authenticated: boolean) => void;
    setLogout?: (logout: () => void) => void;
    children?: React.ReactNode;
}

export default function DiscordAuth(props: DiscordAuthProps): JSX.Element {
    const [discordAuthenticated, setDiscordAuthenticated] = useState<boolean|undefined>(undefined);
    const [discordAuthError, setDiscordAuthError] = useState<any>();
    const [apiAuthError, setApiAuthError] = useState<any>();
    const [userInfo, setUserInfo] = useState<UserInfo>();
    const { enqueueSnackbar, } = useSnackbar();
    
    useEffect(() => {
        try {
            setDiscordAuthenticated(checkAuthentication());
        } catch (authError) {
            setDiscordAuthError(authError);
        }
    }, []);

    useEffect(() => {
        if (props.setLogout) {
            props.setLogout(() => {
                discardAuthentication();
                window.location.reload(); // OvenPlayer does not like getting destructed.. this is my last resort
            });
        }
    }, []);

    useEffect(() => {
        if (props.setUserInfo && userInfo) {
            props.setUserInfo(userInfo);
        }
    }, [userInfo]);

    useEffect(() => {
        if (props.setAuthenticated !== undefined && discordAuthenticated !== undefined) {
            props.setAuthenticated(!!(discordAuthenticated && userInfo));
        }
        if (discordAuthenticated && !userInfo) {
            getUserInfo().then(
                (userInfo) => {setUserInfo(userInfo);}
            ).catch((reason) => {
                setApiAuthError(reason instanceof Error ? reason.message : reason);
            })
        }
    }, [discordAuthenticated, userInfo]);

    useEffect(() => {
        if (discordAuthError) {
            enqueueSnackbar("Discord zei: " + discordAuthError + " 😞", {variant: 'error', preventDuplicate: true, persist: true});
        }
    }, [discordAuthError]);

    const refuse = () => {
        window.location.href = "https://www.youtube.com/watch?v=2IXf3UAYvdM";
    }
    
    if (apiAuthError || discordAuthError) {
        return (
            <Dialog
                open={true}
                aria-labelledby="alert-dialog-title"
                aria-describedby="alert-dialog-description"
            >
            <DialogTitle id="alert-dialog-title">
                Hold up
            </DialogTitle>
            <DialogContent>
                <DialogContentText id="alert-dialog-description">
                    We kunnen niet verifiëren dat je een Cool Persoon™ bent... probeer even opnieuw in te loggen, en check of je het goeie account te pakken hebt.
                </DialogContentText>
                <DialogContentText variant="body2" sx={{paddingTop: "1em"}}>
                    {apiAuthError ? "De server zei \"" + apiAuthError + "\"" : "Discord zei \"" + discordAuthError + "\""}
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
    else if (discordAuthenticated && userInfo) {
        return <Fragment>{props.children}</Fragment>;
    } else if (discordAuthenticated === false) {
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
    } else {
        // Stuff is loading; no error, but no auth either
        return <Fragment />
    }
}