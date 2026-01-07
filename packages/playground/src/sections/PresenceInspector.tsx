import { useState, useEffect } from "react";
import { endpoint } from "../utils/Types";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSync, faKey, faDatabase, faHashtag, faList, faBroadcastTower } from "@fortawesome/free-solid-svg-icons";
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus, vs } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useSettings } from "../contexts/SettingsContext";

interface PresenceData {
	keys: { [key: string]: string | number };
	data: { [key: string]: string[] };
	hash: { [key: string]: { [field: string]: string } };
	channels: string[];
}

export function PresenceInspector() {
	const { darkMode } = useSettings();
	const [presenceData, setPresenceData] = useState<PresenceData | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [isLive, setIsLive] = useState(true);
	const [activeSection, setActiveSection] = useState<"keys" | "data" | "hash" | "channels">("keys");
	const [searchQuery, setSearchQuery] = useState("");

	const fetchPresenceData = async () => {
		try {
			const res = await fetch(`${endpoint}/presence`);
			if (!res.ok) {
				throw new Error(`HTTP ${res.status}: ${res.statusText}`);
			}
			const data = await res.json();
			setPresenceData(data);
			setError(null);
		} catch (e: any) {
			setError(e.message || "Failed to fetch presence data");
		}
	};

	useEffect(() => {
		fetchPresenceData();

		let interval: number | undefined;
		if (isLive) {
			interval = window.setInterval(fetchPresenceData, 1000);
		}

		return () => {
			if (interval) {
				window.clearInterval(interval);
			}
		};
	}, [isLive]);

	const filterBySearch = (key: string) => {
		if (!searchQuery) return true;
		return key.toLowerCase().includes(searchQuery.toLowerCase());
	};

	const sections = [
		{ id: "keys" as const, label: "Keys", icon: faKey, count: presenceData ? Object.keys(presenceData.keys).length : 0 },
		{ id: "data" as const, label: "Sets", icon: faDatabase, count: presenceData ? Object.keys(presenceData.data).length : 0 },
		{ id: "hash" as const, label: "Hashes", icon: faHashtag, count: presenceData ? Object.keys(presenceData.hash).length : 0 },
		{ id: "channels" as const, label: "Channels", icon: faBroadcastTower, count: presenceData?.channels?.length || 0 },
	];

	const renderValue = (value: any) => {
		if (typeof value === "object") {
			return (
				<SyntaxHighlighter
					language="json"
					style={darkMode ? vscDarkPlus : vs}
					customStyle={{
						margin: 0,
						padding: "0.5rem",
						fontSize: "0.75rem",
						borderRadius: "0.25rem",
					}}
				>
					{JSON.stringify(value, null, 2)}
				</SyntaxHighlighter>
			);
		}
		return <span className="font-mono text-sm">{String(value)}</span>;
	};

	const renderKeyValueTable = (data: { [key: string]: any }, valueRenderer?: (value: any) => React.ReactNode) => {
		const filteredKeys = Object.keys(data).filter(filterBySearch);

		if (filteredKeys.length === 0) {
			return (
				<div className="text-center py-8 text-gray-500 dark:text-slate-400">
					{searchQuery ? "No matching keys found" : "No data available"}
				</div>
			);
		}

		return (
			<div className="overflow-x-auto">
				<table className="w-full text-sm">
					<thead>
						<tr className="border-b border-gray-200 dark:border-slate-600">
							<th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-slate-300 w-1/3">Key</th>
							<th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-slate-300">Value</th>
						</tr>
					</thead>
					<tbody>
						{filteredKeys.map((key) => (
							<tr key={key} className="border-b border-gray-100 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700/50">
								<td className="py-2 px-3 font-mono text-xs text-purple-600 dark:text-purple-400 break-all">{key}</td>
								<td className="py-2 px-3 text-gray-800 dark:text-slate-200">
									{valueRenderer ? valueRenderer(data[key]) : renderValue(data[key])}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		);
	};

	const renderChannelsList = (channels: string[]) => {
		const filteredChannels = channels.filter(filterBySearch);

		if (filteredChannels.length === 0) {
			return (
				<div className="text-center py-8 text-gray-500 dark:text-slate-400">
					{searchQuery ? "No matching channels found" : "No active channels"}
				</div>
			);
		}

		return (
			<div className="space-y-2">
				{filteredChannels.map((channel) => (
					<div
						key={channel}
						className="px-3 py-2 bg-gray-50 dark:bg-slate-700 rounded font-mono text-sm text-gray-800 dark:text-slate-200 break-all"
					>
						<FontAwesomeIcon icon={faBroadcastTower} className="mr-2 text-green-500" />
						{channel}
					</div>
				))}
			</div>
		);
	};

	return (
		<div className="h-full overflow-y-auto">
			<div className="p-4 md:p-8">
				{/* Header with controls */}
				<div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 md:gap-4 mb-4 md:mb-6">
					<h2 className="text-lg md:text-2xl font-semibold dark:text-slate-300">Presence Inspector</h2>
					<div className="flex items-center gap-3 md:gap-4">
						<label className="flex items-center gap-2 cursor-pointer">
							<input
								type="checkbox"
								checked={isLive}
								onChange={(e) => setIsLive(e.target.checked)}
								className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500"
							/>
							<span className="text-xs md:text-sm dark:text-slate-300 whitespace-nowrap">Live updates</span>
						</label>
						<button
							onClick={fetchPresenceData}
							className="px-3 md:px-4 py-1.5 md:py-2 text-xs md:text-sm bg-purple-600 text-white rounded hover:bg-purple-700 transition-colors flex items-center gap-2"
						>
							<FontAwesomeIcon icon={faSync} />
							Refresh
						</button>
					</div>
				</div>

				{error && (
					<div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-3 md:p-4 mb-4 md:mb-6">
						<p className="text-red-700 dark:text-red-400 font-semibold text-sm">Error</p>
						<p className="text-red-600 dark:text-red-300 text-xs md:text-sm mt-1">{error}</p>
					</div>
				)}

				{/* Section tabs */}
				<div className="flex flex-wrap gap-2 mb-4">
					{sections.map((section) => (
						<button
							key={section.id}
							onClick={() => setActiveSection(section.id)}
							className={`px-3 py-2 text-sm rounded-lg flex items-center gap-2 transition-colors ${
								activeSection === section.id
									? "bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300"
									: "bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-600"
							}`}
						>
							<FontAwesomeIcon icon={section.icon} />
							{section.label}
							<span className="ml-1 px-1.5 py-0.5 text-xs rounded-full bg-gray-200 dark:bg-slate-600">
								{section.count}
							</span>
						</button>
					))}
				</div>

				{/* Search input */}
				<div className="mb-4">
					<input
						type="text"
						placeholder="Search keys..."
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						className="w-full md:w-64 px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-purple-500"
					/>
				</div>

				{/* Content */}
				<div className="bg-white dark:bg-slate-800 rounded-lg shadow border border-gray-200 dark:border-slate-700 p-4">
					{presenceData ? (
						<>
							{activeSection === "keys" && renderKeyValueTable(presenceData.keys)}
							{activeSection === "data" && renderKeyValueTable(presenceData.data, (value: string[]) => (
								<div className="flex flex-wrap gap-1">
									{value.map((item, idx) => (
										<span
											key={idx}
											className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded text-xs font-mono"
										>
											{item}
										</span>
									))}
								</div>
							))}
							{activeSection === "hash" && renderKeyValueTable(presenceData.hash)}
							{activeSection === "channels" && renderChannelsList(presenceData.channels || [])}
						</>
					) : !error ? (
						<div className="text-center py-8 text-gray-500 dark:text-slate-400">
							Loading...
						</div>
					) : null}
				</div>

				{/* Info callout */}
				<div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
					<p className="text-sm text-blue-700 dark:text-blue-300">
						<strong>Note:</strong> This inspector shows the current state of the Presence storage.
						{" "}The data structure varies based on whether you're using LocalPresence or RedisPresence.
					</p>
				</div>
			</div>
		</div>
	);
}
