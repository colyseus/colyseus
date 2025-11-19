import { useState, useEffect } from "react";
import { endpoint } from "../utils/Types";

interface RoomStats {
	roomName: string;
	clients: number;
	locked: boolean;
	maxClients: number;
}

interface Stats {
	rooms: string[];
	roomsByType: { [key: string]: number };
	roomsById: { [key: string]: RoomStats };
}

export function RealtimeStats() {
	const [stats, setStats] = useState<Stats | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [isLive, setIsLive] = useState(true);

	const fetchStats = async () => {
		try {
			const res = await fetch(`${endpoint}/rooms`);
			if (!res.ok) {
				throw new Error(`HTTP ${res.status}: ${res.statusText}`);
			}
			const data = await res.json();
			setStats(data);
			setError(null);
		} catch (e: any) {
			setError(e.message || "Failed to fetch stats");
		}
	};

	useEffect(() => {
		fetchStats();

		let interval: number | undefined;
		if (isLive) {
			interval = window.setInterval(fetchStats, 1000);
		}

		return () => {
			if (interval) {
				window.clearInterval(interval);
			}
		};
	}, [isLive]);

	const totalRooms = stats ? Object.keys(stats.roomsById).length : 0;
	const totalClients = stats
		? Object.values(stats.roomsById).reduce((sum, room) => sum + room.clients, 0)
		: 0;

	return (
		<div className="h-full overflow-y-auto">
			<div className="p-8">
				{/* Header with controls */}
				<div className="flex justify-between items-center mb-6">
					<h2 className="text-2xl font-semibold dark:text-slate-300">Realtime Statistics</h2>
					<div className="flex items-center gap-4">
						<label className="flex items-center gap-2 cursor-pointer">
							<input
								type="checkbox"
								checked={isLive}
								onChange={(e) => setIsLive(e.target.checked)}
								className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500"
							/>
							<span className="text-sm dark:text-slate-300">Live updates</span>
						</label>
						<button
							onClick={fetchStats}
							className="px-4 py-2 text-sm bg-purple-600 text-white rounded hover:bg-purple-700 transition-colors"
						>
							Refresh
						</button>
					</div>
				</div>

				{error && (
					<div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-4 mb-6">
						<p className="text-red-700 dark:text-red-400 font-semibold">Error</p>
						<p className="text-red-600 dark:text-red-300 text-sm mt-1">{error}</p>
					</div>
				)}

				{stats && (
					<>
						{/* Summary cards */}
						<div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
							<div className="bg-white dark:bg-slate-700 shadow rounded p-6">
								<div className="flex items-center justify-between">
									<div>
										<p className="text-sm text-gray-600 dark:text-slate-400">Total Rooms</p>
										<p className="text-3xl font-bold dark:text-slate-300 mt-1">{totalRooms}</p>
									</div>
									<div className="w-12 h-12 bg-purple-100 dark:bg-purple-900 rounded-full flex items-center justify-center">
										<svg
											className="w-6 h-6 text-purple-600 dark:text-purple-400"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path
												strokeLinecap="round"
												strokeLinejoin="round"
												strokeWidth={2}
												d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
											/>
										</svg>
									</div>
								</div>
							</div>

							<div className="bg-white dark:bg-slate-700 shadow rounded p-6">
								<div className="flex items-center justify-between">
									<div>
										<p className="text-sm text-gray-600 dark:text-slate-400">Total Clients</p>
										<p className="text-3xl font-bold dark:text-slate-300 mt-1">{totalClients}</p>
									</div>
									<div className="w-12 h-12 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center">
										<svg
											className="w-6 h-6 text-green-600 dark:text-green-400"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path
												strokeLinecap="round"
												strokeLinejoin="round"
												strokeWidth={2}
												d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
											/>
										</svg>
									</div>
								</div>
							</div>

							<div className="bg-white dark:bg-slate-700 shadow rounded p-6">
								<div className="flex items-center justify-between">
									<div>
										<p className="text-sm text-gray-600 dark:text-slate-400">Room Types</p>
										<p className="text-3xl font-bold dark:text-slate-300 mt-1">{stats.rooms.length}</p>
									</div>
									<div className="w-12 h-12 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
										<svg
											className="w-6 h-6 text-blue-600 dark:text-blue-400"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path
												strokeLinecap="round"
												strokeLinejoin="round"
												strokeWidth={2}
												d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
											/>
										</svg>
									</div>
								</div>
							</div>
						</div>

						{/* Rooms by type */}
						<div className="bg-white dark:bg-slate-700 shadow rounded p-6 mb-6">
							<h3 className="text-lg font-semibold mb-4 dark:text-slate-300">Rooms by Type</h3>
							{Object.keys(stats.roomsByType).length === 0 ? (
								<p className="text-gray-600 dark:text-slate-400 text-sm italic">No rooms available</p>
							) : (
								<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
									{Object.entries(stats.roomsByType).map(([roomType, count]) => (
										<div
											key={roomType}
											className="bg-gray-50 dark:bg-slate-800 rounded p-4 flex justify-between items-center"
										>
											<span className="font-medium dark:text-slate-300">{roomType}</span>
											<span className="text-2xl font-bold text-purple-600 dark:text-purple-400">
												{count}
											</span>
										</div>
									))}
								</div>
							)}
						</div>

						{/* Active rooms table */}
						<div className="bg-white dark:bg-slate-700 shadow rounded p-6">
							<h3 className="text-lg font-semibold mb-4 dark:text-slate-300">Active Rooms</h3>
							{totalRooms === 0 ? (
								<p className="text-gray-600 dark:text-slate-400 text-sm italic">No active rooms</p>
							) : (
								<div className="overflow-x-auto">
									<table className="min-w-full divide-y divide-gray-200 dark:divide-slate-600">
										<thead>
											<tr className="bg-gray-50 dark:bg-slate-800">
												<th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
													Room ID
												</th>
												<th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
													Room Name
												</th>
												<th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
													Clients
												</th>
												<th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
													Status
												</th>
											</tr>
										</thead>
										<tbody className="bg-white dark:bg-slate-700 divide-y divide-gray-200 dark:divide-slate-600">
											{Object.entries(stats.roomsById).map(([roomId, room]) => (
												<tr key={roomId} className="hover:bg-gray-50 dark:hover:bg-slate-750">
													<td className="px-4 py-3 text-sm font-mono text-gray-900 dark:text-slate-300">
														{roomId}
													</td>
													<td className="px-4 py-3 text-sm text-gray-700 dark:text-slate-300">
														{room.roomName}
													</td>
													<td className="px-4 py-3 text-sm text-gray-700 dark:text-slate-300">
														{room.clients} / {room.maxClients}
													</td>
													<td className="px-4 py-3 text-sm">
														<span
															className={`inline-block px-2 py-1 text-xs font-semibold rounded ${
																room.locked
																	? "bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200"
																	: "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200"
															}`}
														>
															{room.locked ? "Locked" : "Open"}
														</span>
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							)}
						</div>
					</>
				)}
			</div>
		</div>
	);
}

