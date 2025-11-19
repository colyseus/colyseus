import { Connection, roomsBySessionId } from "../utils/Types";
import { RoomWithId } from "../elements/RoomWithId";

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

	return <div
		className={"w-full p-2 text-sm rounded text-gray-500 transition " + (
			(!connection.isConnected)
				? (isSelected) ? " bg-red-500" :  " bg-red-100"
				: " "
		) + (
			(isSelected)
				? " opacity-100 bg-green-500 text-white shadow"
				: " hover:bg-gray-100 cursor-pointer"
		)}
		onClick={(isSelected) ? undefined : handleClick}
	>
		{/* {(isSelected)
			? <span className="font-semibold">▶</span>
			: null } */}

		<RoomWithId name={room.name} roomId={room.roomId} />

		{(connection.isConnected)
			? <span className="ml-2 font-semibold bg-green-500 text-white rounded px-1.5 p-1">↔</span>
			: <span className="ml-2 font-semibold bg-red-500 text-white rounded px-1.5 p-1">🅧</span>}

		<code className="ml-2 bg-gray-100 dark:bg-slate-800 dark:text-slate-300 text-gray-700 p-1 rounded">sessionId: {connection.sessionId}</code>
	</div>
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

	return (<>
		<h2 className="text-xl font-semibold mb-2">
			Client connections ({connections.filter(c => c.isConnected).length})

			{(connections.length > 0)
				? <button className="float-right text-sm bg-red-500 enabled:hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold px-4 py-1 rounded" onClick={handleLeaveAll}>
						<svg className="w-4 mr-1 inline" fill="currentColor" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512"><path d="M342.6 150.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192 210.7 86.6 105.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L146.7 256 41.4 361.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192 301.3 297.4 406.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.3 256 342.6 150.6z"></path></svg>
						Leave all + Clear
					</button>
				: null}
		</h2>

		{/* Workaround to emit CSS for all available colors */}
		<span className="bg-lime-800 bg-green-800 bg-emerald-800 bg-teal-800 bg-cyan-800 bg-sky-800 bg-blue-800 bg-indigo-800 bg-violet-800 bg-fuchsia-800 bg-pink-800 bg-rose-800"></span>

		{(connections.length === 0)
			? <p><em>No active client connections.</em></p>
			: connections.map((connection, i) =>
				<ConnectionItem
					key={connection.sessionId || i.toString()}
					connection={connection}
					isSelected={connection === selectedConnection}
					onClick={onClick} />
			)}
	</>);
}