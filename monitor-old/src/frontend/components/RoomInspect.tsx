import * as React from "react";
import * as http from "superagent";
import ReactJson from "react-json-view";
import { JsonEditor } from "react-json-edit";

import { remoteRoomCall, fetchRoomData } from "../services";

import {
  Table,
  TableBody,
  TableHeader,
  TableHeaderColumn,
  TableRow,
  TableRowColumn,
  TableFooter,
} from "material-ui/Table";

import AppBar from "material-ui/AppBar";
import Chip from 'material-ui/Chip';

import { Tabs, Tab } from 'material-ui/Tabs';

import Dialog from 'material-ui/Dialog';

import RemoveIcon from 'material-ui/svg-icons/content/remove-circle';
import DeleteForeverIcon from 'material-ui/svg-icons/action/delete-forever';
import SendIcon from 'material-ui/svg-icons/content/send';
import LockIcon from 'material-ui/svg-icons/action/lock';
import UnlockIcon from 'material-ui/svg-icons/action/lock-open';

import ArrowBackIcon from 'material-ui/svg-icons/navigation/arrow-back';

import IconButton from 'material-ui/IconButton';
import FlatButton from 'material-ui/FlatButton';
import { blue300 } from 'material-ui/styles/colors';

const buttonStyle = { marginRight: 12 };

// fetch room data every 5 seconds.
const FETCH_DATA_INTERVAL = 5000;
const SEND_TYPE_CACHE = '$$colyseus$type';
const SEND_DATA_CACHE = '$$colyseus$data';

export class RoomInspect extends React.Component {
    state = {
        roomId: undefined,
        state: {},
        clients: [],
        maxClients: 0,
        stateSize: 0,
        locked: false,

        sendDialogTitle: "",
        sendDialogOpen: false,
        sendToClient: undefined,
        sendType: localStorage.getItem(SEND_TYPE_CACHE) || "message_type",
        sendData: JSON.parse(localStorage.getItem(SEND_DATA_CACHE) || "{}")
    };

    updateDataInterval: number;

    componentDidMount() {
        this.fetchRoomData();
    }

    fetchRoomData () {
        const roomId = (this.props as any).match.params.roomId;

        fetchRoomData(roomId).
            then((response) => this.setState(response.body)).
            catch((err) => console.error(err));

        // re-set fetch interval
        clearInterval(this.updateDataInterval);
        this.updateDataInterval = window.setInterval(() => this.fetchRoomData(), FETCH_DATA_INTERVAL);
    }

    roomCall (method: string, ...args: any[]) {
        const roomId = (this.props as any).match.params.roomId

        return remoteRoomCall(roomId, method, ...args).
            then((response) => console.log(response.body)).
            catch((err) => console.error(err));
    }

    componentWillUnmount () {
        clearInterval(this.updateDataInterval);
    }

    sendMessage(sessionId?: string) {
        const sendToClient = (sessionId)
            ? sessionId
            : undefined;

        let sendDialogTitle = (sessionId)
            ? `Send message to client (${sessionId})`
            : "Broadcast message to all clients";

        this.setState({
            sendToClient,
            sendDialogTitle,
            sendDialogOpen: true
        });
    }

    disconnectClient(sessionId: string) {
        /**
         * `room._forceClientDisconnect` has been added via ext/Room.ts
         */
        this.roomCall('_forceClientDisconnect', sessionId).
            then(() => this.fetchRoomData());
    }

    disposeRoom () {
        this.roomCall('disconnect', this.state.roomId).
            then(() => {
                (this.props as any).history.push('/');
            });
    }

    updateSendType = (e) => {
        const sendType = e.target.value;
        localStorage.setItem(SEND_TYPE_CACHE, sendType);
	this.setState({ sendType })
    }

    updateSendData = (changes) => {
        localStorage.setItem(SEND_DATA_CACHE, JSON.stringify(changes));
        // this.setState({ sendData: changes });
        this.state.sendData = changes;
    }

    handleCloseSend = () => {
        this.setState({ sendDialogOpen: false });
    }

    handleSend = () => {
        /**
         * `room._sendMessageToClient` has been added via ext/Room.ts
         */
        let promise = (this.state.sendToClient)
            ? this.roomCall('_sendMessageToClient', this.state.sendToClient, this.state.sendType, this.state.sendData)
            : this.roomCall('broadcast', this.state.sendType, this.state.sendData);

        promise.then(() => this.handleCloseSend());
    }

    goBack() {
        const history = (this.props as any).history;
        history.goBack();
    }

    render() {
        const actions = [
            <FlatButton
                label="Cancel"
                primary={true}
                onClick={this.handleCloseSend}
            />,
            <FlatButton
                label="Send"
                primary={true}
                onClick={this.handleSend}
                keyboardFocused={true}
            />,
        ];

        return (
            <div>
                <AppBar
                    iconElementLeft={
                    <IconButton onClick={this.goBack.bind(this)}>
                        <ArrowBackIcon />
                    </IconButton>
                    }
                    title={'Room ' + this.state.roomId}>
                </AppBar>

                <Table>
                    <TableBody displayRowCheckbox={false}>
                        <TableRow>
                            <TableRowColumn>
                                <div style={{display: 'flex', alignItems: 'center', verticalAlign: 'center'}}>
                                    { (this.state.locked) ? <LockIcon /> : <UnlockIcon /> }
                                    { (this.state.locked) ? 'Locked' : 'Unlocked' }
                                </div>
                            </TableRowColumn>
                            <TableRowColumn>
                                <div style={{display: 'flex', alignItems: 'center'}}>
                                    Clients
                                    <Chip style={{marginLeft: '5px'}} backgroundColor={blue300}>
                                    {this.state.clients.length}{this.state.maxClients ? ' / ' + this.state.maxClients : ''}
                                    </Chip>
                                </div>
                            </TableRowColumn>
                            <TableRowColumn>
                                <div style={{display: 'flex', alignItems: 'center'}}>
                                    State Size
                                    <Chip style={{marginLeft: '5px'}} backgroundColor={blue300}>
                                    {this.state.stateSize} bytes
                                    </Chip>
                                </div>
                            </TableRowColumn>
                            <TableRowColumn>
                                <FlatButton
                                    label="Broadcast"
                                    icon={<SendIcon />}
                                    onClick={this.sendMessage.bind(this, undefined)}
                                    style={buttonStyle}
                                />

                                <FlatButton
                                    label="Dispose room"
                                    secondary={true}
                                    icon={<DeleteForeverIcon />}
                                    onClick={this.disposeRoom.bind(this)}
                                    style={buttonStyle}
                                />
                            </TableRowColumn>
                        </TableRow>
                    </TableBody>
                </Table>

                <Tabs>
                    <Tab label="Clients">
                        <Table>
                            <TableHeader displaySelectAll={false} adjustForCheckbox={false}>
                                <TableRow>
                                    <TableHeaderColumn>sessionId</TableHeaderColumn>
                                    <TableHeaderColumn>actions</TableHeaderColumn>
                                </TableRow>
                            </TableHeader>
                            <TableBody displayRowCheckbox={false}>
                                {this.state.clients.map((client, i) => (
                                    <TableRow key={client.sessionId}>
                                        <TableRowColumn>{client.sessionId}</TableRowColumn>
                                        <TableRowColumn>
                                            <FlatButton
                                                label="Send"
                                                icon={<SendIcon />}
                                                style={buttonStyle}
                                                onClick={this.sendMessage.bind(this, client.sessionId)}
                                            />

                                            <FlatButton
                                                label="Disconnect"
                                                secondary={true}
                                                icon={<RemoveIcon />}
                                                style={buttonStyle}
                                                onClick={this.disconnectClient.bind(this, client.sessionId)}
                                            />
                                            {/* <FlatButton label="Broadcast" style={buttonStyle} /> */}
                                        </TableRowColumn>
                                    </TableRow>
                                ))}
                            </TableBody>

                            <TableFooter>
                                <TableRow>
                                    <TableHeaderColumn style={{ textAlign: "right" }} colSpan={3}>
                                    </TableHeaderColumn>
                                </TableRow>
                            </TableFooter>

                        </Table>
                    </Tab>

                    <Tab label="State">
                        <ReactJson name={null} src={this.state.state} />
                    </Tab>
                </Tabs>

                <Dialog
                    title={this.state.sendDialogTitle}
                    actions={actions}
                    modal={false}
                    open={this.state.sendDialogOpen}
                    onRequestClose={this.handleCloseSend}
                >
                    <h2>Message type:</h2>
                    <input type="text" value={this.state.sendType} onChange={this.updateSendType} />

                    <h2>Message payload</h2>
                    <JsonEditor value={this.state.sendData} propagateChanges={this.updateSendData} />
                </Dialog>

            </div>
        );
    }
}
