import * as React from "react";
import { JsonEditor } from "react-json-edit";

import ReactJson from "react18-json-view";
import 'react18-json-view/src/style.css'

import { remoteRoomCall, fetchRoomData } from "../services";

import {
    AppBar,
    IconButton,
    Toolbar,
    Typography,
    Chip,
    Table,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Paper,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Tab,
    Box
} from '@mui/material';

import { DataGrid, GridColDef, gridNumberComparator } from '@mui/x-data-grid';

import {
    TabContext,
    TabList,
    TabPanel
} from '@mui/lab';

import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import LockIcon from '@mui/icons-material/Lock';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import SendIcon from '@mui/icons-material/Send';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import DoDisturbOnIcon from '@mui/icons-material/DoDisturbOn';
import { humanizeElapsedTime, valueFormatter } from "../helpers/helpers";

// fetch room data every 5 seconds.
const FETCH_DATA_INTERVAL = 5000;
const SEND_TYPE_CACHE = '$$colyseus$type';
const SEND_DATA_CACHE = '$$colyseus$data';

interface Props {}
interface State {
  roomId?: string,
  state: any,
  clients: Array<{ sessionId: string, elapsedTime: number }>,
  maxClients: number,
  stateSize: number,
  locked: boolean,
  currentTab: string,
  sendDialogTitle: string,
  sendDialogOpen: boolean,
  sendToClient?: any,
  sendType: string,
  sendData: string,
}

export class RoomInspect extends React.Component<Props, State> {
    state: State = {
        roomId: undefined,
        state: {},
        clients: [],
        maxClients: 0,
        stateSize: 0,
        locked: false,
        currentTab: "1",
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
            then((data) => this.setState(data)).
            catch((err) => console.error(err));

        // re-set fetch interval
        clearInterval(this.updateDataInterval);
        this.updateDataInterval = window.setInterval(() => this.fetchRoomData(), FETCH_DATA_INTERVAL);
    }

    roomCall (method: string, ...args: any[]) {
        const roomId = (this.props as any).match.params.roomId

        return remoteRoomCall(roomId, method, ...args).
            then((response) => console.log(response)).
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
        this.roomCall('disconnect').
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
        window.history.back()
    }

    handleTabChange = (event: React.SyntheticEvent, newValue: string) => {
        this.setState({ currentTab: newValue });
    };

    render() {
        const client_columns: GridColDef[] = [
            {
                field: "sessionId",
                headerName: "sessionId",
                flex: 1,
            },
            {
                field: "elapsedTime",
                headerName: "elapsedTime",
                flex: 1,
                valueFormatter: valueFormatter.elapsedTime,
                sortComparator: gridNumberComparator
            } as GridColDef,
            {
                field: "actions",
                headerName: "actions",
                flex: 1,
                renderCell: (param) => {
                    return <>
                        <Button variant="text" startIcon={<SendIcon />} onClick={this.sendMessage.bind(this, param.id)}>
                            Send
                        </Button>
                        <Button variant="text" color="error" startIcon={<DoDisturbOnIcon />} onClick={this.disconnectClient.bind(this, param.id)}>
                            Disconnect
                        </Button>
                    </>
                }
            }
        ]
        const client_rows = this.state.clients.map(client => {
            return {
                id: client.sessionId,
                sessionId: client.sessionId,
                elapsedTime: client.elapsedTime,
                actions: client.sessionId,
            };
        });

        return (
            <div>
                <AppBar position="static">
                    <Toolbar>
                        <IconButton aria-label="delete" onClick={this.goBack.bind(this)}>
                            <ArrowBackIcon />
                        </IconButton>
                        <Typography
                            variant="h6"
                            noWrap
                            component="div"
                            sx={{ flexGrow: 1 }}
                        >
                            {'Room ' + this.state.roomId}
                        </Typography>
                    </Toolbar>
                </AppBar>
                <TableContainer component={Paper}>
                    <Table aria-label="simple table">
                        <TableHead>
                            <TableRow>
                                <TableCell align={"center"}>
                                    {(this.state.locked) ? <LockIcon /> : <LockOpenIcon />}
                                    {(this.state.locked) ? 'Locked' : 'Unlocked'}
                                </TableCell>

                                <TableCell align={"center"}>
                                    Clients
                                    <Chip sx={{ marginLeft: "6px" }} size="small" color="primary" label={`${this.state.clients.length}${(this.state.maxClients ? ' / ' + this.state.maxClients : '')}`} />
                                </TableCell>

                                <TableCell align={"center"}>
                                    State Size
                                    <Chip sx={{ marginLeft: "6px" }} size="small" color="primary" label={`${this.state.stateSize} bytes`} />
                                </TableCell>

                                <TableCell align={"center"}>
                                    <Button variant="text" startIcon={<SendIcon />} onClick={this.sendMessage.bind(this, undefined)}>
                                        Broadcast
                                    </Button>
                                </TableCell>

                                <TableCell align={"center"}>
                                    <Button variant="text" color="error" startIcon={<DeleteForeverIcon />} onClick={this.disposeRoom.bind(this)}>
                                        Dispose room
                                    </Button>
                                </TableCell>

                            </TableRow>
                        </TableHead>
                    </Table>
                </TableContainer>

                <TabContext value={this.state.currentTab}>
                    <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
                        <TabList onChange={this.handleTabChange} aria-label="lab API tabs example" variant={"fullWidth"}>
                            <Tab label="Clients" value="1" />
                            <Tab label="State" value="2" />
                        </TabList>
                    </Box>
                    <TabPanel value="1">
                        <DataGrid
                            columns={client_columns}
                            rows={client_rows}
                            sx={{ overflow: "hidden" }}
                            disableRowSelectionOnClick
                            hideFooter
                            hideFooterPagination
                            hideFooterSelectedRowCount
                        />
                    </TabPanel>
                    <TabPanel value="2">
                        <ReactJson src={this.state.state} theme={"default"} />
                    </TabPanel>
                </TabContext>

                <Dialog
                    open={this.state.sendDialogOpen}
                    onClose={this.handleCloseSend}
                    aria-labelledby="alert-dialog-title"
                    aria-describedby="alert-dialog-description"
                >
                    <DialogTitle id="alert-dialog-title">
                        {this.state.sendDialogTitle}
                    </DialogTitle>
                    <DialogContent>
                        <h2>Message type:</h2>
                        <input type="text" value={this.state.sendType} onChange={this.updateSendType} />

                        <h2>Message payload</h2>
                        <JsonEditor value={this.state.sendData} propagateChanges={this.updateSendData} />
                    </DialogContent>
                    <DialogActions>
                        <Button
                            variant="text"
                            color="error"
                            onClick={this.handleCloseSend}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="text"
                            onClick={this.handleSend}
                        >
                            Send
                        </Button>
                    </DialogActions>
                </Dialog>
            </div>
        );
    }
}

