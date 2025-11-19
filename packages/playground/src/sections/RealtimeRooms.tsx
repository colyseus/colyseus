import { useState } from "react";
import { type RoomAvailable } from "@colyseus/sdk";

import { InspectConnection } from "../components/InspectConnection";
import { client, Connection, global } from "../utils/Types";
import { ConnectionList } from "../components/ConnectionList";
import { JoinRoomForm } from "../components/JoinRoomForm";
import { StateView } from "../components/StateView";

import { type AuthConfig } from "../../src-backend";

enum ServerState {
	CONNECTING = "connecting",
	CONNECTED = "connected",
	OFFLINE = "offline",
}

interface RealtimeRoomsProps {
	serverState: ServerState;
	roomNames: string[];
	roomsById: { [key: string]: RoomAvailable & { locked: boolean } };
	roomsByType: { [key: string]: number };
	authConfig: AuthConfig;
	onConnectionSuccessful: (connection: Connection) => void;
	onDisconnection: (sessionId: string) => void;
	fetchRoomStats: () => void;
}

export function RealtimeRooms({
	serverState,
	roomNames,
	roomsById,
	roomsByType,
	authConfig,
	onConnectionSuccessful,
	onDisconnection,
}: RealtimeRoomsProps) {
	const [connections, setConnections] = useState([] as Connection[]);
	const [selectedConnection, setSelectedConnection] = useState(undefined as unknown as Connection);

	const handleConnectionSuccessful = (connection: Connection) => {
		onConnectionSuccessful(connection);
		if (global.connections.indexOf(connection) !== -1) {
			// reconnected! (via devMode or .reconnect())
			connection.isConnected = true;
			setConnections([...global.connections]);
		} else {
			// new connection
			setConnections(global.connections);
			// auto-select connection
			if (!selectedConnection || !selectedConnection.isConnected) {
				setSelectedConnection(connection);
			}
		}
	};

	const handleDisconnection = (sessionId: string) => {
		onDisconnection(sessionId);
		const connection = global.connections.find((connection) => connection.sessionId === sessionId);
		if (connection) {
			connection!.isConnected = false;
			setConnections([...global.connections]);
		}
	};

	const clearConnections = () => {
		global.connections = [];
		setConnections(global.connections);
		setSelectedConnection(undefined as unknown as Connection);
	};

	return (
		<div className="h-full flex flex-col">
			<div className="grid grid-cols-2 gap-6 px-8 py-6">
				<div className="bg-white dark:bg-slate-700 shadow rounded p-6 dark:text-slate-300">
					{serverState === ServerState.CONNECTING && <p>Connecting to server...</p>}
					{serverState === ServerState.OFFLINE && <p>Server is offline.</p>}
					{serverState === ServerState.CONNECTED && (
						<JoinRoomForm
							roomNames={roomNames}
							roomsByType={roomsByType}
							roomsById={roomsById}
							onConnectionSuccessful={handleConnectionSuccessful}
							onDisconnection={handleDisconnection}
							authConfig={authConfig}
						/>
					)}
				</div>

				<div className="bg-white dark:bg-slate-700 dark:text-slate-300 shadow rounded p-6">
					<ConnectionList
						connections={connections}
						selectedConnection={selectedConnection}
						clearConnections={clearConnections}
						setSelectedConnection={setSelectedConnection}
					/>
				</div>
			</div>

			<div className="flex-1 mx-8 mb-6 bg-white dark:bg-slate-700 dark:text-slate-300 shadow rounded grid grid-cols-2">
				<div className="p-6 border-r border-gray-200 dark:border-slate-600">
					<h2 className="text-xl font-semibold mb-4">
						Inspect connection
						{selectedConnection ? (
							<span>
								{' '}
								(
								<code className="bg-gray-100 dark:bg-slate-800 dark:text-slate-300 text-sm text-gray-700 p-1 rounded">
									sessionId: {selectedConnection.sessionId}
								</code>
								)
							</span>
						) : null}
					</h2>
					{selectedConnection ? (
						<InspectConnection
							key={selectedConnection.sessionId}
							client={client}
							connection={selectedConnection}
						/>
					) : (
						<p>
							<em>(Please select an active client connection)</em>
						</p>
					)}
				</div>

				<div className="p-6">
					<h2 className="text-xl font-semibold mb-4 dark:text-slate-300">State</h2>
					{selectedConnection ? (
						<div className="text-sm">
							<StateView key={selectedConnection.sessionId} connection={selectedConnection} />
						</div>
					) : (
						<p>
							<em>(Please select an active client connection)</em>
						</p>
					)}
				</div>
			</div>
		</div>
	);
}

export { ServerState };

