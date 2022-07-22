import ReactDOM from 'react-dom/client';
import './index.css';
import 'typeface-roboto'
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import theme from './theme';
import App from './App';
import { SnackbarProvider } from 'notistack';
import Crypto from 'crypto';

import OAuth, { TokenRequestResult } from 'discord-oauth2';

type DiscordAccess = {
  token: TokenRequestResult,
  expireTime: Date
};

const oauth = new OAuth({
  clientId: "1000107540442513568",
	clientSecret: "wnZZtA2FQTdnlmmVMevtwsXlMDjG6d5F",
  redirectUri: "http://localhost:3000/authcallback",
});

let auth = ((v)=>{ return v == null ? undefined : JSON.parse(v) as DiscordAccess})(localStorage.getItem("discord-oauth2"));
let expiredTime = (()=>{let d = new Date(); d.setHours(d.getHours() - 1); return d;})();
var authPromise = Promise.resolve(auth);

try {
  // TODO: token refresh
  // TODO abstract authorization away in some service

  if (window.location.pathname == "/authcallback") {
    authPromise = handleAuthCallback();
    window.history.pushState(null, "", "/");
  }

  authPromise.then((auth) => {
    if (auth == null || auth.expireTime <= expiredTime) {
      startAuth();
    }
    else {
    
      const root = ReactDOM.createRoot(document.getElementById('root') as Element);
      root.render(
        // <React.StrictMode>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <SnackbarProvider>
            <App />
          </SnackbarProvider>
        </ThemeProvider>
        // </React.StrictMode>
      );
    }
  });
} catch (authError) {
  (document.getElementById('root') as Element).innerHTML = "Discord says: " + authError + " 😿";
}

function startAuth() {
  var state = Crypto.randomBytes(16).toString("hex");
  localStorage.setItem("discord-oauth2-state", state);
  window.location.href = oauth.generateAuthUrl({
    scope: ["identify", "guilds"],
    state: state,
  });
}

function handleAuthCallback() {
  const urlParams = new URLSearchParams(window.location.search);
  var code = urlParams.get("code");
  var error = urlParams.get("error");
  var state = urlParams.get("state");
  var expectedState = localStorage.getItem("discord-oauth2-state");
  localStorage.removeItem("discord-oauth2-state");
  if (state === expectedState) {
    if (code) {
      return oauth.tokenRequest({
        code: code,
        scope: "identify guilds",
        grantType: "authorization_code",
      }).then((token) => { 
        var expireTime = new Date();
        expireTime.setSeconds(expireTime.getSeconds() + token.expires_in);
        var auth = { token, expireTime};
        localStorage.setItem("discord-oauth2", JSON.stringify(auth));
        return auth;
      });
    }
    else if (error) {
      throw urlParams.get("error_description");
    }
  } else {
    console.error("Stored state and auth callback state mismatch");
  }
  return Promise.resolve(undefined);
}
