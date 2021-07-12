import * as React from "react";

import AppBar from 'material-ui/AppBar';
import Drawer from 'material-ui/Drawer';
import MenuItem from 'material-ui/MenuItem';

import FontIcon from 'material-ui/FontIcon';
import IconMenu from 'material-ui/IconMenu';

import IconButton from 'material-ui/IconButton';
import CachedIcon from 'material-ui/svg-icons/action/cached';

const Refresh = (props) => (
    <IconMenu
        {...props}
        iconButtonElement={
            <IconButton><CachedIcon /></IconButton>
        }
        targetOrigin={{ horizontal: 'right', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'top' }}
    >
        <MenuItem primaryText="Refresh" />
        <MenuItem primaryText="Help" />
        <MenuItem primaryText="Sign out" />
    </IconMenu>
)

export class CAppBar extends React.Component {
    state = {
        open: true
    };

    handleToggle = () => {
        this.setState({ open: !this.state.open });
    }

    render () {
        return (<div>
            <AppBar
                title="Colyseus"
                showMenuIconButton={false}
                // iconElementRight={<Refresh />}
                // onLeftIconButtonClick={this.handleToggle}
            />
            {/*<Drawer open={this.state.open}>
                <AppBar
                    title="Colyseus"
                    onLeftIconButtonClick={this.handleToggle}
                    />
                <MenuItem>Rooms</MenuItem>
            </Drawer>*/}
        </div>);
    }
}