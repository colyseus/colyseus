import * as React from "react";
import * as http from "superagent";

import { fetchRoomList, remoteRoomCall } from "../services";

import {
  Table,
  TableBody,
  TableHeader,
  TableHeaderColumn,
  TableRow,
  TableRowColumn,
  TableFooter,
} from "material-ui/Table";

import {
  Card,
  CardActions,
  CardHeader,
  CardText
} from 'material-ui/Card';

import FlatButton from 'material-ui/FlatButton';
import Chip from 'material-ui/Chip';
import { blue300 } from 'material-ui/styles/colors';

import DeleteForeverIcon from 'material-ui/svg-icons/action/delete-forever';
import OpenInBrowserIcon from 'material-ui/svg-icons/action/open-in-browser';

const buttonStyle = { marginRight: 12 };

const defaultColumnWidth = { width: "11%" };
const largeColumnWidth = { width: "34%" };

const UPDATE_ROOM_LIST_INTERVAL = 5000;

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

  async fetchRoomList () {
    try {
      this.setState((await fetchRoomList()).body);

    } catch (err) {
      console.error(err)
    }

    clearInterval(this.updateRoomListInterval);

    this.updateRoomListInterval = window.setInterval(() =>
      this.fetchRoomList(), UPDATE_ROOM_LIST_INTERVAL);
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

    let postProcessValue: (_: any) => string;

    if (field === "elapsedTime") {
      postProcessValue = this.millisecondsToStr;

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

  millisecondsToStr(milliseconds) {
    let temp = Math.floor(milliseconds / 1000);

    const years = Math.floor(temp / 31536000);
    if (years) {
      return years + 'y';
    }

    const days = Math.floor((temp %= 31536000) / 86400);
    if (days) {
      return days + 'd';
    }

    const hours = Math.floor((temp %= 86400) / 3600);
    if (hours) {
      return hours + 'h';
    }

    const minutes = Math.floor((temp %= 3600) / 60);
    if (minutes) {
      return minutes + 'min';
    }

    const seconds = temp % 60;
    if (seconds) {
      return seconds + 's';
    }

    return 'less than a second';
  }

  bytesToStr(size: number) {
    const i = Math.floor(Math.log(size) / Math.log(1024));
    return ((size / Math.pow(1024, i)).toFixed(2) as any) * 1 + ' ' + ['B', 'kB', 'MB', 'GB', 'TB'][i];
  }

  render() {
    return (
      <div>
        <Card>
            <Table>
                <TableBody displayRowCheckbox={false}>
                    <TableRow>
                        <TableRowColumn>
                            <div style={{display: 'flex', alignItems: 'center'}}>
                                Connections
                                <Chip style={{marginLeft: '5px'}} backgroundColor={blue300}>
                                    {this.state.connections}
                                </Chip>
                            </div>
                        </TableRowColumn>
                        <TableRowColumn>
                            <div style={{display: 'flex', alignItems: 'center'}}>
                                Rooms
                                <Chip style={{marginLeft: '5px'}} backgroundColor={blue300}>
                                    {this.state.rooms.length}
                                </Chip>
                            </div>
                        </TableRowColumn>
                        <TableRowColumn>
                            <div style={{display: 'flex', alignItems: 'center'}}>
                                CPU Usage
                                <Chip style={{marginLeft: '5px'}} backgroundColor={blue300}>
                                    {this.state.cpu} %
                                </Chip>
                            </div>
                        </TableRowColumn>
                        <TableRowColumn>
                            <div style={{display: 'flex', alignItems: 'center'}}>
                                Memory
                                <Chip style={{marginLeft: '5px'}} backgroundColor={blue300}>
                                    {this.state.memory.usedMemMb} MB
                                </Chip>
                            </div>
                        </TableRowColumn>
                    </TableRow>
                </TableBody>
            </Table>


        </Card>
        <Card>
            <Table>
            <TableHeader displaySelectAll={false} adjustForCheckbox={false}>
                <TableRow>
                {this.state.columns.map(column => (
                  <TableHeaderColumn style={defaultColumnWidth}>{this.getColumnHeader(column)}</TableHeaderColumn>
                ))}
                <TableHeaderColumn style={largeColumnWidth}>actions</TableHeaderColumn>
                </TableRow>
            </TableHeader>
            <TableBody displayRowCheckbox={false}>
                {this.state.rooms.map((room, i) => {return (
                <TableRow key={room.roomId}>
                    {this.state.columns.map(column => (
                      <TableRowColumn style={defaultColumnWidth}>{this.getRoomColumn(room, column)}</TableRowColumn>
                    ))}
                    <TableRowColumn style={largeColumnWidth}>
                    <FlatButton
                        label="Inspect"
                        icon={<OpenInBrowserIcon />}
                        onClick={this.inspectRoom.bind(this, room.roomId)}
                        style={buttonStyle}
                    />

                    <FlatButton
                        label="Dispose"
                        secondary={true}
                        icon={<DeleteForeverIcon />}
                        style={buttonStyle}
                        onClick={this.disposeRoom.bind(this, room.roomId)}
                    />
                    </TableRowColumn>
                </TableRow>
                )})}
            </TableBody>

            </Table>
        </Card>
      </div>
    );
  }

}
