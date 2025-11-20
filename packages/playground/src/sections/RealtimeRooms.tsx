import { useState, useEffect } from "react";
import { type RoomAvailable } from "@colyseus/sdk";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faDoorOpen, faHashtag, faTicket, faUser, faChevronDown, faChevronUp, faInfoCircle } from "@fortawesome/free-solid-svg-icons";

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

type MobileSection = "join" | "inspect" | "state";

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
	const [expandedSections, setExpandedSections] = useState<Set<MobileSection>>(new Set(["join"]));

	// Auto-select a connection if none is selected and connections are available
	useEffect(() => {
		if (!selectedConnection && connections.length > 0) {
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

	const toggleMobileSection = (section: MobileSection) => {
		setExpandedSections(prev => {
			const newSet = new Set(prev);
			if (newSet.has(section)) {
				newSet.delete(section);
			} else {
				newSet.add(section);
			}
			return newSet;
		});
	};

	// Reusable content sections
	const joinRoomContent = (
		<>
			{serverState === ServerState.CONNECTING && <p className="text-sm">Connecting to server...</p>}
			{serverState === ServerState.OFFLINE && <p className="text-sm">Server is offline.</p>}
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
				<h3 className="text-xs font-semibold mb-3 dark:text-slate-300 uppercase tracking-wide text-gray-700 dark:text-slate-400">Client SDK connections</h3>
				<ConnectionList
					connections={connections}
					selectedConnection={selectedConnection}
					clearConnections={clearConnections}
					setSelectedConnection={setSelectedConnection}
				/>
			</div>
		</>
	);

	const inspectConnectionHeader = selectedConnection && roomsBySessionId[selectedConnection.sessionId] ? (
		<div className="text-sm flex flex-col sm:flex-row sm:flex-wrap items-start sm:items-center gap-2 sm:gap-x-4 sm:gap-y-2 mb-4">
			<div className="flex items-center gap-2 text-xs sm:text-sm font-normal">
				<FontAwesomeIcon icon={faDoorOpen} className="text-blue-600 dark:text-blue-400 w-3.5" />
				<span className="text-gray-600 dark:text-slate-400">Room:</span>
				<code className="bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-300 px-2 py-1 rounded text-xs">
					{roomsBySessionId[selectedConnection.sessionId].name}
				</code>
			</div>
			<div className="flex items-center gap-2 text-xs sm:text-sm font-normal">
				<FontAwesomeIcon icon={faHashtag} className="text-purple-600 dark:text-purple-400 w-3.5" />
				<span className="text-gray-600 dark:text-slate-400">Room ID:</span>
				<code className="bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-300 px-2 py-1 rounded text-xs truncate max-w-[150px] sm:max-w-[200px]">
					{roomsBySessionId[selectedConnection.sessionId].roomId}
				</code>
			</div>
			<div className="flex items-center gap-2 text-xs sm:text-sm font-normal">
				<FontAwesomeIcon icon={faUser} className="text-green-600 dark:text-green-400 w-3.5" />
				<span className="text-gray-600 dark:text-slate-400">Session ID:</span>
				<code className="bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-300 px-2 py-1 rounded text-xs truncate max-w-[150px] sm:max-w-[200px]">
					{selectedConnection.sessionId}
				</code>
			</div>
		</div>
	) : null;

	const inspectConnectionContent = selectedConnection ? (
		<>
			{inspectConnectionHeader}
			<InspectConnection
				key={selectedConnection.sessionId}
				client={client}
				connection={selectedConnection}
			/>
		</>
	) : (
		<div className="flex flex-col items-center justify-center py-12 px-4">
			<div className="flex items-center gap-3 text-gray-400 dark:text-slate-500 bg-gray-100 dark:bg-slate-700/50 px-6 py-4 rounded-lg border border-gray-200 dark:border-slate-600">
				<FontAwesomeIcon icon={faInfoCircle} className="text-lg" />
				<p className="text-sm italic">Please select an active client connection</p>
			</div>
		</div>
	);

	const stateContent = selectedConnection ? (
		<div className="text-sm dark:text-slate-300">
			<StateView key={selectedConnection.sessionId} connection={selectedConnection} />
		</div>
	) : (
		<div className="flex flex-col items-center justify-center py-12 px-4">
			<div className="flex items-center gap-3 text-gray-400 dark:text-slate-500 bg-gray-100 dark:bg-slate-700/50 px-6 py-4 rounded-lg border border-gray-200 dark:border-slate-600">
				<FontAwesomeIcon icon={faInfoCircle} className="text-lg" />
				<p className="text-sm italic">Please select an active client connection</p>
			</div>
		</div>
	);

	return (
		<>
			{/* Mobile Layout */}
			<div className="md:hidden h-full overflow-y-auto">
				{/* Join Room Section */}
				<div className="border-b border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 overflow-hidden">
					<button
						onClick={() => toggleMobileSection("join")}
						className={`w-full px-4 py-3 flex justify-between items-center transition-colors ${
							expandedSections.has("join")
								? "hover:bg-gray-50 dark:hover:bg-slate-600"
								: "bg-gray-50 dark:bg-slate-600"
						}`}
					>
						<h2 className="text-lg font-semibold dark:text-slate-300">Join a room</h2>
						<FontAwesomeIcon
							icon={expandedSections.has("join") ? faChevronUp : faChevronDown}
							className="text-gray-500 dark:text-slate-400 transition-transform"
						/>
					</button>
					<div
						className={`transition-all duration-300 ease-in-out ${
							expandedSections.has("join")
								? "max-h-[2000px] opacity-100"
								: "max-h-0 opacity-0"
						}`}
					>
						<div className="p-4">{joinRoomContent}</div>
					</div>
				</div>

				{/* Inspect Connection Section */}
				<div className="border-b border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 overflow-hidden">
					<button
						onClick={() => toggleMobileSection("inspect")}
						className={`w-full px-4 py-3 flex justify-between items-center transition-colors ${
							expandedSections.has("inspect")
								? "hover:bg-gray-50 dark:hover:bg-slate-600"
								: "bg-gray-50 dark:bg-slate-600"
						}`}
					>
						<h2 className="text-lg font-semibold dark:text-slate-300">Inspect connection</h2>
						<FontAwesomeIcon
							icon={expandedSections.has("inspect") ? faChevronUp : faChevronDown}
							className="text-gray-500 dark:text-slate-400 transition-transform"
						/>
					</button>
					<div
						className={`transition-all duration-300 ease-in-out ${
							expandedSections.has("inspect")
								? "max-h-[2000px] opacity-100"
								: "max-h-0 opacity-0"
						}`}
					>
						<div className="p-4 bg-gray-50 dark:bg-slate-800 dark:text-slate-300">{inspectConnectionContent}</div>
					</div>
				</div>

				{/* State Section */}
				<div className="border-b border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 overflow-hidden">
					<button
						onClick={() => toggleMobileSection("state")}
						className={`w-full px-4 py-3 flex justify-between items-center transition-colors ${
							expandedSections.has("state")
								? "hover:bg-gray-50 dark:hover:bg-slate-600"
								: "bg-gray-50 dark:bg-slate-600"
						}`}
					>
						<h2 className="text-lg font-semibold dark:text-slate-300">State</h2>
						<FontAwesomeIcon
							icon={expandedSections.has("state") ? faChevronUp : faChevronDown}
							className="text-gray-500 dark:text-slate-400 transition-transform"
						/>
					</button>
					<div
						className={`transition-all duration-300 ease-in-out ${
							expandedSections.has("state")
								? "max-h-[2000px] opacity-100"
								: "max-h-0 opacity-0"
						}`}
					>
						<div className="p-4 bg-gray-50 dark:bg-slate-800">{stateContent}</div>
					</div>
				</div>
			</div>

			{/* Desktop Layout */}
			<div className="hidden md:flex h-full flex-row">
				<ResizableSidebar
					className="bg-white dark:bg-slate-700 border-r border-gray-200 dark:border-slate-600 overflow-y-auto md:h-full"
					storageKey="playground-realtime-sidebar-width"
					defaultWidth={320}
					minWidth={280}
					maxWidth={500}
				>
					<div className="p-4 md:p-6">
						<h2 className="text-lg md:text-xl font-semibold mb-4 dark:text-slate-300">Join a room</h2>
						{joinRoomContent}
					</div>
				</ResizableSidebar>

				{/* Main content area */}
				<div className="flex-1 overflow-hidden bg-gray-50 dark:bg-slate-800">
					<div className="h-full flex flex-col lg:flex-row gap-0">
						<div className="flex-1 overflow-y-auto border-b lg:border-b-0 lg:border-r border-gray-200 dark:border-slate-600 dark:text-slate-300 p-4 md:p-6 min-h-0">
							<h2 className="text-lg md:text-xl font-semibold mb-4">Inspect connection</h2>
							{inspectConnectionContent}
						</div>

						<div className="flex-1 overflow-y-auto dark:text-slate-300 p-4 md:p-6 min-h-0">
							<h2 className="text-lg md:text-xl font-semibold mb-4">State</h2>
							{stateContent}
						</div>
					</div>
				</div>
			</div>
		</>
	);
}

export { ServerState };
