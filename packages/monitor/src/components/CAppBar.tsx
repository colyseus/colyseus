import * as React from "react";
import { AppBar, Toolbar, Typography } from '@mui/material';

export function CAppBar() {
    return (
        <AppBar position="static" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
            <Toolbar variant="dense">
                <Typography variant="subtitle1" fontWeight={600} component="div" sx={{ flexGrow: 1 }}>
                    Colyseus Monitor v{ process.env.npm_package_version }
                </Typography>
            </Toolbar>
        </AppBar>
    );
}
