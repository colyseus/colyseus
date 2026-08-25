import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlay, faStop, faDownload, faArrowUpRightFromSquare, faSpinner } from "@fortawesome/free-solid-svg-icons";

import { endpoint } from "../utils/Types";

type Phase = "idle" | "starting" | "recording" | "stopping" | "ready" | "error";

interface CPUProfilerProps {
	isRecording: boolean;
	setIsRecording: (v: boolean) => void;
	startedAt: number;
	setStartedAt: (v: number) => void;
}

function formatElapsed(ms: number) {
	if (ms < 0) { ms = 0; }
	const total = Math.floor(ms / 1000);
	const m = Math.floor(total / 60);
	const s = total % 60;
	return `${m}:${s.toString().padStart(2, "0")}`;
}

// Small live "● Recording m:ss" indicator, also rendered on the sidebar tab.
export function RecordingBadge({ startedAt, compact }: { startedAt: number; compact?: boolean }) {
	const [now, setNow] = useState(Date.now());
	useEffect(() => {
		const id = window.setInterval(() => setNow(Date.now()), 500);
		return () => window.clearInterval(id);
	}, []);
	return (
		<span className="inline-flex items-center text-red-600 dark:text-red-400">
			<span className="relative flex h-2.5 w-2.5">
				<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
				<span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-600" />
			</span>
			{!compact && <span className="ml-2 text-xs font-mono tabular-nums">{formatElapsed(now - startedAt)}</span>}
		</span>
	);
}

export function CPUProfiler({ isRecording, setIsRecording, startedAt, setStartedAt }: CPUProfilerProps) {
	const [phase, setPhase] = useState<Phase>("idle");
	const [error, setError] = useState<string | null>(null);
	const [hasReport, setHasReport] = useState(false);
	const [hasProfile, setHasProfile] = useState(false);
	const [samplingInterval, setSamplingInterval] = useState(100);
	const [reportVersion, setReportVersion] = useState(0);
	const [now, setNow] = useState(Date.now());
	// default true so the "not installed" banner only appears once status confirms it
	const [reportSupported, setReportSupported] = useState(true);
	const lastResult = useRef<{ durationMs: number; profileBytes: number } | null>(null);

	// Recover state on mount (e.g. after a page reload mid-recording).
	useEffect(() => {
		fetch(`${endpoint}/profiling/status`)
			.then((r) => r.json())
			.then((s) => {
				setHasProfile(!!s.hasProfile);
				setHasReport(!!s.hasReport);
				setReportSupported(s.reportSupported !== false);
				if (s.running) {
					setIsRecording(true);
					setStartedAt(s.startedAt || Date.now());
					setPhase("recording");
				} else if (s.hasReport || s.hasProfile) {
					setReportVersion((v) => v + 1);
					setPhase("ready");
					if (s.error) { setError(s.error); }
				}
			})
			.catch(() => { /* server offline — leave idle */ });
	}, []);

	// Live elapsed timer while recording.
	useEffect(() => {
		if (!isRecording) { return; }
		const id = window.setInterval(() => setNow(Date.now()), 500);
		return () => window.clearInterval(id);
	}, [isRecording]);

	const start = async () => {
		setPhase("starting");
		setError(null);
		try {
			const res = await fetch(`${endpoint}/profiling/start?interval=${samplingInterval}`, { method: "POST" });
			const data = await res.json();
			if (data.error && data.status !== "running") { throw new Error(data.error); }
			setIsRecording(true);
			setStartedAt(data.startedAt || Date.now());
			setHasReport(false);
			setHasProfile(false);
			setPhase("recording");
		} catch (e: any) {
			setPhase("error");
			setError(e?.message || "failed to start profiling");
		}
	};

	const stop = async () => {
		setPhase("stopping");
		try {
			const res = await fetch(`${endpoint}/profiling/stop`, { method: "POST" });
			const data = await res.json();
			setIsRecording(false);
			lastResult.current = { durationMs: data.durationMs, profileBytes: data.profileBytes };
			setHasProfile(!!data.profileBytes);
			setHasReport(!!data.reportReady);
			setError(data.error || null);
			setReportVersion((v) => v + 1);
			setPhase("ready");
		} catch (e: any) {
			setIsRecording(false);
			setPhase("error");
			setError(e?.message || "failed to stop profiling");
		}
	};

	const reportUrl = `${endpoint}/profiling/report.html?v=${reportVersion}`;
	const profileUrl = `${endpoint}/profiling/profile.cpuprofile?v=${reportVersion}`;
	const busy = phase === "starting" || phase === "stopping";

	return (
		<div className="h-full flex flex-col">
			{/* Control bar */}
			<div className="flex flex-wrap items-center gap-3 p-4 border-b border-gray-200 dark:border-slate-700">
				{!isRecording ? (
					<button
						onClick={start}
						disabled={busy}
						className="inline-flex items-center px-4 py-2 rounded-lg text-sm font-medium bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
					>
						<FontAwesomeIcon icon={busy ? faSpinner : faPlay} spin={busy} className="mr-2" />
						{phase === "starting" ? "Starting…" : "Start profiling"}
					</button>
				) : (
					<button
						onClick={stop}
						disabled={busy}
						className="inline-flex items-center px-4 py-2 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
					>
						<FontAwesomeIcon icon={phase === "stopping" ? faSpinner : faStop} spin={phase === "stopping"} className="mr-2" />
						{phase === "stopping" ? "Generating report…" : "Stop profiling"}
					</button>
				)}

				{isRecording && (
					<span className="inline-flex items-center text-sm text-red-600 dark:text-red-400">
						<RecordingBadge startedAt={startedAt} />
						<span className="ml-2 text-gray-500 dark:text-slate-400">recording — switch to Rooms to generate load</span>
					</span>
				)}

				{!isRecording && phase === "ready" && hasReport && (
					<button
						onClick={() => window.open(reportUrl, "_blank")}
						className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-800"
					>
						<FontAwesomeIcon icon={faArrowUpRightFromSquare} className="mr-2" />
						Open report in new tab
					</button>
				)}
				{!isRecording && phase === "ready" && hasProfile && (
					<a
						href={profileUrl}
						download="profile.cpuprofile"
						className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800"
					>
						<FontAwesomeIcon icon={faDownload} className="mr-2" />
						Download .cpuprofile
					</a>
				)}

				{!isRecording && (
					<div className="ml-auto flex items-center gap-3">
						{phase === "ready" && lastResult.current && (
							<span className="text-gray-500 dark:text-slate-400 text-xs">
								captured {(lastResult.current.profileBytes / 1024 / 1024).toFixed(1)} MB over {formatElapsed(lastResult.current.durationMs)}
							</span>
						)}
						<label className="inline-flex items-center text-xs text-gray-500 dark:text-slate-400">
							Sampling interval
							<input
								type="number"
								min={1}
								value={samplingInterval}
								onChange={(e) => setSamplingInterval(Number(e.target.value) || 100)}
								disabled={busy}
								className="ml-2 w-20 px-2 py-1 rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-800 dark:text-slate-200"
							/>
							<span className="ml-1">µs</span>
						</label>
					</div>
				)}
			</div>

			{/* cpupro not installed — proactive notice (shown before any capture) */}
			{!reportSupported && (
				<div className="m-4 bg-amber-100 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 py-2 px-3 rounded text-sm">
					<strong>Inline reports disabled:</strong> the optional <code className="font-mono">cpupro</code> package isn't installed.
					You can still capture and download the <code className="font-mono">.cpuprofile</code> (open it in Chrome DevTools or any V8 profile viewer).
					Run <code className="font-mono">npm install cpupro</code> on the server to render reports here.
				</div>
			)}

			{/* Error / status callouts */}
			{error && (
				<div className="m-4 bg-red-100 dark:bg-red-900/40 border border-red-300 dark:border-red-700 text-red-800 dark:text-red-200 py-2 px-3 rounded text-sm">
					<strong>Profiling error:</strong> {error}
					{hasProfile && !hasReport && " — the .cpuprofile is still available to download above."}
				</div>
			)}

			{/* Report viewer */}
			<div className="flex-1 overflow-hidden">
				{hasReport ? (
					<iframe key={reportVersion} src={reportUrl} title="cpupro report" className="w-full h-full border-0" />
				) : (
					<div className="h-full flex items-center justify-center text-center text-gray-400 dark:text-slate-500 px-6">
						{isRecording
							? <p>Recording… join and leave a few rooms in the <strong>Rooms</strong> tab, then come back and hit <strong>Stop</strong>.</p>
							: phase === "stopping"
								? <p>Generating cpupro report…</p>
								: reportSupported
									? <p>Press <strong>Start profiling</strong> to capture a CPU profile of the running server.<br/>The captured profile will be rendered here with cpupro.</p>
									: <p>Press <strong>Start profiling</strong> to capture a CPU profile of the running server.<br/>Install <code className="font-mono">cpupro</code> to render reports here, or download the <code className="font-mono">.cpuprofile</code> after stopping.</p>}
					</div>
				)}
			</div>
		</div>
	);
}
