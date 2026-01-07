// @ts-nocheck
import React from "react";
import { createHashHistory } from "history";
import { Router, Route } from "react-router-dom";

import { useMediaQuery, CssBaseline, createTheme, ThemeProvider } from '@mui/material';

import { CAppBar } from "./components/CAppBar";
import { RoomList } from "./components/RoomList";
import { RoomInspect } from "./components/RoomInspect";

const history = createHashHistory();

export function App () {
    const prefersDarkMode = useMediaQuery('(prefers-color-scheme: dark)');
    const theme = React.useMemo(
        () =>
            createTheme({
                palette: {
                    mode: prefersDarkMode ? 'dark' : 'light',
                },
            }),
        [prefersDarkMode],
    );

    return (
        <Router history={history}>
            <ThemeProvider theme={theme}>
                <CssBaseline />
                <CAppBar />
                <Route exact path="/" component={RoomList} />
                <Route path="/room/:roomId" component={RoomInspect} />
            </ThemeProvider>
        </Router>
    );
}
