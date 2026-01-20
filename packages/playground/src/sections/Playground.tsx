import { useEffect, useState } from "react";
import { type RoomAvailable } from "@colyseus/sdk";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconProp } from "@fortawesome/fontawesome-svg-core";
import { faGlobe, faChartLine, faDoorOpen, faChevronLeft, faChevronRight, faBolt } from "@fortawesome/free-solid-svg-icons";

import { endpoint, Connection, global } from "../utils/Types";
import { RealtimeRooms, ServerState } from "./RealtimeRooms";
import { APIEndpoints } from "./APIEndpoints";
import { RealtimeStats } from "./RealtimeStats";
import { PresenceInspector } from "./PresenceInspector";

import { type AuthConfig } from "../../src-backend";

 type TabType = "rooms" | "api" | "presence" | "stats";

interface PlaygroundProps {
	isMobileMenuOpen: boolean;
	setIsMobileMenuOpen: (isOpen: boolean) => void;
}

export function Playground({ isMobileMenuOpen, setIsMobileMenuOpen }: PlaygroundProps) {
	const [activeTab, setActiveTab] = useState<TabType>("rooms");
	const [serverState, setServerState] = useState(ServerState.CONNECTING);

	// Desktop sidebar collapse state with localStorage persistence
	const [isDesktopSidebarCollapsed, setIsDesktopSidebarCollapsed] = useState(() => {
		const saved = localStorage.getItem('desktopSidebarCollapsed');
		return saved ? JSON.parse(saved) : false;
	});

	// Save sidebar collapse state to localStorage
	useEffect(() => {
		localStorage.setItem('desktopSidebarCollapsed', JSON.stringify(isDesktopSidebarCollapsed));
	}, [isDesktopSidebarCollapsed]);

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

	 const categories: { label: string; items: { id: TabType; label: string; icon: IconProp }[] }[] = [
 		{
 			label: "Frontend",
 			items: [
 				{ id: "rooms", label: "Rooms", icon: faDoorOpen },
 				{ id: "api", label: "API Endpoints", icon: faGlobe },
 			],
 		},

    // // TODO: add backend tabs back in when presence/stats are working
 		// {
 		// 	label: "Backend",
 		// 	items: [
 		// 		{ id: "presence", label: "Presence", icon: faBolt },
 		// 		{ id: "stats", label: "Stats", icon: faChartLine },
 		// 	],
 		// },
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
				${isDesktopSidebarCollapsed ? 'md:w-16' : 'w-64'}
				bg-white dark:bg-slate-900
				border-r border-gray-200 dark:border-slate-700
				flex flex-col
				h-full
				transition-all duration-300 ease-in-out
			`}>
				<div className="flex-1 py-6">
					<nav className="space-y-3 px-3">
						{categories.map((category) => (
							<div key={category.label}>
								{!isDesktopSidebarCollapsed ? (
									<div className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
										{category.label}
									</div>
								) : (
									<div className="h-px my-2 bg-gray-200 dark:bg-slate-700" />
								)}
								<div className="space-y-1">
									{category.items.map((tab) => (
										<button
											key={tab.id}
											onClick={() => handleTabChange(tab.id)}
											title={isDesktopSidebarCollapsed ? tab.label : undefined}
											className={`w-full flex items-center ${isDesktopSidebarCollapsed ? 'justify-center px-2' : 'px-4'} py-3 text-sm font-medium rounded-lg transition-all ${
												activeTab === tab.id
													? "bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300"
													: "text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800"
											}`}
										>
											<FontAwesomeIcon icon={tab.icon} className={isDesktopSidebarCollapsed ? '' : 'mr-3'} size="lg" />
											{!isDesktopSidebarCollapsed && <span>{tab.label}</span>}
										</button>
									))}
								</div>
							</div>
						))}
					</nav>
				</div>

				{/* Desktop Collapse Toggle Button */}
				<div className="hidden md:block border-t border-gray-200 dark:border-slate-700 p-3">
					<button
						onClick={() => setIsDesktopSidebarCollapsed(!isDesktopSidebarCollapsed)}
						className="w-full flex items-center justify-center px-2 py-2 text-sm font-medium rounded-lg transition-colors text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800"
						title={isDesktopSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
					>
						<FontAwesomeIcon icon={isDesktopSidebarCollapsed ? faChevronRight : faChevronLeft} size="lg" />
					</button>
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
				{activeTab === "api" && <APIEndpoints authConfig={authConfig} />}
				{activeTab === "presence" && <PresenceInspector />}
				{activeTab === "stats" && <RealtimeStats />}
			</div>
		</div>
	);
}
