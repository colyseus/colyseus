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

	const [emailAndPasswordError, setEmailAndPasswordError] = useState<AuthErrorState>(null);
	const [emailAndPasswordLoading, setEmailAndPasswordLoading] = useState(false);

	const [anonymousLoading, setAnonymousLoading] = useState(false);
	const [anonymousError, setAnonymousError] = useState<AuthErrorState>(null);

	const [oAuthLoading, setOAuthLoading] = useState(false);
	const [oAuthError, setOAuthError] = useState<AuthErrorState>(null);

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
		setEmailAndPasswordError(null);

		try {
			setEmailAndPasswordLoading(true);
			await client.auth.signInWithEmailAndPassword(email, password);

		} catch (e: any) {
			console.error(e);
			setEmailAndPasswordError(parseAuthError(e));

		} finally {
			setEmailAndPasswordLoading(false);
		}
	};

	const signInAnonymously = async function(e: React.MouseEvent<HTMLButtonElement>) {
		setAnonymousError(null);

		try {
			setAnonymousLoading(true);
			await client.auth.signInAnonymously();

		} catch (e: any) {
			console.error(e);
			setAnonymousError(parseAuthError(e));

		} finally {
			setAnonymousLoading(false);
		}
	};

	const signInWithProvider = function(provider) {
		return async (e: React.MouseEvent<HTMLButtonElement>) => {
			setOAuthError(null);

			try {
				setOAuthLoading(true);
				await client.auth.signInWithProvider(provider);

			} catch (e: any) {
				console.error(e);
				setOAuthError(parseAuthError(e));

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
			<div className="flex flex-col mt-1.5 rounded p-2.5">
				{(authConfig.register)
					? <div className="@container">
							<h2 className="block text-xs font-semibold text-gray-700 dark:text-slate-400 uppercase tracking-wide mb-2">Email / Password</h2>
							<form className="flex flex-col @sm:flex-row gap-1.5 w-full" onSubmit={signInWithEmailAndPassword}>
								<input onChange={handleEmailChange} type="text" name="email" placeholder="Email" className="flex-grow p-1.5 text-sm overflow-hidden rounded text-ellipsis border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:placeholder-gray-400" />
								<input onChange={handlePasswordChange} type="password" name="password" placeholder="Password" className="flex-grow p-1.5 text-sm overflow-hidden rounded text-ellipsis border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:placeholder-gray-400" />
								<button className="w-full @sm:w-auto bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 enabled:hover:bg-blue-700 dark:bg-blue-600 dark:enabled:hover:bg-blue-700 text-white text-sm font-semibold py-1.5 px-3 rounded transition whitespace-nowrap" onClick={signInWithEmailAndPassword} disabled={emailAndPasswordLoading}>Sign-in</button>
							</form>
							<AuthErrorMessage error={emailAndPasswordError} />
						</div>
					: null}

				{(authConfig.oauth.length > 0)
					? <>
							<hr className="my-2.5 border-gray-300 dark:border-slate-600" />
							<div>
								<h2 className="block text-xs font-semibold text-gray-700 dark:text-slate-400 uppercase tracking-wide mb-2">OAuth 2.0 Provider</h2>
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
								<AuthErrorMessage error={oAuthError} />
							</div>
						</>
					: null}

				{(authConfig.anonymous)
					? <>
							<hr className="my-2.5 border-gray-300 dark:border-slate-600" />
							<div>
								<h2 className="block text-xs font-semibold text-gray-700 dark:text-slate-400 uppercase tracking-wide mb-2">Anonymous</h2>
								<button
									onClick={signInAnonymously}
									className="bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 enabled:hover:bg-blue-700 dark:bg-blue-600 dark:enabled:hover:bg-blue-700 text-white text-sm font-semibold py-1.5 px-3 rounded transition"
									disabled={anonymousLoading}
								>
									Sign-in Anonymously
								</button>
								<AuthErrorMessage error={anonymousError} />
							</div>
						</>
					: null}
			</div>

      <hr className="mb-2.5 border-gray-300 dark:border-slate-600" />
			<div className="flex p-2 pt-0">
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
		</div>
	);
}

/** Shape stored in the three sign-in error states. `null` ⇒ no error. */
type AuthErrorState = {
	message: string;
	banDetails?: { reason?: string | null; until?: string | Date | null };
} | null;

/**
 * Translate an SDK rejection into a render-ready error object. Handles
 * three rejection shapes the SDK currently produces:
 *
 *  - `ServerError` (email/password, anonymous): structured data on
 *    `e.data`, machine code on `e.message`.
 *  - OAuth Error with attached `code`/`reason`/`until` from the
 *    postMessage payload (after the recent SDK change).
 *  - Bare string (older SDK builds — fall through gracefully).
 */
function parseAuthError(e: any): AuthErrorState {
	const code = e?.code
		?? (typeof e?.message === 'string' ? e.message : undefined)
		?? (typeof e === 'string' ? e : undefined);
	const message = humanizeAuthError(typeof code === 'string' ? code : undefined);

	// Ban details can live on either the Error itself (OAuth path) or
	// the ServerError.data envelope (email/password path).
	const candidate = (typeof e?.reason !== 'undefined' || typeof e?.until !== 'undefined')
		? e
		: e?.data;
	const isBanned = code === 'banned' || candidate?.error === 'banned';
	const banDetails = isBanned
		? { reason: candidate?.reason ?? null, until: candidate?.until ?? null }
		: undefined;

	return { message, banDetails };
}

/**
 * Translate the server's machine-readable error codes into a sentence
 * the operator/player can read. Unknown codes fall through as-is so
 * custom backends still surface something.
 */
function humanizeAuthError(code: string | undefined | null): string {
	if (!code) { return 'Sign-in failed.'; }
	switch (code) {
		case 'banned':                return 'Your account is banned.';
		case 'invalid_credentials':   return 'Invalid email or password.';
		case 'email_already_in_use':  return 'Email already in use.';
		case 'email_malformed':       return 'Invalid email address.';
		case 'password_too_short':    return 'Password is too short.';
		case 'cancelled':             return 'Sign-in cancelled.';
		default:                      return code;
	}
}

/**
 * Render the `until` value from the banned payload in the viewer's
 * locale. Accepts ISO strings (HTTP wire format) and Date instances.
 * Year 9999 is the service's "permanent" sentinel — say so
 * explicitly rather than dumping a useless date string.
 */
function formatUntil(value: string | Date): string {
	const d = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(d.getTime())) { return String(value); }
	if (d.getUTCFullYear() >= 9999) { return 'permanent'; }
	return d.toLocaleString();
}

/** Shared red-tinted error block. `null` renders nothing. */
function AuthErrorMessage({ error }: { error: AuthErrorState }) {
	if (!error) { return null; }
	const { message, banDetails } = error;
	const hasBanDetails = banDetails && (banDetails.reason || banDetails.until);
	return (
		<div className="mt-1.5 bg-red-100 dark:bg-red-900/30 rounded p-1.5 text-red-900 dark:text-red-200 text-xs border border-red-200 dark:border-red-800">
			<div>{message}</div>
			{hasBanDetails && (
				<div className="mt-1 space-y-0.5 opacity-80">
					{banDetails!.reason && <div>Reason: {banDetails!.reason}</div>}
					{banDetails!.until && <div>Until: {formatUntil(banDetails!.until)}</div>}
				</div>
			)}
		</div>
	);
}
