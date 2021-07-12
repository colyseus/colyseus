import React from "react";
import { createHashHistory } from "history";
import { Router, Route } from "react-router-dom";

import MuiThemeProvider from 'material-ui/styles/MuiThemeProvider';

import { CAppBar } from "./components/CAppBar";
import { RoomList } from "./components/RoomList";
import { RoomInspect } from "./components/RoomInspect";

const history = createHashHistory();

export function App () {
    return (
        <Router history={history}>
            <MuiThemeProvider>
                <CAppBar />

                <Route exact path="/" component={RoomList} />
                <Route path="/room/:roomId" component={RoomInspect} />
            </MuiThemeProvider>
        </Router>
    );
}
