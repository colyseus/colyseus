import React, { useEffect, useState } from "react";
import { client } from "../utils/Types";
import type { AuthConfig } from "../../src-backend/index";

export function AuthOptions({
	authToken,
	onAuthTokenChange,
	authConfig,
}: {
	authToken: string,
	onAuthTokenChange: (e: string, autoClose?: boolean) => void,
	authConfig: AuthConfig,
}) {
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");

	const [emailAndPasswordError, setEmailAndPasswordError] = useState("");
	const [emailAndPasswordLoading, setEmailAndPasswordLoading] = useState(false);

	const [anonymousLoading, setAnonymousLoading] = useState(false);
	const [anonymousError, setAnonymousError] = useState("");

	const [oAuthLoading, setOAuthLoading] = useState(false);
	const [oAuthError, setOAuthError] = useState("");

	const handleAuthTokenChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		onAuthTokenChange(e.target.value, false);
	};

	const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		setEmail(e.target.value);
	};

	const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		setPassword(e.target.value);
	};

	const signInWithEmailAndPassword = async function(e: React.MouseEvent<HTMLButtonElement> | React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		setEmailAndPasswordError("");

		try {
			setEmailAndPasswordLoading(true);
			await client.auth.signInWithEmailAndPassword(email, password);

		} catch (e: any) {
			console.error(e);
			setEmailAndPasswordError(e.message);

		} finally {
			setEmailAndPasswordLoading(false);
		}
	};

	const signInAnonymously = async function(e: React.MouseEvent<HTMLButtonElement>) {
		setAnonymousError("");

		try {
			setAnonymousLoading(true);
			await client.auth.signInAnonymously();

		} catch (e: any) {
			console.error(e);
			setAnonymousError(e.message);

		} finally {
			setAnonymousLoading(false);
		}
	};

	const signInWithProvider = function(provider) {
		return async (e: React.MouseEvent<HTMLButtonElement>) => {
			setOAuthError("");

			try {
				setOAuthLoading(true);
				await client.auth.signInWithProvider(provider);

			} catch (e: any) {
				console.error(e);
				setOAuthError(e.message);

			} finally {
				setOAuthLoading(false);
			}
		}
	}

	const onLogoutClick = async function(e: React.MouseEvent<HTMLButtonElement>) {
		client.auth.signOut();
		onAuthTokenChange("");
	}

	useEffect(() => {
		// propagate auth token changes to parent component
		const onAuthChange = client.auth.onChange((auth) => {
			onAuthTokenChange(auth.token || "");
		});

		return () => onAuthChange();
	}, []);

	return (
		<div className="">
			<div className="flex gap-1">
				<input
					type="text"
					name="token"
					value={authToken}
					onChange={handleAuthTokenChange}
					className={"w-full p-1.5 text-sm border-r-0 overflow-hidden rounded-l text-ellipsis border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:placeholder-gray-400"}
				/>
				<button disabled={(authToken === "")} className="bg-red-500 disabled:cursor-not-allowed disabled:opacity-50 enabled:hover:bg-red-700 dark:bg-red-600 dark:enabled:hover:bg-red-700 text-white text-sm font-semibold py-1.5 px-3 rounded-r transition" onClick={onLogoutClick}>
					Clear
				</button>
			</div>
			<div className="flex flex-col mt-1.5 bg-gray-100 dark:bg-slate-800 rounded p-2.5">

				{(authConfig.register)
					? <div>
							<h2 className="font-semibold text-xs mb-1.5 text-gray-800 dark:text-gray-200">Email / Password</h2>
							<form className="flex gap-1.5 w-full" onSubmit={signInWithEmailAndPassword}>
								<input onChange={handleEmailChange} type="text" name="email" placeholder="Email" className="flex-grow p-1.5 text-sm overflow-hidden rounded text-ellipsis border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:placeholder-gray-400" />
								<input onChange={handlePasswordChange} type="password" name="password" placeholder="Password" className="flex-grow p-1.5 text-sm overflow-hidden rounded text-ellipsis border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:placeholder-gray-400" />
								<button className="bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 enabled:hover:bg-blue-700 dark:bg-blue-600 dark:enabled:hover:bg-blue-700 text-white text-sm font-semibold py-1.5 px-3 rounded transition whitespace-nowrap" onClick={signInWithEmailAndPassword} disabled={emailAndPasswordLoading}>Sign-in</button>
							</form>
							{(emailAndPasswordError) && <div className="mt-1.5 bg-red-100 dark:bg-red-900/30 rounded p-1.5 text-red-900 dark:text-red-200 text-xs border border-red-200 dark:border-red-800">{emailAndPasswordError}</div>}
						</div>
					: null}

				{(authConfig.oauth.length > 0)
					? <>
							<hr className="my-2.5 border-gray-300 dark:border-slate-600" />
							<div>
								<h2 className="font-semibold text-xs mb-1.5 text-gray-800 dark:text-gray-200">OAuth 2.0 Provider</h2>
								<div className="gap-1.5 flex flex-wrap">
									{authConfig.oauth.map((provider) => (
										<button
											key={provider}
											onClick={signInWithProvider(provider)}
											className="bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 enabled:hover:bg-blue-700 dark:bg-blue-600 dark:enabled:hover:bg-blue-700 text-white text-sm font-semibold py-1.5 px-3 rounded transition"
											disabled={oAuthLoading}
										>
												{provider.charAt(0).toUpperCase() + provider.slice(1)}
										</button>
									))}
								</div>
								{(oAuthError) && <div className="mt-1.5 bg-red-100 dark:bg-red-900/30 rounded p-1.5 text-red-900 dark:text-red-200 text-xs border border-red-200 dark:border-red-800">{oAuthError}</div>}
							</div>
						</>
					: null}

				{(authConfig.anonymous)
					? <>
							<hr className="my-2.5 border-gray-300 dark:border-slate-600" />
							<div>
								<h2 className="font-semibold text-xs mb-1.5 text-gray-800 dark:text-gray-200">Anonymous</h2>
								<button
									onClick={signInAnonymously}
									className="bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 enabled:hover:bg-blue-700 dark:bg-blue-600 dark:enabled:hover:bg-blue-700 text-white text-sm font-semibold py-1.5 px-3 rounded transition"
									disabled={anonymousLoading}
								>
									Sign-in Anonymously
								</button>
								{(anonymousError) && <div className="mt-1.5 bg-red-100 dark:bg-red-900/30 rounded p-1.5 text-red-900 dark:text-red-200 text-xs border border-red-200 dark:border-red-800">{anonymousError}</div>}
							</div>
						</>
					: null}

			</div>
		</div>
	);
}
