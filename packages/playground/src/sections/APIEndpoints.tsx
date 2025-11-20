import { useState, useEffect } from "react";
import { endpoint, client } from "../utils/Types";
import { ResizableSidebar } from "../components/ResizableSidebar";
import { SDKCodeExamples } from "../components/SDKCodeExamples";
import { faPlay } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

interface APIEndpoint {
	method: string;
	path: string;
	description: string;
}

const getMethodColor = (method: string): string => {
	switch (method.toUpperCase()) {
		case 'GET':
			return 'bg-green-500';
		case 'POST':
			return 'bg-blue-500';
		case 'PUT':
			return 'bg-orange-500';
		case 'PATCH':
			return 'bg-purple-500';
		case 'DELETE':
			return 'bg-red-500';
		case 'OPTIONS':
			return 'bg-gray-500';
		case 'HEAD':
			return 'bg-slate-500';
		default:
			return 'bg-gray-500';
	}
};

export function APIEndpoints() {
	const [endpoints, setEndpoints] = useState<APIEndpoint[]>([]);
	const [selectedEndpoint, setSelectedEndpoint] = useState<APIEndpoint | null>(null);
	const [response, setResponse] = useState<any>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [customPath, setCustomPath] = useState("");

	// Form state
	const [queryParams, setQueryParams] = useState("");
	const [headers, setHeaders] = useState("");
	const [requestBody, setRequestBody] = useState("");
	const [uriParams, setUriParams] = useState<Record<string, string>>({});

	// Fetch endpoints from OpenAPI specification
	useEffect(() => {
		const fetchEndpoints = async () => {
			try {
				const res = await fetch(`${endpoint}/openapi`);
				if (res.ok) {
					const openapi = await res.json();
					const parsedEndpoints: APIEndpoint[] = [];

					// Parse OpenAPI paths
					if (openapi.paths) {
						for (const [path, methods] of Object.entries(openapi.paths)) {
							for (const [method, details] of Object.entries(methods as any)) {
                console.log(method, details);
								if (typeof details === 'object' && details !== null) {
									parsedEndpoints.push({
										method: method.toUpperCase(),
										path,
										description: (details as any).summary || (details as any).description || `${method.toUpperCase()} ${path}`,
									});
								}
							}
						}
					}

					// Combine with default endpoints
					setEndpoints(parsedEndpoints);
				}
			} catch (e) {
				// Silently fail and keep default endpoints
				console.error('Failed to fetch OpenAPI spec:', e);
			}
		};

		fetchEndpoints();
	}, []);

	// Extract URI parameters from path (e.g., /users/:id => ['id'])
	const extractUriParams = (path: string): string[] => {
		const matches = path.match(/:[^/]+/g);
		return matches ? matches.map(m => m.slice(1)) : [];
	};

	const executeRequest = async (endpointPath: string, method: string, useFormData = false) => {
		setLoading(true);
		setError(null);
		setResponse(null);

		try {
			// Replace URI parameters
			let finalPath = endpointPath;
			if (useFormData) {
				Object.entries(uriParams).forEach(([key, value]) => {
					finalPath = finalPath.replace(`:${key}`, encodeURIComponent(value));
				});
			}

			// Build query params
			let queryObj: any = undefined;
			if (useFormData && queryParams.trim()) {
				try {
					queryObj = JSON.parse(queryParams);
				} catch (e) {
					// If not valid JSON, try key=value format
					const params = new URLSearchParams(queryParams);
					queryObj = Object.fromEntries(params.entries());
				}
			}

			// Build headers
			const customHeaders: { [key: string]: string } = {};
			if (useFormData && headers.trim()) {
				try {
					Object.assign(customHeaders, JSON.parse(headers));
				} catch (e) {
					console.warn('Invalid headers JSON:', e);
				}
			}

			// Build request body
			let body: any = undefined;
			if (useFormData && method !== 'GET' && method !== 'HEAD' && requestBody.trim()) {
				try {
					body = JSON.parse(requestBody);
				} catch (e) {
					throw new Error('Invalid JSON in request body');
				}
			}

			// Build options for HTTP client
			const options: any = {
				headers: customHeaders,
			};

			// Add query params if present
			if (queryObj) {
				// Append query params to the path
				const searchParams = new URLSearchParams();
				Object.entries(queryObj).forEach(([key, value]) => {
					searchParams.append(key, String(value));
				});
				finalPath = `${finalPath}?${searchParams.toString()}`;
			}

			// Add body if present
			if (body !== undefined) {
				options.body = JSON.stringify(body);
				if (!customHeaders['Content-Type']) {
					options.headers['Content-Type'] = 'application/json';
				}
			}

			// Execute request using client.http
			let res;
			const httpMethod = method.toUpperCase();

			switch (httpMethod) {
				case 'GET':
					res = await client.http.get(finalPath, options);
					break;
				case 'POST':
					res = await client.http.post(finalPath, options);
					break;
				case 'PUT':
					res = await client.http.put(finalPath, options);
					break;
				case 'DELETE':
					res = await client.http.del(finalPath, options);
					break;
				default:
					throw new Error(`Unsupported HTTP method: ${method}`);
			}

			setResponse(res.data);
		} catch (e: any) {
			setError(e.message || "Failed to fetch");
		} finally {
			setLoading(false);
		}
	};

	const handleEndpointClick = (endpoint: APIEndpoint) => {
		setSelectedEndpoint(endpoint);
		setQueryParams("");
		setHeaders("");
		setRequestBody("");

		// Initialize URI params with empty strings
		const params = extractUriParams(endpoint.path);
		const initialParams: Record<string, string> = {};
		params.forEach(param => {
			initialParams[param] = "";
		});
		setUriParams(initialParams);

		executeRequest(endpoint.path, endpoint.method, false);
	};

	const handleRunRequest = (e: React.FormEvent) => {
		e.preventDefault();
		if (selectedEndpoint) {
			executeRequest(selectedEndpoint.path, selectedEndpoint.method, true);
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
								<span className={`inline-block px-2 py-0.5 text-xs font-semibold ${getMethodColor(endpoint.method)} text-white rounded flex-shrink-0`}>
									{endpoint.method}
								</span>
								<code className="text-xs sm:text-sm dark:text-slate-300 break-all">{endpoint.path}</code>
							</div>
								<p className="text-xs text-gray-600 dark:text-slate-400">{endpoint.description}</p>
							</button>
						))}
					</div>

				</div>
			</ResizableSidebar>

		{/* Main content area */}
		<div className="flex-1 overflow-hidden bg-gray-50 dark:bg-slate-800">
			{!selectedEndpoint && (
				<div className="h-full flex items-center justify-center">
					<div className="text-center text-gray-500 dark:text-slate-400">
						<p className="text-base md:text-lg">Select an endpoint to see the response</p>
					</div>
				</div>
			)}

			{selectedEndpoint && (
				<div className="h-full flex flex-col lg:flex-row gap-0">
					<div className="flex-1 overflow-y-auto border-b lg:border-b-0 lg:border-r border-gray-200 dark:border-slate-600 dark:text-slate-300 p-4 md:p-6 min-h-0">
						<form onSubmit={handleRunRequest} className="mb-4">
							<h2 className="text-lg md:text-xl font-semibold dark:text-slate-300 mb-2 flex flex-wrap items-center gap-2">
								<span>{selectedEndpoint.method}</span>
								<code className="flex flex-wrap items-center gap-1">
									{selectedEndpoint.path.split('/').map((segment, idx) => {
										if (segment.startsWith(':')) {
											const paramName = segment.slice(1);
											const value = uriParams[paramName] || '';
											const displayLength = Math.max(value.length || paramName.length, 3);
											return (
												<span key={idx} className="inline-flex items-center">
													<span>/</span>
													<input
														type="text"
														value={value}
														onChange={(e) => setUriParams(prev => ({
															...prev,
															[paramName]: e.target.value
														}))}
														placeholder={paramName}
														style={{ width: `${displayLength + 2}ch` }}
														required={true}
														className="inline-block px-2 py-0.5 mx-0.5 text-sm border border-purple-400 dark:border-purple-600 rounded bg-purple-50 dark:bg-purple-900/30 dark:text-slate-300 focus:ring-2 focus:ring-purple-500 focus:border-transparent font-mono"
													/>
												</span>
											);
										}
										return <span key={idx}>{idx === 0 ? segment : `/${segment}`}</span>;
									})}
								</code>
							</h2>

							<p className="text-sm text-gray-600 dark:text-slate-400">{selectedEndpoint.description}</p>

							{/* Request Configuration */}
							<div className="mt-6 border border-gray-200 dark:border-slate-600 rounded-lg p-4 bg-white dark:bg-slate-700/50">
								<h3 className="text-sm font-semibold mb-3 dark:text-slate-300">Request Configuration</h3>

								{/* Query Parameters */}
								<div className="mb-4">
									<label className="block text-xs font-medium mb-1 dark:text-slate-400">
										Query Parameters
										<span className="ml-1 text-gray-500 font-normal">(JSON or key=value&key2=value2)</span>
									</label>
									<textarea
										value={queryParams}
										onChange={(e) => setQueryParams(e.target.value)}
										placeholder='{"key": "value"} or key=value&key2=value2'
										className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800 dark:text-slate-300 focus:ring-2 focus:ring-purple-500 focus:border-transparent font-mono"
										rows={2}
									/>
								</div>

								{/* Headers
								<div className="mb-4">
									<label className="block text-xs font-medium mb-1 dark:text-slate-400">
										Headers <span className="ml-1 text-gray-500 font-normal">(JSON)</span>
									</label>
									<textarea
										value={headers}
										onChange={(e) => setHeaders(e.target.value)}
										placeholder='{"Authorization": "Bearer token", "X-Custom": "value"}'
										className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800 dark:text-slate-300 focus:ring-2 focus:ring-purple-500 focus:border-transparent font-mono"
										rows={3}
									/>
								</div>
                */}

								{/* Request Body */}
								{selectedEndpoint.method !== 'GET' && selectedEndpoint.method !== 'HEAD' && (
									<div className="mb-4">
										<label className="block text-xs font-medium mb-1 dark:text-slate-400">
											Request Body <span className="ml-1 text-gray-500 font-normal">(JSON)</span>
										</label>
										<textarea
											value={requestBody}
											onChange={(e) => setRequestBody(e.target.value)}
											placeholder='{"key": "value"}'
											className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800 dark:text-slate-300 focus:ring-2 focus:ring-purple-500 focus:border-transparent font-mono"
											rows={5}
										/>
									</div>
								)}

								{/* Run Button */}
								<button
									type="submit"
									disabled={loading}
									className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-semibold py-2 px-4 rounded transition-colors flex items-center justify-center gap-2"
								>
									{loading ? (
										<>
											<div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></div>
											<span>Running...</span>
										</>
									) : (
										<>
											<span>Run Request</span>
											<FontAwesomeIcon icon={faPlay} className="ml-1 inline" />
										</>
									)}
								</button>
							</div>
						</form>

						<SDKCodeExamples
							method={selectedEndpoint.method}
							path={selectedEndpoint.path}
							serverEndpoint={endpoint}
						/>
					</div>

					{/* Response Panel */}
					<div className="flex-1 overflow-y-auto dark:text-slate-300 p-4 md:p-6 min-h-0 bg-white dark:bg-slate-700">
						<h2 className="text-lg md:text-xl font-semibold mb-4 dark:text-slate-300">Response</h2>

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

						{!loading && !error && !response && (
							<div className="text-sm text-gray-500 dark:text-slate-400 italic">
								No response yet
							</div>
						)}
					</div>
				</div>
			)}
		</div>
		</div>
	);
}

