import { useEffect, useState } from "react";
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

	useEffect(() => {
		const handler = (state: any) => setState(state.toJSON());
		room.onStateChange(handler);
		return () => room.onStateChange.remove(handler);
	}, [room]);

	return <JsonView src={state} enableClipboard={false} />;
}