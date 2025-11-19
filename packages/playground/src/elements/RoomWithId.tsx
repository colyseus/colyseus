import { getRoomColorClass } from "../utils/Types";

export function RoomWithId({ name, roomId }: { name: string, roomId: string }) {
	return <span className={getRoomColorClass(roomId) + " p-1.5 rounded text-xs text-white"}>
		<span className="font-semibold">{name}</span>
		<code className="ml-2 text-xs bg-gray-100 dark:bg-slate-800 dark:text-slate-300 p-0.5 text-gray-700 rounded">
			<span className="ml-1 ">{roomId}</span>
		</code>
	</span>;
}