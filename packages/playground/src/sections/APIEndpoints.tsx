import { useState, useEffect } from "react";
import { endpoint } from "../utils/Types";
import { ResizableSidebar } from "../components/ResizableSidebar";

interface APIEndpoint {
	method: string;
	path: string;
	description: string;
}

const defaultEndpoints: APIEndpoint[] = [
	{ method: "GET", path: "/rooms", description: "Get available rooms and statistics" },
	{ method: "GET", path: "/matchmake/:roomName", description: "Get matchmaking information for a room type" },
];

export function APIEndpoints() {
	const [endpoints, setEndpoints] = useState<APIEndpoint[]>(defaultEndpoints);
	const [selectedEndpoint, setSelectedEndpoint] = useState<APIEndpoint | null>(null);
	const [response, setResponse] = useState<any>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [customPath, setCustomPath] = useState("");

	const executeRequest = async (endpointPath: string) => {
		setLoading(true);
		setError(null);
		setResponse(null);

		try {
			const url = `${endpoint}${endpointPath}`;
			const res = await fetch(url);
			
			if (!res.ok) {
				throw new Error(`HTTP ${res.status}: ${res.statusText}`);
			}

			const data = await res.json();
			setResponse(data);
		} catch (e: any) {
			setError(e.message || "Failed to fetch");
		} finally {
			setLoading(false);
		}
	};

	const handleEndpointClick = (endpoint: APIEndpoint) => {
		setSelectedEndpoint(endpoint);
		executeRequest(endpoint.path);
	};

	const handleCustomRequest = () => {
		if (customPath) {
			const path = customPath.startsWith("/") ? customPath : `/${customPath}`;
			setSelectedEndpoint({ method: "GET", path, description: "Custom request" });
			executeRequest(path);
		}
	};

	return (
		<div className="h-full flex flex-col md:flex-row">
			<ResizableSidebar 
				className="bg-white dark:bg-slate-700 border-r border-gray-200 dark:border-slate-600 overflow-y-auto md:h-full"
				storageKey="playground-api-endpoints-sidebar-width"
				defaultWidth={320}
				minWidth={280}
				maxWidth={500}
			>
				<div className="p-4 md:p-6">
					<h2 className="text-lg md:text-xl font-semibold mb-4 dark:text-slate-300">Available Endpoints</h2>
					
					<div className="space-y-2 mb-6">
						{endpoints.map((endpoint, idx) => (
							<button
								key={idx}
								onClick={() => handleEndpointClick(endpoint)}
								className={`w-full text-left p-2 sm:p-3 rounded border transition-colors ${
									selectedEndpoint?.path === endpoint.path
										? "bg-purple-100 dark:bg-purple-900 border-purple-500"
										: "bg-gray-50 dark:bg-slate-800 border-gray-200 dark:border-slate-600 hover:bg-gray-100 dark:hover:bg-slate-750"
								}`}
							>
								<div className="flex items-center gap-2 mb-1 flex-wrap">
									<span className="inline-block px-2 py-0.5 text-xs font-semibold bg-green-500 text-white rounded flex-shrink-0">
										{endpoint.method}
									</span>
									<code className="text-xs sm:text-sm dark:text-slate-300 break-all">{endpoint.path}</code>
								</div>
								<p className="text-xs text-gray-600 dark:text-slate-400">{endpoint.description}</p>
							</button>
						))}
					</div>

					<div className="border-t border-gray-200 dark:border-slate-600 pt-4">
						<h3 className="text-sm font-semibold mb-2 dark:text-slate-300">Custom Request</h3>
						<div className="flex flex-col sm:flex-row gap-2">
							<input
								type="text"
								placeholder="/your/path"
								value={customPath}
								onChange={(e) => setCustomPath(e.target.value)}
								onKeyDown={(e) => e.key === "Enter" && handleCustomRequest()}
								className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded dark:bg-slate-800 dark:text-slate-300"
							/>
							<button
								onClick={handleCustomRequest}
								className="px-4 py-2 text-sm bg-purple-600 text-white rounded hover:bg-purple-700 whitespace-nowrap"
							>
								GET
							</button>
						</div>
					</div>
				</div>
			</ResizableSidebar>

			{/* Main content area */}
			<div className="flex-1 overflow-y-auto min-h-0">
				<div className="p-4 md:p-8">
					{!selectedEndpoint && (
						<div className="text-center text-gray-500 dark:text-slate-400 mt-10 md:mt-20">
							<p className="text-base md:text-lg">Select an endpoint to see the response</p>
						</div>
					)}

					{selectedEndpoint && (
						<>
							<div className="mb-4 md:mb-6">
								<h2 className="text-lg md:text-2xl font-semibold dark:text-slate-300 mb-2">
									{selectedEndpoint.method} {selectedEndpoint.path}
								</h2>
								<p className="text-sm md:text-base text-gray-600 dark:text-slate-400">{selectedEndpoint.description}</p>
								<div className="mt-2">
									<code className="text-xs md:text-sm bg-gray-100 dark:bg-slate-800 px-2 md:px-3 py-1 rounded dark:text-slate-300 break-all block">
										{endpoint}
										{selectedEndpoint.path}
									</code>
								</div>
							</div>

							<div className="bg-white dark:bg-slate-700 shadow rounded p-4 md:p-6">
								<h3 className="text-base md:text-lg font-semibold mb-3 dark:text-slate-300">Response</h3>

								{loading && (
									<div className="flex items-center gap-2 text-gray-600 dark:text-slate-400 text-sm">
										<div className="animate-spin h-4 w-4 border-2 border-purple-600 border-t-transparent rounded-full"></div>
										<span>Loading...</span>
									</div>
								)}

								{error && (
									<div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-3 md:p-4">
										<p className="text-red-700 dark:text-red-400 font-semibold text-sm">Error</p>
										<p className="text-red-600 dark:text-red-300 text-xs md:text-sm mt-1">{error}</p>
									</div>
								)}

								{response && (
									<div className="bg-gray-50 dark:bg-slate-800 rounded p-3 md:p-4 overflow-x-auto">
										<pre className="text-xs md:text-sm dark:text-slate-300">
											{JSON.stringify(response, null, 2)}
										</pre>
									</div>
								)}
							</div>
						</>
					)}
				</div>
			</div>
		</div>
	);
}

