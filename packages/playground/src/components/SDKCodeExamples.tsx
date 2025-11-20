import { useState } from "react";
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus, vs } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface SDKCodeExamplesProps {
	method: string;
	path: string;
	serverEndpoint: string;
}

export function SDKCodeExamples({ method, path, serverEndpoint }: SDKCodeExamplesProps) {
	const [isExpanded, setIsExpanded] = useState(false);
	const [activeTab, setActiveTab] = useState('javascript');
	const [isDarkMode] = useState(() =>
		window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
	);

	const tabs = [
		{ id: 'javascript', label: 'JavaScript', lang: 'javascript' },
		{ id: 'unity', label: 'Unity', lang: 'csharp' },
		{ id: 'defold', label: 'Defold (Lua)', lang: 'lua' },
		{ id: 'haxe', label: 'Haxe', lang: 'haxe' }
	];

	const getCodeExample = (lang: string) => {
		const httpMethod = method.toLowerCase();

		switch (lang) {
			case 'javascript':
				return `import { Client } from "colyseus.js";

const client = new Client("${serverEndpoint}");

// Call the HTTP endpoint
const response = await client.http.${httpMethod}("${path}");
console.log(response);`;

			case 'unity':
				return `using Colyseus;

var client = new ColyseusClient("${serverEndpoint}");

// Call the HTTP endpoint
var response = await client.Http.${httpMethod.charAt(0).toUpperCase() + httpMethod.slice(1)}("${path}");
Debug.Log(response);`;

			case 'defold':
				return `local Colyseus = require "colyseus.sdk"

local client = Colyseus.Client("${serverEndpoint}")

-- Call the HTTP endpoint
client.http:${httpMethod}("${path}", function(err, response)
    if err then
        print("Error:", err)
    else
        print(response)
    end
end)`;

			case 'haxe':
				return `import io.colyseus.Client;

var client = new Client("${serverEndpoint}");

// Call the HTTP endpoint
client.http.${httpMethod}("${path}", function(err, response) {
    if (err != null) {
        trace("Error: " + err);
    } else {
        trace(response);
    }
});`;

			default:
				return '';
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
					<div className="border-b-2 border-gray-200 dark:border-slate-600">
						<ul className="flex flex-wrap mt-1.5 -mb-0.5 text-sm font-medium text-center">
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

					<div className="rounded overflow-hidden mt-4">
						<SyntaxHighlighter
							language={tabs.find(tab => tab.id === activeTab)?.lang || 'javascript'}
							style={isDarkMode ? vscDarkPlus : vs}
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

