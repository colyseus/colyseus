import { useState } from "react";
import { Connection, roomsBySessionId } from "../utils/Types";

// JSON View
import JsonView from 'react18-json-view'
import 'react18-json-view/src/style.css'

export function StateView({
	connection,
}: {
	connection: Connection,
}) {
	const room = roomsBySessionId[connection.sessionId];
	const [state, setState] = useState(room.state && room.state.toJSON());
	const hasState = (room.state !== null);

	// console.log("RENDER STATE VIEW (bind onStateChange)");
	room.onStateChange((state) => setState(state.toJSON()));

	return <JsonView src={state} enableClipboard={false} />;
}