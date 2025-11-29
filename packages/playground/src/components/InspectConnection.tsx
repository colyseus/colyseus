import type { Client } from "@colyseus/sdk";
import { useEffect, useState } from "react";
import { Connection, roomsBySessionId, messageTypesByRoom } from "../utils/Types";
import { Timestamp } from "../elements/Timestamp";

import { JSONSchemaFields } from "./JSONSchemaFields";
import { JSONEditor } from "../elements/JSONEditor";
import * as JSONEditorModule from "jsoneditor";

enum InspectTab {
	MESSAGES = "messages",
	// SCHEMA = "schema",
	RAW = "raw",
};

interface TabConfig {
	label: string,
	icon: React.ReactNode,
}

const tabs: {[key in InspectTab]: TabConfig} = {
	[InspectTab.MESSAGES]: {
		label: "Messages",
		icon: <svg className="w-4 mr-1 " fill="currentColor" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M64 112c-8.8 0-16 7.2-16 16v22.1L220.5 291.7c20.7 17 50.4 17 71.1 0L464 150.1V128c0-8.8-7.2-16-16-16H64zM48 212.2V384c0 8.8 7.2 16 16 16H448c8.8 0 16-7.2 16-16V212.2L322 328.8c-38.4 31.5-93.7 31.5-132 0L48 212.2zM0 128C0 92.7 28.7 64 64 64H448c35.3 0 64 28.7 64 64V384c0 35.3-28.7 64-64 64H64c-35.3 0-64-28.7-64-64V128z" /></svg>,
	},
	// [InspectTab.SCHEMA]: {
	// 	label: "Schema operations",
	// 	icon: <svg className="w-4 mr-1" fill="currentColor" width="21" height="16" viewBox="0 0 21 16" xmlns="http://www.w3.org/2000/svg"> <g clipPath="url(#clip0_5_340)"> <path d="M16.5798 6.3375L15.9798 5.5375L14.4798 6.6625L15.0798 7.4625L16.5798 6.3375ZM18.5298 6C18.9454 6 19.3298 5.875 19.6485 5.65938C19.861 5.51562 20.0454 5.33125 20.1892 5.11875C20.4048 4.8 20.5298 4.41563 20.5298 4C20.5298 3.58437 20.4048 3.2 20.1892 2.88125C20.1173 2.775 20.036 2.675 19.9454 2.58437C19.8548 2.49375 19.7548 2.4125 19.6485 2.34063C19.3298 2.125 18.9454 2 18.5298 2C18.1142 2 17.7298 2.125 17.411 2.34063C17.1985 2.48438 17.0142 2.66875 16.8704 2.88125C16.6548 3.2 16.5298 3.58437 16.5298 4C16.5298 5.10313 17.4267 6 18.5298 6ZM18.5298 3C19.0798 3 19.5298 3.45 19.5298 4C19.5298 4.55 19.0798 5 18.5298 5C17.9798 5 17.5298 4.55 17.5298 4C17.5298 3.45 17.9798 3 18.5298 3ZM3.64854 7.84062C3.32979 7.625 2.94541 7.5 2.52979 7.5C2.11416 7.5 1.72979 7.625 1.41104 7.84062C1.19854 7.98438 1.01416 8.16875 0.87041 8.38125C0.654785 8.7 0.529785 9.08438 0.529785 9.5C0.529785 10.6031 1.42666 11.5 2.52979 11.5C3.63291 11.5 4.52979 10.6031 4.52979 9.5C4.52979 9.08438 4.40479 8.7 4.18916 8.38125C4.04541 8.16875 3.86104 7.98438 3.64854 7.84062ZM2.52979 10.5C1.97979 10.5 1.52979 10.05 1.52979 9.5C1.52979 8.95 1.97979 8.5 2.52979 8.5C3.07979 8.5 3.52979 8.95 3.52979 9.5C3.52979 10.05 3.07979 10.5 2.52979 10.5ZM5.27979 10H6.77979V9H5.27979V10ZM19.9454 12.5844C19.8548 12.4938 19.7548 12.4125 19.6485 12.3406C19.3298 12.125 18.9454 12 18.5298 12C18.1142 12 17.7298 12.125 17.411 12.3406C17.3079 12.4094 17.2142 12.4875 17.1267 12.575L14.2579 10.8531C14.4329 10.4375 14.5298 9.97812 14.5298 9.5C14.5298 7.56563 12.9642 6 11.0298 6C10.6767 6 10.3454 6.06875 10.0235 6.1625L8.79541 3.53437C9.24228 3.16875 9.52979 2.62188 9.52979 2C9.52979 1.58438 9.40479 1.2 9.18916 0.88125C9.04541 0.66875 8.86103 0.484375 8.64853 0.340625C8.32978 0.125 7.94541 0 7.52979 0C7.11416 0 6.72978 0.125 6.41104 0.340625C6.19853 0.484375 6.01416 0.66875 5.87041 0.88125C5.65479 1.2 5.52979 1.58438 5.52979 2C5.52979 3.10313 6.42666 4 7.52979 4C7.65479 4 7.77666 3.98438 7.89541 3.9625L9.11416 6.575C8.16104 7.2 7.52979 8.275 7.52979 9.5C7.52979 11.4344 9.09541 13 11.0298 13C12.1235 13 13.086 12.4875 13.7298 11.7031L16.6173 13.4344C16.5642 13.6156 16.5329 13.8031 16.5329 14C16.5329 15.1031 17.4298 16 18.5329 16C18.9485 16 19.3329 15.875 19.6517 15.6594C19.8642 15.5156 20.0485 15.3312 20.1923 15.1187C20.4048 14.8 20.5298 14.4156 20.5298 14C20.5298 13.5844 20.4048 13.2 20.1892 12.8813C20.1173 12.775 20.0329 12.675 19.9454 12.5844ZM7.52979 3C6.97978 3 6.52979 2.55 6.52979 2C6.52979 1.45 6.97978 1 7.52979 1C8.07979 1 8.52979 1.45 8.52979 2C8.52979 2.55 8.07979 3 7.52979 3ZM11.0298 12C9.65166 12 8.52979 10.8781 8.52979 9.5C8.52979 8.12187 9.65166 7 11.0298 7C12.4079 7 13.5298 8.12187 13.5298 9.5C13.5298 10.8781 12.4079 12 11.0298 12ZM18.5298 15C17.9798 15 17.5298 14.55 17.5298 14C17.5298 13.45 17.9798 13 18.5298 13C19.0798 13 19.5298 13.45 19.5298 14C19.5298 14.55 19.0798 15 18.5298 15Z"></path> </g> <defs> <clipPath id="clip0_5_340"> <rect width="20" height="16" fill="white" transform="translate(0.529785)"></rect> </clipPath> </defs> </svg>,
	// },
	[InspectTab.RAW]: {
		label: "Raw Events",
		icon: <svg className="w-4 mr-1" fill="currentColor" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 512"><path d="M308.5 135.3c7.1-6.3 9.9-16.2 6.2-25c-2.3-5.3-4.8-10.5-7.6-15.5L304 89.4c-3-5-6.3-9.9-9.8-14.6c-5.7-7.6-15.7-10.1-24.7-7.1l-28.2 9.3c-10.7-8.8-23-16-36.2-20.9L199 27.1c-1.9-9.3-9.1-16.7-18.5-17.8C173.9 8.4 167.2 8 160.4 8h-.7c-6.8 0-13.5 .4-20.1 1.2c-9.4 1.1-16.6 8.6-18.5 17.8L115 56.1c-13.3 5-25.5 12.1-36.2 20.9L50.5 67.8c-9-3-19-.5-24.7 7.1c-3.5 4.7-6.8 9.6-9.9 14.6l-3 5.3c-2.8 5-5.3 10.2-7.6 15.6c-3.7 8.7-.9 18.6 6.2 25l22.2 19.8C32.6 161.9 32 168.9 32 176s.6 14.1 1.7 20.9L11.5 216.7c-7.1 6.3-9.9 16.2-6.2 25c2.3 5.3 4.8 10.5 7.6 15.6l3 5.2c3 5.1 6.3 9.9 9.9 14.6c5.7 7.6 15.7 10.1 24.7 7.1l28.2-9.3c10.7 8.8 23 16 36.2 20.9l6.1 29.1c1.9 9.3 9.1 16.7 18.5 17.8c6.7 .8 13.5 1.2 20.4 1.2s13.7-.4 20.4-1.2c9.4-1.1 16.6-8.6 18.5-17.8l6.1-29.1c13.3-5 25.5-12.1 36.2-20.9l28.2 9.3c9 3 19 .5 24.7-7.1c3.5-4.7 6.8-9.5 9.8-14.6l3.1-5.4c2.8-5 5.3-10.2 7.6-15.5c3.7-8.7 .9-18.6-6.2-25l-22.2-19.8c1.1-6.8 1.7-13.8 1.7-20.9s-.6-14.1-1.7-20.9l22.2-19.8zM112 176a48 48 0 1 1 96 0 48 48 0 1 1 -96 0zM504.7 500.5c6.3 7.1 16.2 9.9 25 6.2c5.3-2.3 10.5-4.8 15.5-7.6l5.4-3.1c5-3 9.9-6.3 14.6-9.8c7.6-5.7 10.1-15.7 7.1-24.7l-9.3-28.2c8.8-10.7 16-23 20.9-36.2l29.1-6.1c9.3-1.9 16.7-9.1 17.8-18.5c.8-6.7 1.2-13.5 1.2-20.4s-.4-13.7-1.2-20.4c-1.1-9.4-8.6-16.6-17.8-18.5L583.9 307c-5-13.3-12.1-25.5-20.9-36.2l9.3-28.2c3-9 .5-19-7.1-24.7c-4.7-3.5-9.6-6.8-14.6-9.9l-5.3-3c-5-2.8-10.2-5.3-15.6-7.6c-8.7-3.7-18.6-.9-25 6.2l-19.8 22.2c-6.8-1.1-13.8-1.7-20.9-1.7s-14.1 .6-20.9 1.7l-19.8-22.2c-6.3-7.1-16.2-9.9-25-6.2c-5.3 2.3-10.5 4.8-15.6 7.6l-5.2 3c-5.1 3-9.9 6.3-14.6 9.9c-7.6 5.7-10.1 15.7-7.1 24.7l9.3 28.2c-8.8 10.7-16 23-20.9 36.2L315.1 313c-9.3 1.9-16.7 9.1-17.8 18.5c-.8 6.7-1.2 13.5-1.2 20.4s.4 13.7 1.2 20.4c1.1 9.4 8.6 16.6 17.8 18.5l29.1 6.1c5 13.3 12.1 25.5 20.9 36.2l-9.3 28.2c-3 9-.5 19 7.1 24.7c4.7 3.5 9.5 6.8 14.6 9.8l5.4 3.1c5 2.8 10.2 5.3 15.5 7.6c8.7 3.7 18.6 .9 25-6.2l19.8-22.2c6.8 1.1 13.8 1.7 20.9 1.7s14.1-.6 20.9-1.7l19.8 22.2zM464 304a48 48 0 1 1 0 96 48 48 0 1 1 0-96z" /></svg>
	},
};

// When switching connections, use last tab opened from previous session
let lastTabSelected = InspectTab.MESSAGES;

const MAX_TABLE_ROWS = 25;

export function InspectConnection({
	client,
	connection,
}: {
	client: Client,
	connection: Connection,
}) {
	const room = roomsBySessionId[connection.sessionId];
	const messageTypes = [...Object.keys(messageTypesByRoom[room.name] || {}), "*"];
	const messageFormats = messageTypesByRoom[room.name];
	if (!messageTypes) { throw new Error("messageTypes not found for room: " + room.name); }

	// state
	const [message, setMessage] = useState("{}");
	const [messageValues, setMessageValues] = useState<Record<string, any>>({});
	const [messageType, setMessageType] = useState(messageTypes[0]);
	const [customMessageType, setCustomMessageType] = useState("");
	const [isSendMessageEnabled, setSendMessageEnabled] = useState(true);
	const [selectedTab, setSelectedTab] = useState(lastTabSelected)
	const [currentError, setCurrentError] = useState("");

	// in/out messages & events
	const [messages, setMessages] = useState((connection.messages) as any[]);
	const [events, setEvents] = useState((connection.events) as any[]);

	// TODO: allow sending message of any type
	const hasWildcardMessageType = messageTypes.indexOf("*") >= 0;
	const allowReconnect = !connection.isConnected;

	const handleMessageTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
		const newMessageType = e.target.value;
		setMessageType(newMessageType);
		setMessageValues({});
		setMessage("{}");
		setCustomMessageType("");
	};

	const onChangeMessage = (text: string) =>
		setMessage(text);

	const onMessageValidationError = (errors: ReadonlyArray<JSONEditorModule.SchemaValidationError | JSONEditorModule.ParseError>) =>
		setSendMessageEnabled(errors.length === 0);

	const onSchemaFieldChange = (key: string, value: any) => {
		const newValues = { ...messageValues };
		if (value === undefined) {
			delete newValues[key];
		} else {
			newValues[key] = value;
		}
		setMessageValues(newValues);
		setSendMessageEnabled(true);
	};

	const handleSelectTab = (e: React.MouseEvent<HTMLButtonElement>) => {
		lastTabSelected = e.currentTarget.value as InspectTab;
		setSelectedTab(lastTabSelected);
	}

	const displayError = (message: any) => {
		setCurrentError(message);
		setTimeout(() => setCurrentError(""), 3000);
	}

	// actions
	const reconnect = async () => {
		try {
			// manually reconnect using internal SDK API:
			const [roomId, reconnectionToken] = room.reconnectionToken.split(":");
			await client['createMatchMakeRequest']("reconnect", roomId, { reconnectionToken });

		} catch (e: any) {
			displayError(e.message);
		}
	}

	const drop = () => room.connection.close();
	const leave = () => room.leave();

	const sendMessage = () => {
		try {
			const now = new Date();
			const actualMessageType = messageType === "*" ? customMessageType : messageType;
			const hasValidator = messageFormats?.[messageType];
			const payload = hasValidator ? messageValues : JSON.parse(message || "{}");

			const newMessage = { type: actualMessageType, message: payload, out: true, now, };
			setMessages([newMessage, ...messages]);
			connection.messages.unshift(newMessage);

			room.send(actualMessageType, payload);

		} catch (e: any) {
			displayError(e.message);
		}
	};

	//
	// FIXME: (there must be a cleaner way to do this!)
	// bind re-render of messages and events
	//
	useEffect(() => {
		connection.events.onChange = () => setEvents([...connection.events]);
		connection.messages.onChange = () => setMessages([...connection.messages]);
	}, []);

	return (
		<>
			<div>
				<div className="grid grid-cols-3 gap-1.5 sm:gap-2 my-2 text-xs sm:text-sm">
					<button className="bg-red-500 enabled:hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-2 px-2 sm:px-4 rounded" disabled={allowReconnect} onClick={drop}>
						<svg className="w-3 sm:w-4 mr-0.5 sm:mr-1 inline" fill="currentColor" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512"><path d="M342.6 150.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192 210.7 86.6 105.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L146.7 256 41.4 361.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192 301.3 297.4 406.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.3 256 342.6 150.6z" /></svg>
						<span className="hidden sm:inline">Drop</span>
					</button>
					<button className="bg-red-500 enabled:hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-2 px-2 sm:px-4 rounded" disabled={allowReconnect} onClick={leave}>
						<svg className="w-3 sm:w-4 mr-0.5 sm:mr-1 inline" fill="currentColor" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M502.6 278.6c12.5-12.5 12.5-32.8 0-45.3l-128-128c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L402.7 224 192 224c-17.7 0-32 14.3-32 32s14.3 32 32 32l210.7 0-73.4 73.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0l128-128zM160 96c17.7 0 32-14.3 32-32s-14.3-32-32-32L96 32C43 32 0 75 0 128L0 384c0 53 43 96 96 96l64 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-64 0c-17.7 0-32-14.3-32-32l0-256c0-17.7 14.3-32 32-32l64 0z" /></svg>
						<span className="hidden sm:inline">Leave</span>
					</button>
					<button className="bg-green-500 enabled:hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-2 px-2 sm:px-4 rounded" disabled={!allowReconnect} onClick={reconnect}>
						<svg className="w-3 sm:w-4 mr-0.5 sm:mr-1 inline" fill="currentColor" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M352 96l64 0c17.7 0 32 14.3 32 32l0 256c0 17.7-14.3 32-32 32l-64 0c-17.7 0-32 14.3-32 32s14.3 32 32 32l64 0c53 0 96-43 96-96l0-256c0-53-43-96-96-96l-64 0c-17.7 0-32 14.3-32 32s14.3 32 32 32zm-9.4 182.6c12.5-12.5 12.5-32.8 0-45.3l-128-128c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L242.7 224 32 224c-17.7 0-32 14.3-32 32s14.3 32 32 32l210.7 0-73.4 73.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0l128-128z" /></svg>
						<span className="hidden sm:inline">Reconnect</span>
					</button>
				</div>

				{/* Display reconnection error */}
				{(currentError) &&
					<div className="bg-red-500 text-white py-2 px-3 rounded text-sm my-2"><strong>Error:</strong> {currentError}</div>}

			<div className="mt-4 mb-6 bg-gradient-to-br from-purple-50 to-blue-50 dark:from-slate-800 dark:to-slate-700 rounded-lg border border-purple-200 dark:border-slate-600 shadow-sm overflow-hidden">
				<div className="bg-white/60 dark:bg-slate-800/60 backdrop-blur-sm px-4 py-3 border-b border-purple-200 dark:border-slate-600">
					<div className="flex items-center gap-2">
						<svg className="w-4 h-4 sm:w-5 sm:h-5 text-purple-600 dark:text-purple-400" fill="currentColor" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
							<path d="M498.1 5.6c10.1 7 15.4 19.1 13.5 31.2l-64 416c-1.5 9.7-7.4 18.2-16 23s-18.9 5.4-28 1.6L284 427.7l-68.5 74.1c-8.9 9.7-22.9 12.9-35.2 8.1S160 493.2 160 480V396.4c0-4 1.5-7.8 4.2-10.7L331.8 202.8c5.8-6.3 5.6-16-.4-22s-15.7-6.4-22-.7L106 360.8 17.7 316.6C7.1 311.3 .3 300.7 0 288.9s5.9-22.8 16.1-28.7l448-256c10.7-6.1 23.9-5.5 34 1.4z"/>
						</svg>
						<h3 className="text-sm sm:text-base font-semibold text-gray-800 dark:text-slate-200">
							Send a message
						</h3>
					</div>
				</div>

				<div className="p-4">
					{(messageTypes.length === 0 && !hasWildcardMessageType)
						? <div className="flex items-start gap-3 p-4 bg-gray-50 dark:bg-slate-900/50 rounded-lg border border-gray-200 dark:border-slate-600">
								<svg className="w-5 h-5 text-gray-400 dark:text-slate-500 flex-shrink-0 mt-0.5" fill="currentColor" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
									<path d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM216 336h24V272H216c-13.3 0-24-10.7-24-24s10.7-24 24-24h48c13.3 0 24 10.7 24 24v88h8c13.3 0 24 10.7 24 24s-10.7 24-24 24H216c-13.3 0-24-10.7-24-24s10.7-24 24-24zm40-208a32 32 0 1 1 0 64 32 32 0 1 1 0-64z"/>
								</svg>
								<div className="flex-1">
									<p className="text-sm text-gray-600 dark:text-slate-400 leading-relaxed">
										This room type does not listen to messages.
										<br />
										<span className="text-xs">Learn how to handle messages with <a href="https://docs.colyseus.io/server/room/#onmessage-type-callback" target="_blank" className="text-purple-600 dark:text-purple-400 hover:underline font-medium">.onMessage()</a></span>
									</p>
								</div>
							</div>
						: <div className="flex flex-col gap-4">
								<div className="flex flex-col gap-2">
									<label className="block text-xs font-semibold text-gray-700 dark:text-slate-400 uppercase tracking-wide">
										Message Type
									</label>
									<select
										className="w-full border-2 border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-300 p-2.5 rounded-lg text-sm font-medium focus:ring-2 focus:ring-purple-500 focus:border-purple-500 dark:focus:ring-purple-400 dark:focus:border-purple-400 transition-all cursor-pointer hover:border-purple-400 dark:hover:border-slate-500"
										value={messageType}
										onChange={handleMessageTypeChange}>
										<option disabled={true} value="">Select a message type</option>
										{(messageTypes).map((type) => (
											<option key={type} value={type}>{type === "*" ? "* (Custom)" : type}</option>
										))}
									</select>
								</div>

								{messageType === "*" && (
									<div className="flex flex-col gap-2">
										<label className="block text-xs font-semibold text-gray-700 dark:text-slate-400 uppercase tracking-wide">
											Custom Message Type
										</label>
										<input
											autoFocus
											type="text"
											className="w-full border-2 border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-300 p-2.5 rounded-lg text-sm font-medium focus:ring-2 focus:ring-purple-500 focus:border-purple-500 dark:focus:ring-purple-400 dark:focus:border-purple-400 transition-all hover:border-purple-400 dark:hover:border-slate-500"
											placeholder="Enter custom message type"
											value={customMessageType}
											onChange={(e) => setCustomMessageType(e.target.value)}
										/>
									</div>
								)}

								<div key={messageType} className="flex flex-col gap-2">
									<label className="block text-xs font-semibold text-gray-700 dark:text-slate-400 uppercase tracking-wide">
										Message Payload
									</label>
									{messageFormats?.[messageType] ? (
										<div className={"rounded-lg border-2 w-full transition-all p-3 " + (isSendMessageEnabled ? "border-gray-300 dark:border-slate-600" : "border-red-400 dark:border-red-500 ring-2 ring-red-500/20")}>
											<JSONSchemaFields
												autoFocus
												schema={messageFormats[messageType]}
												values={messageValues}
												onChange={onSchemaFieldChange}
											/>
										</div>
									) : (
										<JSONEditor
											autoFocus={messageType !== "*"}
											text={message}
											onChangeText={onChangeMessage}
											onValidationError={onMessageValidationError}
											maxLines={3}
											mode="code"
											search={false}
											statusBar={false}
											navigationBar={false}
											mainMenuBar={false}
											className={"h-20 overflow-hidden rounded-lg border-2 w-full transition-all " + (isSendMessageEnabled ? "border-gray-300 dark:border-slate-600 focus-within:border-purple-500 focus-within:ring-2 focus-within:ring-purple-500/20" : "border-red-400 dark:border-red-500 ring-2 ring-red-500/20")}
										/>
									)}
								</div>

								<div className="flex">
									<button
										className="w-full bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-700 hover:to-purple-600 disabled:from-gray-400 disabled:to-gray-400 disabled:cursor-not-allowed text-white font-semibold py-2.5 px-5 rounded-lg text-sm whitespace-nowrap transition-all duration-200 shadow-md hover:shadow-lg disabled:shadow-none transform hover:scale-[1.02] active:scale-[0.98] disabled:transform-none flex items-center justify-center gap-2"
										disabled={!isSendMessageEnabled || (messageType === "*" && !customMessageType.trim())}
										onClick={sendMessage}>
										<svg className="w-4 h-4" fill="currentColor" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
											<path d="M498.1 5.6c10.1 7 15.4 19.1 13.5 31.2l-64 416c-1.5 9.7-7.4 18.2-16 23s-18.9 5.4-28 1.6L284 427.7l-68.5 74.1c-8.9 9.7-22.9 12.9-35.2 8.1S160 493.2 160 480V396.4c0-4 1.5-7.8 4.2-10.7L331.8 202.8c5.8-6.3 5.6-16-.4-22s-15.7-6.4-22-.7L106 360.8 17.7 316.6C7.1 311.3 .3 300.7 0 288.9s5.9-22.8 16.1-28.7l448-256c10.7-6.1 23.9-5.5 34 1.4z"/>
										</svg>
										<span>Send</span>
									</button>
								</div>
							</div>
					}
				</div>
			</div>

			</div>

		<div className="border-b-2 border-gray-200 dark:border-slate-600">
			<ul className="flex flex-wrap mt-1.5 -mb-0.5 text-sm font-medium text-center">

				{(Object.keys(tabs) as InspectTab[]).map((tab) => (
					<li key={tab} className="mr-1">
						<button
							onClick={handleSelectTab}
							value={tab}
							className={
								"inline-flex items-center px-5 py-3 border-b-2 transition-all duration-200 ease-in-out font-semibold " +
								(selectedTab === tab
									? "text-purple-600 dark:text-purple-400 border-purple-600 dark:border-purple-400 bg-purple-50 dark:bg-purple-950/30"
									: "text-gray-500 dark:text-slate-400 border-transparent hover:text-gray-700 dark:hover:text-slate-300 hover:border-gray-300 dark:hover:border-slate-500 hover:bg-gray-50 dark:hover:bg-slate-700/30"
								)
							}
							aria-current={selectedTab === tab ? "page" : undefined}>
							{tabs[tab].icon}
							{tabs[tab].label}
						</button>
					</li>
				))}

			</ul>
		</div>

		{/* Messages */}
		<div className="mt-4">
			{(selectedTab === InspectTab.MESSAGES) &&
				<div className="rounded-lg overflow-hidden shadow-md border border-gray-200 dark:border-slate-600">
					<div className="overflow-x-auto">
						<table className="table-auto w-full border-collapse text-center text-xs sm:text-sm">
							<thead>
								<tr className="bg-gradient-to-r from-purple-50 to-blue-50 dark:from-slate-800 dark:to-slate-700">
									<th colSpan={2} className="p-3 sm:p-4 border-b border-r dark:border-slate-600 font-semibold text-gray-700 dark:text-slate-200">
										<div className="flex items-center justify-center gap-2">
											<svg className="w-4 h-4" fill="currentColor" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M64 112c-8.8 0-16 7.2-16 16v22.1L220.5 291.7c20.7 17 50.4 17 71.1 0L464 150.1V128c0-8.8-7.2-16-16-16H64zM48 212.2V384c0 8.8 7.2 16 16 16H448c8.8 0 16-7.2 16-16V212.2L322 328.8c-38.4 31.5-93.7 31.5-132 0L48 212.2zM0 128C0 92.7 28.7 64 64 64H448c35.3 0 64 28.7 64 64V384c0 35.3-28.7 64-64 64H64c-35.3 0-64-28.7-64-64V128z" /></svg>
											<span>Type</span>
										</div>
									</th>
									<th className="p-3 sm:p-4 w-full border-b border-r dark:border-slate-600 font-semibold text-gray-700 dark:text-slate-200">Payload</th>
									<th className="p-3 sm:p-4 border-b dark:border-slate-600 font-semibold text-gray-700 dark:text-slate-200">Time</th>
								</tr>
							</thead>

							<tbody className="bg-white dark:bg-slate-900">
								{(messages.length === 0) &&
									<tr>
										<td colSpan={4} className="p-8 text-center">
											<div className="flex flex-col items-center gap-3 text-gray-400 dark:text-slate-500">
												<svg className="w-12 h-12 opacity-50" fill="currentColor" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M64 112c-8.8 0-16 7.2-16 16v22.1L220.5 291.7c20.7 17 50.4 17 71.1 0L464 150.1V128c0-8.8-7.2-16-16-16H64zM48 212.2V384c0 8.8 7.2 16 16 16H448c8.8 0 16-7.2 16-16V212.2L322 328.8c-38.4 31.5-93.7 31.5-132 0L48 212.2zM0 128C0 92.7 28.7 64 64 64H448c35.3 0 64 28.7 64 64V384c0 35.3-28.7 64-64 64H64c-35.3 0-64-28.7-64-64V128z" /></svg>
												<p className="text-sm font-medium">No messages yet</p>
												<p className="text-xs">Messages will appear here when sent or received</p>
											</div>
										</td>
									</tr>}

								{(messages).slice(0, MAX_TABLE_ROWS).map((message, i) => (
									<tr
										key={i + '-' + message.now}
										className={
											"border-b dark:border-slate-700 transition-all duration-150 hover:shadow-sm " +
											(message.in
												? "bg-gradient-to-r from-red-50 to-pink-50 dark:from-red-950/30 dark:to-pink-950/30 hover:from-red-100 hover:to-pink-100 dark:hover:from-red-950/50 dark:hover:to-pink-950/50"
												: "bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30 hover:from-green-100 hover:to-emerald-100 dark:hover:from-green-950/50 dark:hover:to-emerald-950/50"
											)
										}>
										<td className="p-2 sm:p-3">
											{message.in &&
												<div className="inline-flex items-center justify-center w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-red-200 dark:bg-red-900/50">
													<span className="text-red-700 dark:text-red-300 text-base font-bold">↓</span>
												</div>}

											{message.out &&
												<div className="inline-flex items-center justify-center w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-green-200 dark:bg-green-900/50">
													<span className="text-green-700 dark:text-green-300 text-base font-bold">↑</span>
												</div>}
										</td>

										<td className="p-2 sm:p-3 border-r text-left dark:border-slate-700">
											<code className="inline-block bg-white dark:bg-slate-800 px-2 py-1 rounded-md shadow-sm border border-gray-200 dark:border-slate-600 text-purple-600 dark:text-purple-400 font-mono text-[10px] sm:text-xs font-semibold">"{message.type}"</code>
										</td>

										<td className="p-2 sm:p-3 border-r text-left dark:border-slate-700">
											<div className="truncate max-w-[200px] sm:max-w-[300px] md:max-w-[400px]">
												<code className="text-gray-700 dark:text-slate-300 font-mono text-[10px] sm:text-xs">{JSON.stringify(message.message)}</code>
											</div>
										</td>

										<td className="p-2 sm:p-3 text-[10px] sm:text-xs whitespace-nowrap text-gray-600 dark:text-slate-400 font-medium">
											<Timestamp date={message.now} />
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>}

			{/* Events */}
			{(selectedTab === InspectTab.RAW) &&
				<div className="rounded-lg overflow-hidden shadow-md border border-gray-200 dark:border-slate-600">
					<div className="overflow-x-auto">
						<table className="table-auto w-full border-collapse text-center text-xs sm:text-sm min-w-[600px]">
							<thead>
								<tr className="bg-gradient-to-r from-purple-50 to-blue-50 dark:from-slate-800 dark:to-slate-700">
									<th colSpan={2} className="p-3 sm:p-4 border-b border-r dark:border-slate-600 font-semibold text-gray-700 dark:text-slate-200">
										<div className="flex items-center justify-center gap-2">
											<svg className="w-4 h-4" fill="currentColor" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 512"><path d="M308.5 135.3c7.1-6.3 9.9-16.2 6.2-25c-2.3-5.3-4.8-10.5-7.6-15.5L304 89.4c-3-5-6.3-9.9-9.8-14.6c-5.7-7.6-15.7-10.1-24.7-7.1l-28.2 9.3c-10.7-8.8-23-16-36.2-20.9L199 27.1c-1.9-9.3-9.1-16.7-18.5-17.8C173.9 8.4 167.2 8 160.4 8h-.7c-6.8 0-13.5 .4-20.1 1.2c-9.4 1.1-16.6 8.6-18.5 17.8L115 56.1c-13.3 5-25.5 12.1-36.2 20.9L50.5 67.8c-9-3-19-.5-24.7 7.1c-3.5 4.7-6.8 9.6-9.9 14.6l-3 5.3c-2.8 5-5.3 10.2-7.6 15.6c-3.7 8.7-.9 18.6 6.2 25l22.2 19.8C32.6 161.9 32 168.9 32 176s.6 14.1 1.7 20.9L11.5 216.7c-7.1 6.3-9.9 16.2-6.2 25c2.3 5.3 4.8 10.5 7.6 15.6l3 5.2c3 5.1 6.3 9.9 9.9 14.6c5.7 7.6 15.7 10.1 24.7 7.1l28.2-9.3c10.7 8.8 23 16 36.2 20.9l6.1 29.1c1.9 9.3 9.1 16.7 18.5 17.8c6.7 .8 13.5 1.2 20.4 1.2s13.7-.4 20.4-1.2c9.4-1.1 16.6-8.6 18.5-17.8l6.1-29.1c13.3-5 25.5-12.1 36.2-20.9l28.2 9.3c9 3 19 .5 24.7-7.1c3.5-4.7 6.8-9.5 9.8-14.6l3.1-5.4c2.8-5 5.3-10.2 7.6-15.5c3.7-8.7 .9-18.6-6.2-25l-22.2-19.8c1.1-6.8 1.7-13.8 1.7-20.9s-.6-14.1-1.7-20.9l22.2-19.8zM112 176a48 48 0 1 1 96 0 48 48 0 1 1 -96 0zM504.7 500.5c6.3 7.1 16.2 9.9 25 6.2c5.3-2.3 10.5-4.8 15.5-7.6l5.4-3.1c5-3 9.9-6.3 14.6-9.8c7.6-5.7 10.1-15.7 7.1-24.7l-9.3-28.2c8.8-10.7 16-23 20.9-36.2l29.1-6.1c9.3-1.9 16.7-9.1 17.8-18.5c.8-6.7 1.2-13.5 1.2-20.4s-.4-13.7-1.2-20.4c-1.1-9.4-8.6-16.6-17.8-18.5L583.9 307c-5-13.3-12.1-25.5-20.9-36.2l9.3-28.2c3-9 .5-19-7.1-24.7c-4.7-3.5-9.6-6.8-14.6-9.9l-5.3-3c-5-2.8-10.2-5.3-15.6-7.6c-8.7-3.7-18.6-.9-25 6.2l-19.8 22.2c-6.8-1.1-13.8-1.7-20.9-1.7s-14.1 .6-20.9 1.7l-19.8-22.2c-6.3-7.1-16.2-9.9-25-6.2c-5.3 2.3-10.5 4.8-15.6 7.6l-5.2 3c-5.1 3-9.9 6.3-14.6 9.9c-7.6 5.7-10.1 15.7-7.1 24.7l9.3 28.2c-8.8 10.7-16 23-20.9 36.2L315.1 313c-9.3 1.9-16.7 9.1-17.8 18.5c-.8 6.7-1.2 13.5-1.2 20.4s.4 13.7 1.2 20.4c1.1 9.4 8.6 16.6 17.8 18.5l29.1 6.1c5 13.3 12.1 25.5 20.9 36.2l-9.3 28.2c-3 9-.5 19 7.1 24.7c4.7 3.5 9.5 6.8 14.6 9.8l5.4 3.1c5 2.8 10.2 5.3 15.5 7.6c8.7 3.7 18.6 .9 25-6.2l19.8-22.2c6.8 1.1 13.8 1.7 20.9 1.7s14.1-.6 20.9-1.7l19.8 22.2zM464 304a48 48 0 1 1 0 96 48 48 0 1 1 0-96z" /></svg>
											<span>Event</span>
										</div>
									</th>
									<th className="p-3 sm:p-4 w-full border-b border-r dark:border-slate-600 font-semibold text-gray-700 dark:text-slate-200">Raw</th>
									<th className="p-3 sm:p-4 border-b dark:border-slate-600 font-semibold text-gray-700 dark:text-slate-200">Time</th>
								</tr>
							</thead>

							<tbody className="bg-white dark:bg-slate-900">
								{(events.length === 0) &&
									<tr>
										<td colSpan={4} className="p-8 text-center">
											<div className="flex flex-col items-center gap-3 text-gray-400 dark:text-slate-500">
												<svg className="w-12 h-12 opacity-50" fill="currentColor" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 512"><path d="M308.5 135.3c7.1-6.3 9.9-16.2 6.2-25c-2.3-5.3-4.8-10.5-7.6-15.5L304 89.4c-3-5-6.3-9.9-9.8-14.6c-5.7-7.6-15.7-10.1-24.7-7.1l-28.2 9.3c-10.7-8.8-23-16-36.2-20.9L199 27.1c-1.9-9.3-9.1-16.7-18.5-17.8C173.9 8.4 167.2 8 160.4 8h-.7c-6.8 0-13.5 .4-20.1 1.2c-9.4 1.1-16.6 8.6-18.5 17.8L115 56.1c-13.3 5-25.5 12.1-36.2 20.9L50.5 67.8c-9-3-19-.5-24.7 7.1c-3.5 4.7-6.8 9.6-9.9 14.6l-3 5.3c-2.8 5-5.3 10.2-7.6 15.6c-3.7 8.7-.9 18.6 6.2 25l22.2 19.8C32.6 161.9 32 168.9 32 176s.6 14.1 1.7 20.9L11.5 216.7c-7.1 6.3-9.9 16.2-6.2 25c2.3 5.3 4.8 10.5 7.6 15.6l3 5.2c3 5.1 6.3 9.9 9.9 14.6c5.7 7.6 15.7 10.1 24.7 7.1l28.2-9.3c10.7 8.8 23 16 36.2 20.9l6.1 29.1c1.9 9.3 9.1 16.7 18.5 17.8c6.7 .8 13.5 1.2 20.4 1.2s13.7-.4 20.4-1.2c9.4-1.1 16.6-8.6 18.5-17.8l6.1-29.1c13.3-5 25.5-12.1 36.2-20.9l28.2 9.3c9 3 19 .5 24.7-7.1c3.5-4.7 6.8-9.5 9.8-14.6l3.1-5.4c2.8-5 5.3-10.2 7.6-15.5c3.7-8.7 .9-18.6-6.2-25l-22.2-19.8c1.1-6.8 1.7-13.8 1.7-20.9s-.6-14.1-1.7-20.9l22.2-19.8zM112 176a48 48 0 1 1 96 0 48 48 0 1 1 -96 0zM504.7 500.5c6.3 7.1 16.2 9.9 25 6.2c5.3-2.3 10.5-4.8 15.5-7.6l5.4-3.1c5-3 9.9-6.3 14.6-9.8c7.6-5.7 10.1-15.7 7.1-24.7l-9.3-28.2c8.8-10.7 16-23 20.9-36.2l29.1-6.1c9.3-1.9 16.7-9.1 17.8-18.5c.8-6.7 1.2-13.5 1.2-20.4s-.4-13.7-1.2-20.4c-1.1-9.4-8.6-16.6-17.8-18.5L583.9 307c-5-13.3-12.1-25.5-20.9-36.2l9.3-28.2c3-9 .5-19-7.1-24.7c-4.7-3.5-9.6-6.8-14.6-9.9l-5.3-3c-5-2.8-10.2-5.3-15.6-7.6c-8.7-3.7-18.6-.9-25 6.2l-19.8 22.2c-6.8-1.1-13.8-1.7-20.9-1.7s-14.1 .6-20.9 1.7l-19.8-22.2c-6.3-7.1-16.2-9.9-25-6.2c-5.3 2.3-10.5 4.8-15.6 7.6l-5.2 3c-5.1 3-9.9 6.3-14.6 9.9c-7.6 5.7-10.1 15.7-7.1 24.7l9.3 28.2c-8.8 10.7-16 23-20.9 36.2L315.1 313c-9.3 1.9-16.7 9.1-17.8 18.5c-.8 6.7-1.2 13.5-1.2 20.4s.4 13.7 1.2 20.4c1.1 9.4 8.6 16.6 17.8 18.5l29.1 6.1c5 13.3 12.1 25.5 20.9 36.2l-9.3 28.2c-3 9-.5 19 7.1 24.7c4.7 3.5 9.5 6.8 14.6 9.8l5.4 3.1c5 2.8 10.2 5.3 15.5 7.6c8.7 3.7 18.6 .9 25-6.2l19.8-22.2c6.8 1.1 13.8 1.7 20.9 1.7s14.1-.6 20.9-1.7l19.8 22.2zM464 304a48 48 0 1 1 0 96 48 48 0 1 1 0-96z" /></svg>
												<p className="text-sm font-medium">No events yet</p>
												<p className="text-xs">Raw WebSocket events will appear here</p>
											</div>
										</td>
									</tr>}

								{(events).slice(0, MAX_TABLE_ROWS).map((event, i) => (
									<tr
										key={i + '-' + event.now}
										className={
											"border-b dark:border-slate-700 transition-all duration-150 hover:shadow-sm " +
											((event.eventType === "close" || event.eventType === "error")
												? "bg-gradient-to-r from-yellow-50 to-orange-50 dark:from-yellow-950/30 dark:to-orange-950/30 hover:from-yellow-100 hover:to-orange-100 dark:hover:from-yellow-950/50 dark:hover:to-orange-950/50"
												: (event.eventType === "in")
													? "bg-gradient-to-r from-red-50 to-pink-50 dark:from-red-950/30 dark:to-pink-950/30 hover:from-red-100 hover:to-pink-100 dark:hover:from-red-950/50 dark:hover:to-pink-950/50"
													: "bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30 hover:from-green-100 hover:to-emerald-100 dark:hover:from-green-950/50 dark:hover:to-emerald-950/50"
											)
										}>
										<td className="p-2 sm:p-3">
											{(event.eventType === "close" || event.eventType === "error")
												? <div className="inline-flex items-center justify-center w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-yellow-200 dark:bg-yellow-900/50">
														<span className="text-yellow-700 dark:text-yellow-300 text-base font-bold">⚠</span>
													</div>
												: (event.eventType === "in")
													? <div className="inline-flex items-center justify-center w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-red-200 dark:bg-red-900/50">
															<span className="text-red-700 dark:text-red-300 text-base font-bold">↓</span>
														</div>
													: <div className="inline-flex items-center justify-center w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-green-200 dark:bg-green-900/50">
															<span className="text-green-700 dark:text-green-300 text-base font-bold">↑</span>
														</div>}
										</td>

										<td className="p-2 sm:p-3 border-r text-left dark:border-slate-700">
											<code className="inline-block bg-white dark:bg-slate-800 px-2 py-1 rounded-md shadow-sm border border-gray-200 dark:border-slate-600 text-purple-600 dark:text-purple-400 font-mono text-[10px] sm:text-xs font-semibold">"{event.type}"</code>
										</td>

										<td className="p-2 sm:p-3 border-r text-left dark:border-slate-700">
											<div className="truncate max-w-[200px] sm:max-w-[250px] md:max-w-[350px] overflow-hidden text-ellipsis">
												{(Array.isArray(event.message))
													? <code className="italic text-gray-600 dark:text-slate-400 font-mono text-[10px] sm:text-xs">({event.message.length} bytes) {JSON.stringify(event.message)}</code>
													: typeof (event.message) === "string"
														? <code className="text-gray-700 dark:text-slate-300 font-mono text-[10px] sm:text-xs">{event.message}</code>
														: <code className="italic text-gray-600 dark:text-slate-400 font-mono text-[10px] sm:text-xs">{JSON.stringify(event.message)}</code>
												}
											</div>
										</td>

										<td className="p-2 sm:p-3 text-[10px] sm:text-xs whitespace-nowrap text-gray-600 dark:text-slate-400 font-medium">
											<Timestamp date={event.now} />
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>}


			</div>

		</>);
}