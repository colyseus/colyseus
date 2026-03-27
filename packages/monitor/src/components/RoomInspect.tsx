import * as React from "react";
import { JsonEditor, githubDarkTheme, githubLightTheme } from "json-edit-react";

import { remoteRoomCall, fetchRoomData } from "../services";

import {
    AppBar,
    Box,
    Button,
    Chip,
    Container,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    IconButton,
    Paper,
    Stack,
    Tab,
    TextField,
    Toolbar,
    Tooltip,
    Typography,
} from '@mui/material';

import { DataGrid, GridColDef, gridNumberComparator } from '@mui/x-data-grid';

import {
    TabContext,
    TabList,
    TabPanel
} from '@mui/lab';

import { useTheme } from '@mui/material/styles';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import LockIcon from '@mui/icons-material/Lock';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import SendIcon from '@mui/icons-material/Send';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import DoDisturbOnIcon from '@mui/icons-material/DoDisturbOn';
import CableOutlined from '@mui/icons-material/CableOutlined';
import DataObjectOutlined from '@mui/icons-material/DataObjectOutlined';
import { valueFormatter } from "../helpers/helpers";

function ThemedJsonEditor(props: any) {
    const theme = useTheme();
    return <JsonEditor {...props} theme={theme.palette.mode === 'dark' ? githubDarkTheme : githubLightTheme} />;
}

function StatCard({ icon, label, value }: { icon?: React.ReactNode, label: string, value: string | number }) {
    return (
        <Paper variant="outlined" sx={{ flex: 1, px: 2.5, py: 1.5, textAlign: 'center' }}>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5, fontSize: '0.7rem' }}>
                {icon && <Box component="span" sx={{ verticalAlign: 'middle', mr: 0.5 }}>{icon}</Box>}
                {label}
            </Typography>
            <Typography variant="h6" fontWeight={600} sx={{ mt: 0.25 }}>
                {value}
            </Typography>
        </Paper>
    );
}

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
        this.state.sendData = changes;
    }

    handleCloseSend = () => {
        this.setState({ sendDialogOpen: false });
    }

    handleSend = () => {
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

    handleStateEdit = ({ newValue, path }) => {
        this.roomCall('_editStateProperty', path, newValue)
            .then(() => this.fetchRoomData());
    }

    handleStateDelete = ({ path }) => {
        this.roomCall('_deleteStateProperty', path)
            .then(() => this.fetchRoomData());
    }

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
                headerName: "",
                width: 200,
                sortable: false,
                renderCell: (param) => {
                    return (
                        <Stack direction="row" spacing={0.5}>
                            <Button size="small" variant="text" startIcon={<SendIcon />} onClick={this.sendMessage.bind(this, param.id)}>
                                Send
                            </Button>
                            <Tooltip title="Disconnect client">
                                <IconButton size="small" color="error" onClick={this.disconnectClient.bind(this, param.id)}>
                                    <DoDisturbOnIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                        </Stack>
                    );
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

        const clientsLabel = this.state.maxClients
            ? `${this.state.clients.length} / ${this.state.maxClients}`
            : `${this.state.clients.length}`;

        return (
            <Box>
                <AppBar position="static" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
                    <Toolbar variant="dense">
                        <IconButton edge="start" size="small" onClick={this.goBack.bind(this)} sx={{ mr: 1 }}>
                            <ArrowBackIcon />
                        </IconButton>
                        <Typography variant="subtitle1" fontWeight={600} sx={{ flexGrow: 1 }}>
                            Room {this.state.roomId}
                        </Typography>
                        <Stack direction="row" spacing={1}>
                            <Button size="small" variant="outlined" startIcon={<SendIcon />} onClick={this.sendMessage.bind(this, undefined)}>
                                Broadcast
                            </Button>
                            <Button size="small" variant="outlined" color="error" startIcon={<DeleteForeverIcon />} onClick={this.disposeRoom.bind(this)}>
                                Dispose
                            </Button>
                        </Stack>
                    </Toolbar>
                </AppBar>

                <Container maxWidth="lg" sx={{ py: 3 }}>
                    <Stack spacing={2}>
                        <Stack direction="row" spacing={1.5}>
                            <StatCard
                                icon={this.state.locked ? <LockIcon sx={{ fontSize: 14 }} /> : <LockOpenIcon sx={{ fontSize: 14 }} />}
                                label="Status"
                                value={this.state.locked ? 'Locked' : 'Unlocked'}
                            />
                            <StatCard icon={<CableOutlined sx={{ fontSize: 14 }} />} label="Clients" value={clientsLabel} />
                            <StatCard icon={<DataObjectOutlined sx={{ fontSize: 14 }} />} label="State Size" value={`${this.state.stateSize} B`} />
                        </Stack>

                        <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
                            <TabContext value={this.state.currentTab}>
                                <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
                                    <TabList onChange={this.handleTabChange} variant="fullWidth">
                                        <Tab
                                            label={<Box sx={{ display: 'flex', alignItems: 'center' }}>Clients <Chip size="small" label={this.state.clients.length} sx={{ ml: 1 }} /></Box>}
                                            value="1"
                                        />
                                        <Tab label="State" value="2" />
                                    </TabList>
                                </Box>
                                <TabPanel value="1" sx={{ p: 0 }}>
                                    <DataGrid
                                        columns={client_columns}
                                        rows={client_rows}
                                        autoHeight
                                        sx={{
                                            border: 0,
                                            '& .MuiDataGrid-columnHeaders': { bgcolor: 'action.hover' },
                                            '& .MuiDataGrid-cell': { display: 'flex', alignItems: 'center' },
                                        }}
                                        disableRowSelectionOnClick
                                        hideFooter
                                    />
                                </TabPanel>
                                <TabPanel value="2" sx={{ p: 0 }}>
                                    <Box sx={{ p: 1 }}>
                                        <ThemedJsonEditor
                                            rootName=""
                                            data={this.state.state}
                                            onUpdate={this.handleStateEdit}
                                            onDelete={this.handleStateDelete}
                                            restrictEdit={({ value }) => typeof value === 'object' && value !== null}
                                            restrictTypeSelection={true}
                                            restrictAdd={true}
                                        />
                                    </Box>
                                </TabPanel>
                            </TabContext>
                        </Paper>
                    </Stack>
                </Container>

                <Dialog
                    open={this.state.sendDialogOpen}
                    onClose={this.handleCloseSend}
                    maxWidth="sm"
                    fullWidth
                >
                    <DialogTitle>{this.state.sendDialogTitle}</DialogTitle>
                    <DialogContent>
                        <Stack spacing={2} sx={{ mt: 1 }}>
                            <TextField
                                label="Message type"
                                size="small"
                                fullWidth
                                value={this.state.sendType}
                                onChange={this.updateSendType}
                            />
                            <Box>
                                <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                                    Message payload
                                </Typography>
                                <ThemedJsonEditor rootName="" data={this.state.sendData} onUpdate={({ newData }) => this.updateSendData(newData)} />
                            </Box>
                        </Stack>
                    </DialogContent>
                    <DialogActions sx={{ px: 3, pb: 2 }}>
                        <Button variant="text" color="inherit" onClick={this.handleCloseSend}>
                            Cancel
                        </Button>
                        <Button variant="contained" disableElevation onClick={this.handleSend}>
                            Send
                        </Button>
                    </DialogActions>
                </Dialog>
            </Box>
        );
    }
}
