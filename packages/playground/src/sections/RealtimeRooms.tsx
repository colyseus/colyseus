import { useState, useEffect } from "react";
import { type RoomAvailable } from "@colyseus/sdk";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faDoorOpen, faHashtag, faTicket, faUser } from "@fortawesome/free-solid-svg-icons";

import { InspectConnection } from "../components/InspectConnection";
import { client, Connection, global, roomsBySessionId } from "../utils/Types";
import { ConnectionList } from "../components/ConnectionList";
import { JoinRoomForm } from "../components/JoinRoomForm";
import { StateView } from "../components/StateView";
import { ResizableSidebar } from "../components/ResizableSidebar";

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
	const [connections, setConnections] = useState(global.connections);
	const [selectedConnection, setSelectedConnection] = useState(undefined as unknown as Connection);

	// Auto-select a connection if none is selected and connections are available
	useEffect(() => {
		if ((!selectedConnection || !selectedConnection.isConnected) && connections.length > 0) {
			const activeConnection = connections.find(conn => conn.isConnected);
			if (activeConnection) {
				setSelectedConnection(activeConnection);
			}
		}
	}, [connections, selectedConnection]);

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
		<div className="h-full flex">
			<ResizableSidebar
				className="bg-white dark:bg-slate-700 border-r border-gray-200 dark:border-slate-600 overflow-y-auto"
				storageKey="playground-realtime-sidebar-width"
			>
				<div className="p-6">
					<h2 className="text-xl font-semibold mb-4 dark:text-slate-300">Join a room</h2>

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

					<div className="border-t border-gray-200 dark:border-slate-600 mt-4 pt-4">
						<h3 className="text-xs font-semibold mb-3 dark:text-slate-300 uppercase tracking-wide text-gray-700 dark:text-slate-400">Client connections</h3>
						<ConnectionList
							connections={connections}
							selectedConnection={selectedConnection}
							clearConnections={clearConnections}
							setSelectedConnection={setSelectedConnection}
						/>
					</div>
				</div>
			</ResizableSidebar>

		{/* Main content area */}
		<div className="flex-1 overflow-hidden bg-gray-50 dark:bg-slate-800">
			<div className="h-full flex flex-col lg:flex-row gap-0">
				<div className="flex-1 overflow-y-auto border-b lg:border-b-0 lg:border-r border-gray-200 dark:border-slate-600 dark:text-slate-300 p-6">
					<div className="mb-4">
						<h2 className="text-xl font-semibold mb-2">
							Inspect connection
						</h2>
						{selectedConnection && roomsBySessionId[selectedConnection.sessionId] ? (
							<div className="flex flex-wrap items-center gap-x-4 gap-y-2">
								<div className="flex items-center gap-2 text-sm font-normal">
									<FontAwesomeIcon icon={faDoorOpen} className="text-blue-600 dark:text-blue-400 w-3.5" />
									<span className="text-gray-600 dark:text-slate-400">Room:</span>
									<code className="bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300 px-2 py-1 rounded">
										{roomsBySessionId[selectedConnection.sessionId].name}
									</code>
								</div>
								<div className="flex items-center gap-2 text-sm font-normal">
									<FontAwesomeIcon icon={faHashtag} className="text-purple-600 dark:text-purple-400 w-3.5" />
									<span className="text-gray-600 dark:text-slate-400">Room ID:</span>
									<code className="bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300 px-2 py-1 rounded">
										{roomsBySessionId[selectedConnection.sessionId].roomId}
									</code>
								</div>
								<div className="flex items-center gap-2 text-sm font-normal">
									<FontAwesomeIcon icon={faUser} className="text-green-600 dark:text-green-400 w-3.5" />
									<span className="text-gray-600 dark:text-slate-400">Session ID:</span>
									<code className="bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300 px-2 py-1 rounded">
										{selectedConnection.sessionId}
									</code>
								</div>
							</div>
						) : null}
					</div>
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

				<div className="flex-1 overflow-y-auto dark:text-slate-300 p-6">
					<h2 className="text-xl font-semibold mb-4">State</h2>
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
		</div>
	);
}

export { ServerState };
