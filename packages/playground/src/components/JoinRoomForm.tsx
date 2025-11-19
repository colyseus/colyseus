import { Client, Room, RoomAvailable } from "colyseus.js";
import { useState } from "react";
import { global, client, roomsBySessionId, messageTypesByRoom, Connection, matchmakeMethods, getRoomColorClass } from "../utils/Types";
import { DEVMODE_RESTART, RAW_EVENTS_KEY, onRoomConnected } from "../utils/ColyseusSDKExt";
import { LimitedArray } from "../utils/LimitedArray";
import { JSONEditor } from "../elements/JSONEditor";
import * as JSONEditorModule from "jsoneditor";
import { RoomWithId } from "../elements/RoomWithId";
import { AuthOptions } from "./AuthOptions";
import type { AuthConfig } from "../../src-backend/index";

export function JoinRoomForm ({
	roomNames,
	roomsById,
	roomsByType,
	authConfig,
	onConnectionSuccessful,
	onDisconnection,
} : {
	roomNames: string[]
	roomsById: { [key: string]: RoomAvailable & { locked: boolean } },
	roomsByType: {[key: string]: number},
	authConfig: AuthConfig,
	onConnectionSuccessful: (connection: Connection) => void
	onDisconnection: (sessionId: string) => void
}) {
	const [selectedRoomName, setRoomName] = useState(roomNames[0]);
	const [selectedRoomId, setRoomId] = useState(""); // only for joinById
	const [selectedMethod, setMethod] = useState(Object.keys(matchmakeMethods)[0] as keyof Client);
	const [optionsText, setOptionsJSON] = useState("{}");
	const [isLoading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const [isButtonEnabled, setButtonEnabled] = useState(true);

	const [isAuthBlockOpen, setAuthBlockOpen] = useState(false);
	const [authToken, setAuthToken] = useState(client.auth.token || "");

	const handleSelectedRoomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		if (selectedMethod === "joinById") {
			setRoomId(e.target.value);
		} else {
			setRoomName(e.target.value);
		}
	}

	const onOptionsValidationError = (errors: ReadonlyArray<JSONEditorModule.SchemaValidationError | JSONEditorModule.ParseError>) => {
		setButtonEnabled(errors.length === 0);
		// setError(error);
	}

	const handleSelectedMethodChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const method = e.target.value as keyof Client;
		setMethod(method);

		// always enable button for joinById
		if (method !== "joinById") {
			setButtonEnabled(true);
		}
	}

	const onChangeOptions = (json: any) =>
		setOptionsJSON(json);

	const onAuthTokenChange = (newToken: string, autoClose: boolean = true) => {
		if (authToken !== newToken) {
			client.auth.token = newToken;
			setAuthToken(client.auth.token);

			if (autoClose) {
				setAuthBlockOpen(false);
			}
		}
	};

	const toggleAuthBlock = function(e: React.MouseEvent) {
		e.preventDefault();
		setAuthBlockOpen(!isAuthBlockOpen);
	}

	const onJoinClick = async () => {
		const method = selectedMethod as "joinById" | "reconnect" | "joinOrCreate" | "join";
		const roomName = (method === "joinById") ? selectedRoomId : selectedRoomName;

		setError(""); // clear previous error
		setLoading(true);

		try {
			await client[method](roomName, JSON.parse(optionsText || "{}"));

		} catch (e: any) {
			const error = e.target?.statusText || e.message || "server is down.";
			setError(error);
		} finally {
			setLoading(false);
		}
	};

	// handle new connections
	onRoomConnected((room: Room) => {
		// TODO: clean up old connections
		roomsBySessionId[room.sessionId] = room;

		const existingConnection = global.connections.find((c) => c.sessionId === room.sessionId);

		// FIXME: why .reconnect() doesn't re-use the events?
		const needRebindEvents = existingConnection && Object.keys(room['onMessageHandlers'].events).length === 0;

		// skip if reconnecting on devMode (previous room events are successfuly re-used.)
		// when using .reconnect() events need to be bound again
		if (existingConnection) {
			if (!needRebindEvents) { return; }
			existingConnection.isConnected = true;
		}

		// get existing Connection for sessionId, or create a new one
		const connection: Connection = existingConnection || {
			sessionId: room.sessionId,
			isConnected: true,
			messages: new LimitedArray(),
			events: new LimitedArray(...(room as any)[RAW_EVENTS_KEY].map((data: any) => ({ // consume initial raw events from ColyseusSDKExt
				eventType: data[0],
				type: data[1],
				message: data[2],
				now: data[3]
			})))
		};

		// prepend received messages
		room.onMessage("*", (type, message) => {
			connection.messages.unshift({
				type,
				message,
				in: true,
				now: new Date()
			});
		});

		// raw events from SDK
		room.onMessage(RAW_EVENTS_KEY, (data: any[]) => {
			connection.events.unshift({
				eventType: data[0],
				type: data[1],
				message: data[2],
				now: new Date(),
			});
		});

		room.onLeave((code) =>
			onDisconnection(room.sessionId));

		// devmode restart event
		room.onMessage(DEVMODE_RESTART, (data: any[]) =>
			onDisconnection(room.sessionId));

		room.onMessage("__playground_message_types", (types) => {
			// sort message types for a clear view
			types.sort();
			// global message types by room name
			messageTypesByRoom[room.name] = types;

			// append connection to connections list
			onConnectionSuccessful(connection);
		});
	});

	return (<>
		<h2 className="text-xl font-semibold">Join a room</h2>

		<p className="mt-4"><strong>Method</strong></p>
		<div className="flex mt-2">
			{Object.keys(matchmakeMethods).map((method) => (
			<div key={method} className="flex items-center mr-4">
					<input id={method}
						type="radio"
						name="method"
						value={method}
						checked={selectedMethod === method}
						onChange={handleSelectedMethodChange}
						className="w-4 h-4 text-purple-600 bg-gray-100 border-gray-300 focus:ring-purple-500 focus:ring-2" />
					<label htmlFor={method} className="ml-2 text-sm font-medium text-gray-900 dark:text-slate-300">{matchmakeMethods[method]}</label>
			</div>
			))}
		</div>

		{(selectedMethod !== "joinById")
			? // NOT joinById
			<>
				<p className="mt-4"><strong>Available room types:</strong></p>
				<div className="flex mt-2 flex-wrap">

					{/* No room definitions found */}
					{(roomNames.length) === 0 &&
						<p>Your server does not define any room type. See <a href="https://docs.colyseus.io/server/api/#define-roomname-string-room-room-options-any">documentation</a>.</p>}

					{/* List room definitions */}
					{(roomNames).map((roomName) => (
						<div key={roomName} className="flex items-center mr-4 mb-2">
								<input id={"name_" + roomName}
									name="room_name"
									type="radio"
									value={roomName}
									checked={selectedRoomName === roomName}
									onChange={handleSelectedRoomChange}
									className="w-4 h-4 text-purple-600 bg-gray-100 border-gray-300 focus:ring-purple-500 focus:ring-2" />
								<label htmlFor={"name_" + roomName} className="ml-2 text-sm font-medium text-gray-900 dark:text-slate-300 cursor-pointer">
									<code className="bg-gray-100 dark:bg-slate-700 p-1">{roomName}</code>
									{(roomsByType[roomName] !== undefined) &&
										<span className="group relative ml-1 text-sm text-gray-500 cursor-help">
											({roomsByType[roomName]})
											<span className="absolute left-8 w-32 scale-0 rounded bg-gray-800 p-2 text-xs text-white group-hover:scale-100">{roomsByType[roomName] + " active room(s)"}</span>
										</span>}

								</label>
						</div>
					))}
				</div>
			</>

		: // joinById
			<>
				<p className="mt-4"><strong>Available rooms by ID:</strong></p>
				<div className="flex mt-2 flex-wrap">

					{/* No room definitions found */}
					{(Object.keys(roomsById).length) === 0 &&
						<p><em>No rooms available.</em></p>}

					{/* List room definitions */}
					{(Object.keys(roomsById)).map((roomId) => (
						<div key={roomId} className="flex items-center w-full mr-4 mb-2">
								<input id={"roomid_" + roomId}
									name="room_id"
									type="radio"
									value={roomId}
									checked={selectedRoomId === roomId}
									onChange={handleSelectedRoomChange}
									className="w-4 h-4 text-purple-600 bg-gray-100 border-gray-300 focus:ring-purple-500 focus:ring-2" />
								<label htmlFor={"roomid_" + roomId} className={"ml-2 cursor-pointer text-sm transition" + ((roomsById[roomId].locked) ? " opacity-60" : "")}>
									<RoomWithId name={roomsById[roomId].name} roomId={roomId} />
									<span className="text-gray-500 dark:text-slate-300 text-sm ml-1">
										({(roomsById[roomId].locked)
										? <svg className="inline text-xs mr-1" fill="currentColor" xmlns="http://www.w3.org/2000/svg" height="1em" viewBox="0 0 448 512"><path d="M144 144v48H304V144c0-44.2-35.8-80-80-80s-80 35.8-80 80zM80 192V144C80 64.5 144.5 0 224 0s144 64.5 144 144v48h16c35.3 0 64 28.7 64 64V448c0 35.3-28.7 64-64 64H64c-35.3 0-64-28.7-64-64V256c0-35.3 28.7-64 64-64H80z"/></svg>
										: <svg className="inline text-xs mr-1" fill="currentColor" xmlns="http://www.w3.org/2000/svg" height="1em" viewBox="0 0 576 512"><path d="M352 144c0-44.2 35.8-80 80-80s80 35.8 80 80v48c0 17.7 14.3 32 32 32s32-14.3 32-32V144C576 64.5 511.5 0 432 0S288 64.5 288 144v48H64c-35.3 0-64 28.7-64 64V448c0 35.3 28.7 64 64 64H384c35.3 0 64-28.7 64-64V256c0-35.3-28.7-64-64-64H352V144z"/></svg> }
									· {roomsById[roomId].clients} clients)
									</span>
								</label>
						</div>
					))}
				</div>
			</>
		}

		{/* Do not show "join options" if joining by room ID AND no room is available. */}
		{(selectedMethod === "joinById" && Object.keys(roomsById).length === 0)
			? null
			: <>
				<p className="mt-4"><strong>Join options</strong></p>
				<JSONEditor
					text={optionsText}
					onChangeText={onChangeOptions}
					onValidationError={onOptionsValidationError}
					mode="code"
					search={false}
					statusBar={false}
					navigationBar={false}
					mainMenuBar={false}
					className={"mt-2 h-24 overflow-hidden rounded border " + (isButtonEnabled ? "border-gray-300 dark:border-slate-500" : "border-red-300")}
				/>

				<p className="mt-4 cursor-pointer truncate overflow-hidden text-ellipsis" onClick={toggleAuthBlock}>
					<span className={`caret inline-block transition-all ${(isAuthBlockOpen) ? "rotate-90" : "rotate-0"}`}>▶</span> <strong>Auth Token </strong><small className="text-xs text-slate-600 dark:text-slate-300">{authToken && `(${authToken.length} chars) "${authToken}"` || "(none)"}</small>
				</p>

				{(isAuthBlockOpen)
					? <AuthOptions
							authToken={authToken}
							onAuthTokenChange={onAuthTokenChange}
							authConfig={authConfig}
							/>
					: null }

				<div className="flex mt-4">
					<button
						className="bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50 enabled:hover:bg-purple-700 text-white font-bold py-2 px-4 rounded transition"
						onClick={onJoinClick}
						disabled={!isButtonEnabled}>
						{matchmakeMethods[selectedMethod]}
					</button>
					<div className="ml-1 p-2 inline italic">
						{isLoading && "Connecting..."}
						{!isLoading && error &&
							<span className="text-red-500"><strong>Error:</strong> {error}</span>}
					</div>
				</div>
			</>}

	</>);
}
