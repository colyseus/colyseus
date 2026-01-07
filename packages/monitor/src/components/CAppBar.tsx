import * as React from "react";
import { AppBar, Toolbar, Typography } from '@mui/material';

export class CAppBar extends React.Component {
    state = {
        open: true
    };

    handleToggle = () => {
        this.setState({ open: !this.state.open });
    }

    render () {
        return (<div>
            <AppBar position="static">
                <Toolbar>
                    <Typography
                        variant="h6"
                        noWrap
                        component="div"
                        sx={{ flexGrow: 1 }}
                    >
                        Colyseus Monitor v{ process.env.npm_package_version }
                    </Typography>
                </Toolbar>
            </AppBar>
        </div>);
    }
}
