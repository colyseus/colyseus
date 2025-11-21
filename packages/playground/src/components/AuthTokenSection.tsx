import { useState } from "react";
import { AuthOptions } from "./AuthOptions";
import type { AuthConfig } from "../../src-backend/index";

export function AuthTokenSection({
	authToken,
	onAuthTokenChange,
	authConfig,
}: {
	authToken: string;
	onAuthTokenChange: (newToken: string, autoClose?: boolean) => void;
	authConfig: AuthConfig;
}) {
	const [isAuthBlockOpen, setAuthBlockOpen] = useState(false);

	const toggleAuthBlock = function(e: React.MouseEvent) {
		e.preventDefault();
		setAuthBlockOpen(!isAuthBlockOpen);
	};

	return (
		<div className="bg-gradient-to-br from-purple-50 to-blue-50 dark:from-slate-800 dark:to-slate-700 rounded-lg border border-purple-200 dark:border-slate-600 shadow-sm overflow-hidden">
			<button
				type="button"
				onClick={toggleAuthBlock}
				className={`w-full flex items-center justify-between px-4 py-3 ${
					isAuthBlockOpen
						? 'border-b border-purple-200 dark:border-slate-600 bg-white/60 dark:bg-slate-800/60 backdrop-blur-sm'
						: 'bg-white/60 dark:bg-slate-800/60 backdrop-blur-sm hover:bg-white/80 dark:hover:bg-slate-800/80'
				}`}
			>
				<div className="flex items-center gap-2">
					<svg
						className={`w-3 h-3 transition-transform ${isAuthBlockOpen ? "rotate-90" : ""}`}
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
						Auth Token
					</span>
				</div>
				<span className="text-xs text-gray-500 dark:text-slate-500 truncate max-w-[150px]">
					{authToken ? `${authToken.length} chars` : "(none)"}
				</span>
			</button>
			{isAuthBlockOpen && (
				<AuthOptions
					authToken={authToken}
					onAuthTokenChange={onAuthTokenChange}
					authConfig={authConfig}
				/>
			)}
		</div>
	);
}

