import { useState } from "react";
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus, vs } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useSettings } from '../contexts/SettingsContext';

interface SDKCodeExamplesProps {
	method: string;
	path: string;
	serverEndpoint: string;
	bodySchema?: any;
	querySchema?: any;
	bodyValues?: Record<string, any>;
	queryValues?: Record<string, any>;
	uriParams?: Record<string, string>;
}

export function SDKCodeExamples({ 
	method, 
	path, 
	serverEndpoint, 
	bodySchema, 
	querySchema,
	bodyValues = {},
	queryValues = {},
	uriParams = {}
}: SDKCodeExamplesProps) {
	const { darkMode } = useSettings();
	const [isExpanded, setIsExpanded] = useState(false);
	const [activeTab, setActiveTab] = useState('javascript');
	const [copied, setCopied] = useState(false);

	const tabs = [
		{ id: 'javascript', label: 'JavaScript', lang: 'javascript' },
		{ id: 'unity', label: 'Unity', lang: 'csharp' },
		{ id: 'defold', label: 'Defold (Lua)', lang: 'lua' },
		{ id: 'haxe', label: 'Haxe', lang: 'haxe' },
		{ id: 'curl', label: 'Raw cURL', lang: 'bash' },
	];

	// Helper to get example values from schema or current values
	const getExampleValues = (schema: any, currentValues: Record<string, any>) => {
		if (!schema || !schema.properties) return {};
		
		const examples: Record<string, any> = {};
		Object.entries(schema.properties).forEach(([key, fieldSchema]: [string, any]) => {
			// Use current value if available
			if (currentValues[key] !== undefined && currentValues[key] !== null && currentValues[key] !== '') {
				examples[key] = currentValues[key];
			} 
			// Otherwise use example or default from schema
			else if (fieldSchema.example !== undefined) {
				examples[key] = fieldSchema.example;
			} else if (fieldSchema.default !== undefined) {
				examples[key] = fieldSchema.default;
			}
			// Generate placeholder based on type
			else {
				const type = fieldSchema.type || 'string';
				if (type === 'string') examples[key] = fieldSchema.enum?.[0] || '';
				else if (type === 'number' || type === 'integer') examples[key] = 0;
				else if (type === 'boolean') examples[key] = false;
				else if (type === 'array') examples[key] = [];
				else if (type === 'object') examples[key] = {};
			}
		});
		return examples;
	};

	// Replace URI params in path
	const getProcessedPath = () => {
		let processedPath = path;
		Object.entries(uriParams).forEach(([key, value]) => {
			if (value) {
				processedPath = processedPath.replace(`:${key}`, value);
			}
		});
		return processedPath;
	};

	const getCodeExample = (lang: string) => {
		const httpMethod = method.toLowerCase();
		const processedPath = getProcessedPath();
		const hasBody = bodySchema && Object.keys(bodySchema.properties || {}).length > 0;
		const hasQuery = querySchema && Object.keys(querySchema.properties || {}).length > 0;
		const bodyExample = hasBody ? getExampleValues(bodySchema, bodyValues) : null;
		const queryExample = hasQuery ? getExampleValues(querySchema, queryValues) : null;

		switch (lang) {
			case 'javascript':
				let jsCode = `import { Client } from "colyseus.js";

const client = new Client("${serverEndpoint}");
`;
				
				if (hasQuery) {
					jsCode += `
// Query parameters
const queryParams = ${JSON.stringify(queryExample, null, 2)};
`;
				}

				if (hasBody) {
					jsCode += `
// Request body
const body = ${JSON.stringify(bodyExample, null, 2)};
`;
				}

				jsCode += `
// Call the HTTP endpoint`;
				
				if (hasBody && hasQuery) {
					jsCode += `
const response = await client.http.${httpMethod}("${processedPath}", {
  body: body,
  query: queryParams
});`;
				} else if (hasBody) {
					jsCode += `
const response = await client.http.${httpMethod}("${processedPath}", {
  body: body
});`;
				} else if (hasQuery) {
					jsCode += `
const response = await client.http.${httpMethod}("${processedPath}", {
  query: queryParams
});`;
				} else {
					jsCode += `
const response = await client.http.${httpMethod}("${processedPath}");`;
				}

				jsCode += `
console.log(response);`;
				return jsCode;

			case 'unity':
				let unityCode = `using Colyseus;
using System.Collections.Generic;

var client = new ColyseusClient("${serverEndpoint}");
`;

				if (hasQuery) {
					unityCode += `
// Query parameters
var queryParams = new Dictionary<string, object>
{`;
					Object.entries(queryExample!).forEach(([key, value], idx, arr) => {
						unityCode += `
    { "${key}", ${JSON.stringify(value)} }${idx < arr.length - 1 ? ',' : ''}`;
					});
					unityCode += `
};
`;
				}

				if (hasBody) {
					unityCode += `
// Request body
var body = new Dictionary<string, object>
{`;
					Object.entries(bodyExample!).forEach(([key, value], idx, arr) => {
						unityCode += `
    { "${key}", ${JSON.stringify(value)} }${idx < arr.length - 1 ? ',' : ''}`;
					});
					unityCode += `
};
`;
				}

				const unityMethod = httpMethod.charAt(0).toUpperCase() + httpMethod.slice(1);
				unityCode += `
// Call the HTTP endpoint`;

				if (hasBody && hasQuery) {
					unityCode += `
var response = await client.Http.${unityMethod}("${processedPath}", body, queryParams);`;
				} else if (hasBody) {
					unityCode += `
var response = await client.Http.${unityMethod}("${processedPath}", body);`;
				} else if (hasQuery) {
					unityCode += `
var response = await client.Http.${unityMethod}("${processedPath}", null, queryParams);`;
				} else {
					unityCode += `
var response = await client.Http.${unityMethod}("${processedPath}");`;
				}

				unityCode += `
Debug.Log(response);`;
				return unityCode;

			case 'defold':
				let defoldCode = `local Colyseus = require "colyseus.sdk"

local client = Colyseus.Client("${serverEndpoint}")
`;

				if (hasQuery) {
					defoldCode += `
-- Query parameters
local query_params = ${JSON.stringify(queryExample, null, 2).replace(/"/g, '"').replace(/\n/g, '\n')}
`;
				}

				if (hasBody) {
					defoldCode += `
-- Request body
local body = ${JSON.stringify(bodyExample, null, 2).replace(/"/g, '"').replace(/\n/g, '\n')}
`;
				}

				defoldCode += `
-- Call the HTTP endpoint`;

				if (hasBody && hasQuery) {
					defoldCode += `
client.http:${httpMethod}("${processedPath}", {
    body = body,
    query = query_params
}, function(err, response)`;
				} else if (hasBody) {
					defoldCode += `
client.http:${httpMethod}("${processedPath}", {
    body = body
}, function(err, response)`;
				} else if (hasQuery) {
					defoldCode += `
client.http:${httpMethod}("${processedPath}", {
    query = query_params
}, function(err, response)`;
				} else {
					defoldCode += `
client.http:${httpMethod}("${processedPath}", function(err, response)`;
				}

				defoldCode += `
    if err then
        print("Error:", err)
    else
        print(response)
    end
end)`;
				return defoldCode;

			case 'haxe':
				let haxeCode = `import io.colyseus.Client;

var client = new Client("${serverEndpoint}");
`;

				if (hasQuery) {
					haxeCode += `
// Query parameters
var queryParams = ${JSON.stringify(queryExample, null, 2)};
`;
				}

				if (hasBody) {
					haxeCode += `
// Request body
var body = ${JSON.stringify(bodyExample, null, 2)};
`;
				}

				haxeCode += `
// Call the HTTP endpoint`;

				if (hasBody && hasQuery) {
					haxeCode += `
client.http.${httpMethod}("${processedPath}", {
    body: body,
    query: queryParams
}, function(err, response) {`;
				} else if (hasBody) {
					haxeCode += `
client.http.${httpMethod}("${processedPath}", {
    body: body
}, function(err, response) {`;
				} else if (hasQuery) {
					haxeCode += `
client.http.${httpMethod}("${processedPath}", {
    query: queryParams
}, function(err, response) {`;
				} else {
					haxeCode += `
client.http.${httpMethod}("${processedPath}", function(err, response) {`;
				}

				haxeCode += `
    if (err != null) {
        trace("Error: " + err);
    } else {
        trace(response);
    }
});`;
				return haxeCode;

			case 'curl':
				let curlCmd = `curl -X ${method.toUpperCase()}`;
				
				let fullPath = `${serverEndpoint}${processedPath}`;
				
				// Add query parameters
				if (hasQuery) {
					const queryString = Object.entries(queryExample!)
						.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
						.join('&');
					fullPath += `?${queryString}`;
				}
				
				curlCmd += ` "${fullPath}"`;
				
				// Add body
				if (hasBody) {
					curlCmd += ` \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(bodyExample, null, 2)}'`;
				}
				
				return curlCmd;

			default:
				return '';
		}
	};

	const copyToClipboard = async () => {
		const code = getCodeExample(activeTab);
		try {
			await navigator.clipboard.writeText(code);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch (err) {
			console.error('Failed to copy text: ', err);
		}
	};

	return (
		<div className={`border border-gray-200 dark:border-slate-600 rounded-lg overflow-hidden mb-4 md:mb-6 ${isExpanded ? 'bg-gray-50 dark:bg-slate-800' : ''}`}>
			<button
				type="button"
				onClick={() => setIsExpanded(!isExpanded)}
				className={`w-full flex items-center justify-between p-2 ${
					isExpanded
						? 'border-b border-gray-200 dark:border-slate-600 bg-gray-50 dark:bg-slate-800'
						: 'hover:bg-gray-50 dark:hover:bg-slate-800'
				}`}
			>
				<div className="flex items-center gap-2">
					<svg
						className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-90" : ""}`}
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
						Usage with Colyseus SDK
					</span>
				</div>
			</button>

			{isExpanded && (
				<div className="p-4">
					<div className="border-b-2 border-gray-200 dark:border-slate-600 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
						<ul className="flex mt-1.5 -mb-0.5 text-sm font-medium text-center whitespace-nowrap">
							{tabs.map(tab => (
								<li key={tab.id} className="mr-1">
									<button
										onClick={() => setActiveTab(tab.id)}
										className={
											"inline-flex items-center px-5 py-3 border-b-2 transition-all duration-200 ease-in-out font-semibold " +
											(activeTab === tab.id
												? "text-purple-600 dark:text-purple-400 border-purple-600 dark:border-purple-400 bg-purple-50 dark:bg-purple-950/30"
												: "text-gray-500 dark:text-slate-400 border-transparent hover:text-gray-700 dark:hover:text-slate-300 hover:border-gray-300 dark:hover:border-slate-500 hover:bg-gray-50 dark:hover:bg-slate-700/30"
											)
										}
										aria-current={activeTab === tab.id ? "page" : undefined}>
										{tab.label}
									</button>
								</li>
							))}
						</ul>
					</div>

					<div className="rounded overflow-hidden mt-4 relative">
						<button
							onClick={copyToClipboard}
							className="absolute top-2 right-2 z-10 p-2 rounded bg-gray-700 hover:bg-gray-600 dark:bg-slate-600 dark:hover:bg-slate-500 text-white transition-colors duration-200 flex items-center gap-1.5 text-xs font-medium"
							title="Copy to clipboard"
						>
							{copied ? (
								<>
									<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
									</svg>
									<span>Copied!</span>
								</>
							) : (
								<>
									<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
									</svg>
									<span>Copy</span>
								</>
							)}
						</button>
						<SyntaxHighlighter
							language={tabs.find(tab => tab.id === activeTab)?.lang || 'javascript'}
							style={darkMode ? vscDarkPlus : vs}
							customStyle={{
								margin: 0,
								borderRadius: '0.375rem',
								fontSize: '0.875rem'
							}}
							showLineNumbers={false}
						>
							{getCodeExample(activeTab)}
						</SyntaxHighlighter>
					</div>
				</div>
			)}
		</div>
	);
}

