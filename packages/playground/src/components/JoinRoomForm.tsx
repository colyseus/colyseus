import { Client, Room, RoomAvailable } from "colyseus.js";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faRightToBracket, faSpinner } from "@fortawesome/free-solid-svg-icons";
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

	const [isOptionsBlockOpen, setOptionsBlockOpen] = useState(false);
	const [isAuthBlockOpen, setAuthBlockOpen] = useState(false);
	const [authToken, setAuthToken] = useState(client.auth.token || "");

	const handleSelectedRoomChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
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

	const handleSelectedMethodChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
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

	const toggleOptionsBlock = function(e: React.MouseEvent) {
		e.preventDefault();
		setOptionsBlockOpen(!isOptionsBlockOpen);
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

	return (
		<div className="space-y-3">
			{/* Method Selection */}
			<div>
				<label htmlFor="method-select" className="block text-xs font-semibold text-gray-700 dark:text-slate-400 uppercase tracking-wide mb-1">
					Method
				</label>
				<select
					id="method-select"
					value={selectedMethod}
					onChange={handleSelectedMethodChange}
					className="w-full px-3 py-1.5 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded-lg text-sm text-gray-900 dark:text-slate-300 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-all cursor-pointer"
				>
					{Object.keys(matchmakeMethods).map((method) => (
						<option key={method} value={method}>
							{matchmakeMethods[method]}
						</option>
					))}
				</select>
			</div>

			{/* Room Selection */}
			<div>
				{selectedMethod !== "joinById" ? (
					<>
						<label htmlFor="room-type-select" className="block text-xs font-semibold text-gray-700 dark:text-slate-400 uppercase tracking-wide mb-1">
							Room Type
						</label>
						{roomNames.length === 0 ? (
							<div className="p-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
								<p className="text-sm text-yellow-800 dark:text-yellow-300">
									No room types defined.{" "}
									<a
										href="https://docs.colyseus.io/server/api/#define-roomname-string-room-room-options-any"
										className="underline hover:no-underline"
										target="_blank"
										rel="noopener noreferrer"
									>
										See documentation
									</a>
								</p>
							</div>
						) : (
							<select
								id="room-type-select"
								value={selectedRoomName}
								onChange={handleSelectedRoomChange}
								className="w-full px-3 py-1.5 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded-lg text-sm text-gray-900 dark:text-slate-300 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-all cursor-pointer font-mono"
							>
								{roomNames.map((roomName) => (
									<option key={roomName} value={roomName}>
										{roomName}
										{roomsByType[roomName] !== undefined ? ` (${roomsByType[roomName]})` : ""}
									</option>
								))}
							</select>
						)}
					</>
				) : (
					<>
						<label htmlFor="room-id-select" className="block text-xs font-semibold text-gray-700 dark:text-slate-400 uppercase tracking-wide mb-1">
							Room ID
						</label>
						{Object.keys(roomsById).length === 0 ? (
							<div className="p-2 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-lg">
								<p className="text-sm text-gray-600 dark:text-slate-400 italic">No rooms available.</p>
							</div>
						) : (
							<select
								id="room-id-select"
								value={selectedRoomId}
								onChange={handleSelectedRoomChange}
								className="w-full px-3 py-1.5 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded-lg text-sm text-gray-900 dark:text-slate-300 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-all cursor-pointer"
							>
								{Object.keys(roomsById).map((roomId) => (
									<option
										key={roomId}
										value={roomId}
										disabled={roomsById[roomId].locked}
									>
										{roomsById[roomId].name} - {roomId.substring(0, 8)}... ({roomsById[roomId].locked ? "🔒" : "🔓"} {roomsById[roomId].clients} clients)
									</option>
								))}
							</select>
						)}
					</>
				)}
			</div>

			{/* Join Options and Actions */}
			{!(selectedMethod === "joinById" && Object.keys(roomsById).length === 0) && (
				<>
					{/* Join Options */}
					<div className={`border border-gray-200 dark:border-slate-600 rounded-lg overflow-hidden ${isOptionsBlockOpen ? 'bg-gray-50 dark:bg-slate-800' : ''}`}>
						<button
							type="button"
							onClick={toggleOptionsBlock}
							className={`w-full flex items-center justify-between p-2 ${
								isOptionsBlockOpen
									? 'border-b border-gray-200 dark:border-slate-600 bg-gray-50 dark:bg-slate-800'
									: 'hover:bg-gray-50 dark:hover:bg-slate-800'
							}`}
						>
							<div className="flex items-center gap-2">
								<svg
									className={`w-3 h-3 transition-transform ${isOptionsBlockOpen ? "rotate-90" : ""}`}
									fill="currentColor"
									viewBox="0 0 20 20"
								>
									<path
										fillRule="evenodd"
										d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
										clipRule="evenodd"
									/>
								</svg>
								<span className="text-xs font-semibold text-gray-700 dark:text-slate-400 uppercase tracking-wide">
									Options (JSON)
								</span>
							</div>
							<span className="text-xs text-gray-500 dark:text-slate-500 truncate max-w-[150px] font-mono">
								{optionsText === "{}" ? "(empty)" : optionsText.substring(0, 20) + (optionsText.length > 20 ? "..." : "")}
							</span>
						</button>
						{isOptionsBlockOpen && (
              <JSONEditor
                text={optionsText}
                onChangeText={onChangeOptions}
                onValidationError={onOptionsValidationError}
                mode="code"
                search={false}
                statusBar={false}
                navigationBar={false}
                mainMenuBar={false}
                className={`rounded-b-lg border border-t-0 overflow-hidden h-20 ${
                  isButtonEnabled
                    ? "border-gray-300 dark:border-slate-600"
                    : "border-red-400 dark:border-red-600"
                }`}
              />
						)}
					</div>

					{/* Auth Token */}
					<div className={`border border-gray-200 dark:border-slate-600 rounded-lg overflow-hidden ${isAuthBlockOpen ? 'bg-gray-50 dark:bg-slate-800' : ''}`}>
						<button
							type="button"
							onClick={toggleAuthBlock}
							className={`w-full flex items-center justify-between p-2 ${
								isAuthBlockOpen
									? 'border-b border-gray-200 dark:border-slate-600 bg-gray-50 dark:bg-slate-800'
									: 'hover:bg-gray-50 dark:hover:bg-slate-800'
							}`}
						>
							<div className="flex items-center gap-2">
								<svg
									className={`w-3 h-3 transition-transform ${isAuthBlockOpen ? "rotate-90" : ""}`}
									fill="currentColor"
									viewBox="0 0 20 20"
								>
									<path
										fillRule="evenodd"
										d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
										clipRule="evenodd"
									/>
								</svg>
								<span className="text-xs font-semibold text-gray-700 dark:text-slate-400 uppercase tracking-wide">
									Auth Token
								</span>
							</div>
							<span className="text-xs text-gray-500 dark:text-slate-500 truncate max-w-[150px]">
								{authToken ? `${authToken.length} chars` : "(none)"}
							</span>
						</button>
						{isAuthBlockOpen && (
              <AuthOptions
                authToken={authToken}
                onAuthTokenChange={onAuthTokenChange}
                authConfig={authConfig}
              />
						)}
					</div>

					{/* Connect Button */}
					<div>
						<button
							className="w-full bg-purple-600 disabled:cursor-not-allowed disabled:opacity-50 enabled:hover:bg-purple-700 text-white font-semibold py-2 px-4 rounded-lg transition-all shadow-sm enabled:hover:shadow-md"
							onClick={onJoinClick}
							disabled={!isButtonEnabled || isLoading}
						>
							{isLoading ? (
								<span className="flex items-center justify-center gap-2">
									Connecting...
									<div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></div>
								</span>
							) : (<>
                {matchmakeMethods[selectedMethod]} <FontAwesomeIcon icon={faRightToBracket} className="ml-1 inline" />
              </>)}
						</button>
						{!isLoading && error && (
							<div className="mt-2 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
								<p className="text-sm text-red-700 dark:text-red-400">
									<strong>Error:</strong> {error}
								</p>
							</div>
						)}
					</div>
				</>
			)}
		</div>
	);
}
