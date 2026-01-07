import * as React from "react";
import type { MonitorOptions } from "../../";
import { fetchRoomList, remoteRoomCall } from "../services";

import { Card, Button, mobileStepperClasses, getModalUtilityClass } from '@mui/material';
import { DataGrid, GridColDef, gridDateComparator, gridNumberComparator, gridStringOrNumberComparator } from '@mui/x-data-grid';
import OpenInBrowserIcon from '@mui/icons-material/OpenInBrowser';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';

import {
  Chip,
  Table,
  Typography,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper
} from '@mui/material';

import { ExtractStringNames, valueFormatter } from "../helpers/helpers";

const UPDATE_ROOM_LIST_INTERVAL = 5000;
const NO_ACTIVE_ROOMS_ROOM_ID = 'No active rooms.';

/**
 * Define default sort method by column name
 */
const sortComparator: { [key in ExtractStringNames<MonitorOptions['columns']>]?: Function } = {
  clients: gridNumberComparator,
  maxClients: gridNumberComparator,
  elapsedTime: gridDateComparator
}

export class RoomList extends React.Component {
  state = {
    selected: [1],
    rooms: [],
    connections: 0,
    cpu: 0,
    memory: { totalMemMb: 0, usedMemMb: 0 },
    columns: [],
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
      this.setState((await fetchRoomList()));

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

  bytesToStr(size: number) {
    const i = Math.floor(Math.log(size) / Math.log(1024));
    return ((size / Math.pow(1024, i)).toFixed(2) as any) * 1 + ' ' + ['B', 'kB', 'MB', 'GB', 'TB'][i];
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

    //
    // "Inspect" action column
    //
    data.push({
      field: "Inspect",
      headerName: "", // Inspect
      flex: 1,
      renderCell: (param) => {
        return (param.value !== NO_ACTIVE_ROOMS_ROOM_ID)
          ? <div style={{ cursor: "pointer" }} onClick={() => {
              this.inspectRoom(param.value);
            }}>
              {/* TODO: use IconButton on sm/xs devices */}
              <Button variant="contained" disableElevation startIcon={<OpenInBrowserIcon />}>
                  <Typography
                    noWrap
                    component="span"
                    sx={{ flexGrow: 1, display: { xs: 'none', sm: 'none', md: "block" } }}
                  >
                      Inspect
                  </Typography>
              </Button>
            </div>
          : null;
      }
    });

    //
    // "Dispose" action column
    //
    data.push({
      field: "Dispose",
      headerName: "", // Dispose
      flex: 1,
      renderCell: (param) => {
        return (param.value !== NO_ACTIVE_ROOMS_ROOM_ID)
          ? <div style={{ cursor: "pointer" }} onClick={() => {
              this.disposeRoom(param.value);
            }}>
              {/* TODO: use IconButton on sm/xs devices */}
              <Button variant="contained" disableElevation color="error" startIcon={<DeleteForeverIcon />}>
                  <Typography
                    noWrap
                    component="span"
                    sx={{ flexGrow: 1, display: { xs: 'none', sm: 'none', md: "block" } }}
                  >
                      Dispose
                  </Typography>
              </Button>
            </div>
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

  generateRoomListDataGrid(): JSX.Element {
    const columns = this.getColumnsNames(this.state.columns);
    const rows = this.getRowsData(this.state.rooms);

    return <DataGrid
      columns={columns}
      rows={
        (rows.length === 0)
          ? this.getRowsData([{ roomId: NO_ACTIVE_ROOMS_ROOM_ID, elapsedTime: -1 }])
          : rows
      }
      autoHeight
      sx={{ overflow: "hidden" }}
      slots={{
        noRowsOverlay: () => <></>,
      }}
      disableRowSelectionOnClick
      // hideFooter
      // hideFooterPagination
      // hideFooterSelectedRowCount
    />
  }

  render() {
    return (
      <div>
        <Card>
          <TableContainer component={Paper}>
            <Table aria-label="simple table">
              <TableHead>
                <TableRow>
                  <TableCell align={"center"}>
                    Connections
                    <Chip sx={{ marginLeft: "6px" }} size="small" color="primary" label={this.state.connections} />
                  </TableCell>
                  <TableCell align={"center"}>
                    Rooms
                    <Chip sx={{ marginLeft: "6px" }} size="small" color="primary" label={this.state.rooms.length} />
                  </TableCell>
                  <TableCell align={"center"}>
                    CPU Usage
                    <Chip sx={{ marginLeft: "6px" }} size="small" color="primary" label={`${this.state.cpu.toFixed(2)} %`} />
                  </TableCell>
                  <TableCell align={"center"}>
                    Memory
                    <Chip sx={{ marginLeft: "6px" }} size="small" color="primary" label={this.formatMemory(this.state.memory.usedMemMb)} />
                  </TableCell>
                </TableRow>
              </TableHead>
            </Table>
          </TableContainer>
        </Card>
        <Card style={{ marginTop: "2px" }}>
          {this.generateRoomListDataGrid()}
        </Card>
      </div>
    );
  }

}
