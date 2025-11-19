import { Connection, roomsBySessionId, getRoomColorClass } from "../utils/Types";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faUser, faDoorOpen, faTrash } from "@fortawesome/free-solid-svg-icons";

function ConnectionItem({
	connection,
	isSelected,
	onClick,
}: {
	connection: Connection,
	isSelected: boolean,
	onClick: (connection: Connection) => void,
}) {
	const room = roomsBySessionId[connection.sessionId];
	const handleClick = () => onClick(connection);

	return (
		<div
			className={`px-2 py-1.5 rounded border transition-all cursor-pointer ${
				!connection.isConnected
					? "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 opacity-70"
					: isSelected
					? "border-purple-500 bg-purple-50 dark:bg-purple-900/30"
					: "border-gray-200 dark:border-slate-600 hover:border-purple-300 dark:hover:border-purple-700"
			}`}
			onClick={isSelected ? undefined : handleClick}
		>
			<div className="flex items-center justify-between gap-1.5">
				<div className="flex items-center gap-2 min-w-0 flex-1">
					<span className={getRoomColorClass(room.roomId) + " px-1.5 py-0.5 rounded text-[10px] text-white font-semibold flex-shrink-0"}>
						{room.name}
					</span>
					<div className="flex items-center gap-2 min-w-0 text-[10px] text-gray-500 dark:text-slate-400">
						<span className="flex items-center gap-1 flex-shrink-0" title="Room ID">
							<FontAwesomeIcon icon={faDoorOpen} className="text-[9px]" />
							<code className="truncate">{room.roomId}</code>
						</span>
						<span className="flex items-center gap-1 min-w-0" title="Session ID">
							<FontAwesomeIcon icon={faUser} className="text-[9px]" />
							<code className="truncate">{connection.sessionId}</code>
						</span>
					</div>
				</div>
				{connection.isConnected ? (
					<span className="flex-shrink-0 w-2 h-2 bg-green-500 rounded-full" title="Connected"></span>
				) : (
					<span className="flex-shrink-0 w-2 h-2 bg-red-500 rounded-full" title="Disconnected"></span>
				)}
			</div>
		</div>
	);
}

export function ConnectionList({
	connections,
	selectedConnection,
	clearConnections,
	setSelectedConnection,
} : {
	connections: Connection[],
	selectedConnection: Connection,
	clearConnections: () => void,
	setSelectedConnection: (connection: Connection) => void,
}) {

	const onClick = (connection: Connection) =>
		setSelectedConnection(connection)

	const handleLeaveAll = () => {
		// leave all rooms
		for (let roomId in roomsBySessionId) {
			roomsBySessionId[roomId].leave();
		}
		// clear connections
		clearConnections();
	};

	return (
		<div>
			<div className="flex items-center justify-between mb-2">
				<span className="text-[10px] text-gray-500 dark:text-slate-400 uppercase tracking-wide">
					{connections.filter((c) => c.isConnected).length} active
				</span>
				{connections.length > 0 && (
					<button
						className="text-[10px] bg-red-500 hover:bg-red-600 text-white font-medium px-2 py-1 rounded transition-colors"
						onClick={handleLeaveAll}
						title="Leave all rooms and clear connections"
					>
						Clear All <FontAwesomeIcon icon={faTrash} className="ml-1 inline" />
					</button>
				)}
			</div>

			{/* Workaround to emit CSS for all available colors */}
			<span className="hidden bg-lime-800 bg-green-800 bg-emerald-800 bg-teal-800 bg-cyan-800 bg-sky-800 bg-blue-800 bg-indigo-800 bg-violet-800 bg-fuchsia-800 bg-pink-800 bg-rose-800" />

			{connections.length === 0 ? (
				<div className="p-3 text-center bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded">
					<p className="text-xs text-gray-500 dark:text-slate-400 italic">No connections</p>
				</div>
			) : (
				<div className="space-y-1.5">
					{connections.map((connection, i) => (
						<ConnectionItem
							key={connection.sessionId || i.toString()}
							connection={connection}
							isSelected={connection === selectedConnection}
							onClick={onClick}
						/>
					))}
				</div>
			)}
		</div>
	);
}