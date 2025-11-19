import { useEffect, useState } from "react";
import { type RoomAvailable } from "@colyseus/sdk";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlug, faGlobe, faChartLine } from "@fortawesome/free-solid-svg-icons";

import { endpoint, Connection, global } from "../utils/Types";
import { RealtimeRooms, ServerState } from "./RealtimeRooms";
import { APIEndpoints } from "./APIEndpoints";
import { RealtimeStats } from "./RealtimeStats";

import { type AuthConfig } from "../../src-backend";

type TabType = "rooms" | "api" | "stats";

interface PlaygroundProps {
	isMobileMenuOpen: boolean;
	setIsMobileMenuOpen: (isOpen: boolean) => void;
}

export function Playground({ isMobileMenuOpen, setIsMobileMenuOpen }: PlaygroundProps) {
	const [activeTab, setActiveTab] = useState<TabType>("rooms");
	const [serverState, setServerState] = useState(ServerState.CONNECTING);

	// remote stats
	const [roomNames, setRoomNames] = useState([]);
	const [roomsById, setRoomsById] = useState({} as { [key: string]: RoomAvailable & { locked: boolean } });
	const [roomsByType, setRoomsByType] = useState({} as { [key: string]: number });
	const [authConfig, setAuthConfig] = useState({} as AuthConfig);

	const onConnectionSuccessful = (connection: Connection) => {
		if (global.connections.indexOf(connection) === -1) {
			global.connections = [connection, ...global.connections];
		} else {
			connection.isConnected = true;
		}
		// fetch room count immediately after joining
		fetchRoomStats();
	};

	const onDisconnection = function (sessionId: string) {
		const connection = global.connections.find((connection) => connection.sessionId === sessionId);
		if (connection) {
			connection.isConnected = false;
			fetchRoomStats();
		}
	};

	// get room name / room count
	const fetchRoomStats = () => {
		fetch(`${endpoint}/rooms`)
			.then((response) => response.json())
			.then((stats) => {
				setServerState(ServerState.CONNECTED);
				setRoomNames(stats.rooms);
				setRoomsByType(stats.roomsByType);
				setRoomsById(stats.roomsById);
				setAuthConfig(stats.auth);
			})
			.catch((e) => {
				setServerState(ServerState.OFFLINE);
				console.error(e);
			});
	};

	// fetch available room types on mount
	useEffect(() => {
		fetchRoomStats();

		const retryWhenOfflineInterval = window.setInterval(() => {
			if (serverState === ServerState.OFFLINE) {
				fetchRoomStats();
			}
		}, 1000);

		return () => window.clearInterval(retryWhenOfflineInterval);
	}, []);

	const tabs = [
		{ id: "rooms" as TabType, label: "Rooms", icon: faPlug },
		{ id: "api" as TabType, label: "API Endpoints", icon: faGlobe },
		{ id: "stats" as TabType, label: "Realtime Stats", icon: faChartLine },
	];

	const handleTabChange = (tabId: TabType) => {
		setActiveTab(tabId);
		setIsMobileMenuOpen(false);
	};

	return (
		<div className="h-full flex flex-col md:flex-row">
			{/* Mobile Overlay */}
			{isMobileMenuOpen && (
				<div
					className="md:hidden fixed inset-0 bg-black bg-opacity-50 z-30"
					onClick={() => setIsMobileMenuOpen(false)}
				/>
			)}

			{/* Left Sidebar Navigation */}
			<div className={`
				${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
				md:translate-x-0
				fixed md:relative
				z-40
				w-64
				bg-white dark:bg-slate-900
				border-r border-gray-200 dark:border-slate-700
				flex flex-col
				h-full
				transition-transform duration-300 ease-in-out
			`}>
				<div className="flex-1 py-6">
					<nav className="space-y-1 px-3">
						{tabs.map((tab) => {
							return (
								<button
									key={tab.id}
									onClick={() => handleTabChange(tab.id)}
									className={`w-full flex items-center px-4 py-3 text-sm font-medium rounded-lg transition-colors ${
										activeTab === tab.id
											? "bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300"
											: "text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800"
									}`}
								>
									<FontAwesomeIcon icon={tab.icon} className="mr-3" size="lg" />
									<span>{tab.label}</span>
								</button>
							);
						})}
					</nav>
				</div>
			</div>

			{/* Main Content Area */}
			<div className="flex-1 overflow-hidden">
				{activeTab === "rooms" && (
					<RealtimeRooms
						serverState={serverState}
						roomNames={roomNames}
						roomsById={roomsById}
						roomsByType={roomsByType}
						authConfig={authConfig}
						onConnectionSuccessful={onConnectionSuccessful}
						onDisconnection={onDisconnection}
						fetchRoomStats={fetchRoomStats}
					/>
				)}
				{activeTab === "api" && <APIEndpoints />}
				{activeTab === "stats" && <RealtimeStats />}
			</div>
		</div>
	);
}
