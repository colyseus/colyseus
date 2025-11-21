import { useState, useEffect } from "react";
import { endpoint, client } from "../utils/Types";
import { ResizableSidebar } from "../components/ResizableSidebar";
import { SDKCodeExamples } from "../components/SDKCodeExamples";
import { JSONSchemaFields } from "../components/JSONSchemaFields";
import { useSettings } from "../contexts/SettingsContext";
import { Callout } from "../components/Callout";
import { faPlay } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus, vs } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface APIEndpoint {
	method: string;
	path: string;
  body: any;
  query: any;
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
	const { darkMode } = useSettings();
	const [endpoints, setEndpoints] = useState<APIEndpoint[]>([]);
	const [selectedEndpointIndex, setSelectedEndpointIndex] = useState<number | null>(null);
	const [response, setResponse] = useState<any>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Form state
	const [queryFields, setQueryFields] = useState<Record<string, any>>({});
	const [bodyFields, setBodyFields] = useState<Record<string, any>>({});
	const [headers, setHeaders] = useState("");
	const [uriParams, setUriParams] = useState<Record<string, string>>({});

	// Fetch endpoints from OpenAPI specification
	useEffect(() => {
		const fetchEndpoints = async () => {
			try {
				const res = await fetch(`${endpoint}/__openapi`);
				if (res.ok) {
					const openapi = await res.json();
					const parsedEndpoints: APIEndpoint[] = [];

					// Parse new format: array of endpoint objects
					if (Array.isArray(openapi)) {
						for (const endpoint of openapi) {
							if (endpoint.method && endpoint.path) {
								parsedEndpoints.push({
									method: endpoint.method.toUpperCase(),
									path: endpoint.path,
                  body: endpoint.body,
                  query: endpoint.query,
									description: endpoint.description || `${endpoint.method.toUpperCase()} ${endpoint.path}`,
								});
							}
						}
          }

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
			if (useFormData) {
				// Use queryFields if available (from schema), otherwise fall back to queryParams
				if (Object.keys(queryFields).length > 0) {
					queryObj = { ...queryFields };
					// Remove empty values
					Object.keys(queryObj).forEach(key => {
						if (queryObj[key] === '' || queryObj[key] === undefined || queryObj[key] === null) {
							delete queryObj[key];
						}
					});
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
			if (useFormData && method !== 'GET' && method !== 'HEAD' && Object.values(bodyFields).length > 0) {
				options.body = bodyFields;
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

	const handleEndpointClick = (index: number) => {
		const endpoint = endpoints[index];
		setSelectedEndpointIndex(index);
		setQueryFields({});
		setBodyFields({});
		setHeaders("");
		setResponse(null);
		setError(null);

		// Initialize URI params with empty strings
		const params = extractUriParams(endpoint.path);
		const initialParams: Record<string, string> = {};
		params.forEach(param => {
			initialParams[param] = "";
		});
		setUriParams(initialParams);
	};

	const handleRunRequest = (e: React.FormEvent) => {
		e.preventDefault();
		if (selectedEndpointIndex !== null) {
			const endpoint = endpoints[selectedEndpointIndex];
			executeRequest(endpoint.path, endpoint.method, true);
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
								onClick={() => handleEndpointClick(idx)}
								className={`w-full text-left p-2 sm:p-3 rounded border transition-colors ${
									selectedEndpointIndex === idx
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
			{selectedEndpointIndex === null && (
				<div className="h-full flex items-center justify-center">
					<div className="text-center text-gray-500 dark:text-slate-400">
						<p className="text-base md:text-lg">Select an endpoint to see the response</p>
					</div>
				</div>
			)}

			{selectedEndpointIndex !== null && (() => {
				const selectedEndpoint = endpoints[selectedEndpointIndex];
				return (
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
							<div className="mt-6 bg-gradient-to-br from-purple-50 to-blue-50 dark:from-slate-800 dark:to-slate-700 rounded-lg border border-purple-200 dark:border-slate-600 shadow-sm overflow-hidden">
								<div className="bg-white/60 dark:bg-slate-800/60 backdrop-blur-sm px-4 py-3 border-b border-purple-200 dark:border-slate-600">
									<div className="flex items-center gap-2">
										<svg className="w-4 h-4 sm:w-5 sm:h-5 text-purple-600 dark:text-purple-400" fill="currentColor" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
											<path d="M495.9 166.6c3.2 8.7 .5 18.4-6.4 24.6l-43.3 39.4c1.1 8.3 1.7 16.8 1.7 25.4s-.6 17.1-1.7 25.4l43.3 39.4c6.9 6.2 9.6 15.9 6.4 24.6c-4.4 11.9-9.7 23.3-15.8 34.3l-4.7 8.1c-6.6 11-14 21.4-22.1 31.2c-5.9 7.2-15.7 9.6-24.5 6.8l-55.7-17.7c-13.4 10.3-28.2 18.9-44 25.4l-12.5 57.1c-2 9.1-9 16.3-18.2 17.8c-13.8 2.3-28 3.5-42.5 3.5s-28.7-1.2-42.5-3.5c-9.2-1.5-16.2-8.7-18.2-17.8l-12.5-57.1c-15.8-6.5-30.6-15.1-44-25.4L83.1 425.9c-8.8 2.8-18.6 .3-24.5-6.8c-8.1-9.8-15.5-20.2-22.1-31.2l-4.7-8.1c-6.1-11-11.4-22.4-15.8-34.3c-3.2-8.7-.5-18.4 6.4-24.6l43.3-39.4C64.6 273.1 64 264.6 64 256s.6-17.1 1.7-25.4L22.4 191.2c-6.9-6.2-9.6-15.9-6.4-24.6c4.4-11.9 9.7-23.3 15.8-34.3l4.7-8.1c6.6-11 14-21.4 22.1-31.2c5.9-7.2 15.7-9.6 24.5-6.8l55.7 17.7c13.4-10.3 28.2-18.9 44-25.4l12.5-57.1c2-9.1 9-16.3 18.2-17.8C227.3 1.2 241.5 0 256 0s28.7 1.2 42.5 3.5c9.2 1.5 16.2 8.7 18.2 17.8l12.5 57.1c15.8 6.5 30.6 15.1 44 25.4l55.7-17.7c8.8-2.8 18.6-.3 24.5 6.8c8.1 9.8 15.5 20.2 22.1 31.2l4.7 8.1c6.1 11 11.4 22.4 15.8 34.3zM256 336a80 80 0 1 0 0-160 80 80 0 1 0 0 160z"/>
										</svg>
										<h3 className="text-sm sm:text-base font-semibold text-gray-800 dark:text-slate-200">
                      Request
										</h3>
									</div>
								</div>
								<div className="p-4 space-y-5">
									{/* Query Parameters - render fields based on schema */}
									{selectedEndpoint.query && selectedEndpoint.query.properties && (
										<div>
											<h3 className="block text-xs font-semibold text-gray-700 dark:text-slate-400 uppercase tracking-wide mb-2">Query Parameters</h3>
											<JSONSchemaFields
												schema={selectedEndpoint.query}
												values={queryFields}
												onChange={(key, value) => {
													setQueryFields(prev => ({ ...prev, [key]: value }));
												}}
											/>
										</div>
									)}

									{/* Separator if both sections are present */}
									{selectedEndpoint.query && selectedEndpoint.query.properties &&
									 selectedEndpoint.body && selectedEndpoint.body.properties && (
										<div className="border-t border-gray-300 dark:border-slate-600"></div>
									)}

									{/* Request Body - render fields based on schema */}
									{selectedEndpoint.body && selectedEndpoint.body.properties && (
										<div>
											<h3 className="block text-xs font-semibold text-gray-700 dark:text-slate-400 uppercase tracking-wide mb-2">Request Body</h3>
											<JSONSchemaFields
												schema={selectedEndpoint.body}
												values={bodyFields}
												onChange={(key, value) => {
													setBodyFields(prev => ({ ...prev, [key]: value }));
												}}
											/>
										</div>
									)}

									{/* Execute Button */}
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
												<span>Execute</span>
												<FontAwesomeIcon icon={faPlay} className="ml-1 inline" />
											</>
										)}
									</button>
								</div>
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
						<div className="bg-gray-50 dark:bg-slate-800 rounded overflow-x-auto">
							<SyntaxHighlighter
								language="json"
								style={darkMode ? vscDarkPlus : vs}
								customStyle={{
									margin: 0,
									padding: '1rem',
									fontSize: '0.875rem',
									backgroundColor: 'transparent',
								}}
								codeTagProps={{
									style: {
										fontSize: '0.875rem',
									}
								}}
							>
								{JSON.stringify(response, null, 2)}
							</SyntaxHighlighter>
						</div>
					)}

					{!loading && !error && !response && (
						<Callout>
							Click "Execute Request" to execute the endpoint
						</Callout>
					)}
					</div>
				</div>
				);
			})()}
		</div>
		</div>
	);
}

