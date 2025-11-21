import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faInfoCircle } from "@fortawesome/free-solid-svg-icons";

interface CalloutProps {
	children: React.ReactNode;
	variant?: "default" | "simple";
}

export function Callout({ children, variant = "default" }: CalloutProps) {
	return (
		<div className="flex items-center gap-3 text-gray-400 dark:text-slate-500 bg-gray-100 dark:bg-slate-700/50 px-6 py-4 rounded-lg border border-gray-200 dark:border-slate-600">
			<FontAwesomeIcon icon={faInfoCircle} className="text-lg" />
			<p className="text-sm italic">{children}</p>
		</div>
	);
}

