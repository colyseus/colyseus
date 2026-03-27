import * as React from "react";
import type { MonitorOptions } from "../../";
import { fetchRoomList, remoteRoomCall } from "../services";

import {
  Box,
  Button,
  CircularProgress,
  Container,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { DataGrid, GridColDef, gridDateComparator, gridNumberComparator, gridStringOrNumberComparator } from '@mui/x-data-grid';
import OpenInBrowserIcon from '@mui/icons-material/OpenInBrowser';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import CableOutlined from '@mui/icons-material/CableOutlined';
import MeetingRoomOutlined from '@mui/icons-material/MeetingRoomOutlined';
import MemoryOutlined from '@mui/icons-material/MemoryOutlined';
import StorageOutlined from '@mui/icons-material/StorageOutlined';

import { ExtractStringNames, valueFormatter } from "../helpers/helpers";

const UPDATE_ROOM_LIST_INTERVAL = 5000;
const NO_ACTIVE_ROOMS_ROOM_ID = 'No active rooms.';

const sortComparator: { [key in ExtractStringNames<MonitorOptions['columns']>]?: Function } = {
  clients: gridNumberComparator,
  maxClients: gridNumberComparator,
  elapsedTime: gridDateComparator
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

export class RoomList extends React.Component {
  state = {
    selected: [1],
    rooms: [],
    connections: 0,
    cpu: 0,
    memory: { totalMemMb: 0, usedMemMb: 0 },
    columns: [],
    loaded: false,
  };

  updateRoomListInterval: number;

  isSelected = (index) => {
    return this.state.selected.indexOf(index) !== -1;
  };

  componentWillMount() {
    this.fetchRoomList();
  }

  componentWillUnmount(): void {
    clearInterval(this.updateRoomListInterval);
  }

  async fetchRoomList () {
    try {
      this.setState({ ...(await fetchRoomList()), loaded: true });
    } catch (err) {
      console.error(err)
    }

    clearInterval(this.updateRoomListInterval);
    this.updateRoomListInterval = window.setInterval(() => {
      this.fetchRoomList();
    }, UPDATE_ROOM_LIST_INTERVAL);
  }

  handleRowSelection = (selectedRows) => {
    this.setState({
      selected: selectedRows,
    });
  };

  inspectRoom(roomId) {
    const history = (this.props as any).history;
    history.push('/room/' + roomId);
  }

  async disposeRoom(roomId) {
    await remoteRoomCall(roomId, "disconnect");
    this.fetchRoomList();
  }

  getColumnHeader(column) {
    return (typeof (column) === "string")
      ? column
      : column.metadata
  }

  getRoomColumn(room, column) {
    let field = column;
    let value: any;
    let valueFromObject: any = room;
    let postProcessValue: any = undefined;

    if (field === "elapsedTime" && valueFromObject[field] >= 0) {
      postProcessValue = (milliseconds) => new Date( Date.now() - milliseconds );
    } else if (column.metadata && room.metadata) {
      field = column.metadata;
      valueFromObject = room.metadata;
    }

    value = valueFromObject[field];
    if (value === undefined) {
      value = "";
    }

    return (postProcessValue) ? postProcessValue(value) : `${value}`;
  }

  formatMemory(memInMb: number) {
    if (memInMb >= 1024) {
      return `${(memInMb / 1024).toFixed(2)} GB`;
    }
    return `${memInMb} MB`;
  }

  getColumnsNames(columns: any): Array<GridColDef> {
    const data: GridColDef[] = columns.map(column => {
      const value = this.getColumnHeader(column);
      return {
        id: value,
        field: value,
        headerName: value,
        flex: 1,
        valueFormatter: valueFormatter[value],
        sortComparator: sortComparator[value] || gridStringOrNumberComparator
      } as GridColDef;
    });

    data.push({
      field: "Inspect",
      headerName: "",
      width: 120,
      sortable: false,
      renderCell: (param) => {
        return (param.value !== NO_ACTIVE_ROOMS_ROOM_ID)
          ? <Button
              size="small"
              variant="outlined"
              startIcon={<OpenInBrowserIcon />}
              onClick={() => this.inspectRoom(param.value)}
            >
              Inspect
            </Button>
          : null;
      }
    });

    data.push({
      field: "Dispose",
      headerName: "",
      width: 120,
      sortable: false,
      renderCell: (param) => {
        return (param.value !== NO_ACTIVE_ROOMS_ROOM_ID)
          ? <Tooltip title="Dispose room">
              <IconButton
                size="small"
                color="error"
                onClick={() => this.disposeRoom(param.value)}
              >
                <DeleteForeverIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          : null;
      }
    });

    return data;
  }

  getRowsData(rooms: any): Array<any> {
    return rooms.map(room => {
      const data = { id: room.roomId };
      for (const column of this.state.columns) {
        const value = this.getRoomColumn(room, column);
        data[this.getColumnHeader(column)] = value;
      }
      data["Inspect"] = room.roomId;
      data["Dispose"] = room.roomId;
      return data
    });
  }

  render() {
    const columns = this.getColumnsNames(this.state.columns);
    const rows = this.getRowsData(this.state.rooms);

    return (
      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1.5}>
            <StatCard icon={<CableOutlined sx={{ fontSize: 20, color: 'text.secondary' }} />} label="Connections" value={this.state.connections} />
            <StatCard icon={<MeetingRoomOutlined sx={{ fontSize: 20, color: 'text.secondary' }} />} label="Rooms" value={this.state.rooms.length} />
            <StatCard icon={<MemoryOutlined sx={{ fontSize: 20, color: 'text.secondary' }} />} label="CPU" value={`${this.state.cpu.toFixed(1)}%`} />
            <StatCard icon={<StorageOutlined sx={{ fontSize: 20, color: 'text.secondary' }} />} label="Memory" value={this.formatMemory(this.state.memory.usedMemMb)} />
          </Stack>

          {!this.state.loaded ? (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 4, gap: 1 }}>
              <CircularProgress size={24} />
              <Typography color="text.secondary">Loading...</Typography>
            </Box>
          ) : rows.length === 0 ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <Typography color="text.secondary">No active rooms.</Typography>
            </Box>
          ) : (
            <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
              <DataGrid
                columns={columns}
                rows={rows}
                autoHeight
                sx={{
                  border: 0,
                  '& .MuiDataGrid-columnHeaders': { bgcolor: 'action.hover' },
                  '& .MuiDataGrid-cell': { display: 'flex', alignItems: 'center' },
                }}
                slots={{
                  noRowsOverlay: () => <></>,
                }}
                disableRowSelectionOnClick
              />
            </Paper>
          )}
        </Stack>
      </Container>
    );
  }
}
