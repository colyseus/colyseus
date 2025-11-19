import { useState, useRef, useEffect, ReactNode } from "react";

interface ResizableSidebarProps {
	children: ReactNode;
	defaultWidth?: number;
	minWidth?: number;
	maxWidth?: number;
	className?: string;
	storageKey?: string; // Unique key for localStorage caching
}

export function ResizableSidebar({
	children,
	defaultWidth = 320,
	minWidth = 280,
	maxWidth = 800,
	className = "",
	storageKey,
}: ResizableSidebarProps) {
	// Load cached width from localStorage if available
	const getInitialWidth = () => {
		if (storageKey) {
			const cached = localStorage.getItem(storageKey);
			if (cached) {
				const width = parseInt(cached, 10);
				// Ensure cached width is within bounds
				if (width >= minWidth && width <= maxWidth) {
					return width;
				}
			}
		}
		return defaultWidth;
	};

	const [sidebarWidth, setSidebarWidth] = useState(getInitialWidth);
	const [isResizing, setIsResizing] = useState(false);
	const sidebarRef = useRef<HTMLDivElement>(null);
	const startXRef = useRef<number>(0);
	const startWidthRef = useRef<number>(0);

	const handleMouseDown = (e: React.MouseEvent) => {
		e.preventDefault();
		startXRef.current = e.clientX;
		startWidthRef.current = sidebarWidth;
		setIsResizing(true);
	};

	const handleMouseMove = (e: MouseEvent) => {
		if (!isResizing) return;

		const deltaX = e.clientX - startXRef.current;
		const newWidth = startWidthRef.current + deltaX;

		// Set min and max width constraints
		if (newWidth >= minWidth && newWidth <= maxWidth) {
			setSidebarWidth(newWidth);
		}
	};

	const handleMouseUp = () => {
		setIsResizing(false);
	};

	const handleDoubleClick = () => {
		setSidebarWidth(defaultWidth);
	};

	// Save width to localStorage when it changes
	useEffect(() => {
		if (storageKey) {
			localStorage.setItem(storageKey, sidebarWidth.toString());
		}
	}, [sidebarWidth, storageKey]);

	// Add/remove event listeners for resizing
	useEffect(() => {
		if (isResizing) {
			document.addEventListener('mousemove', handleMouseMove);
			document.addEventListener('mouseup', handleMouseUp);
			document.body.style.cursor = 'col-resize';
			document.body.style.userSelect = 'none';
		} else {
			document.removeEventListener('mousemove', handleMouseMove);
			document.removeEventListener('mouseup', handleMouseUp);
			document.body.style.cursor = '';
			document.body.style.userSelect = '';
		}

		return () => {
			document.removeEventListener('mousemove', handleMouseMove);
			document.removeEventListener('mouseup', handleMouseUp);
			document.body.style.cursor = '';
			document.body.style.userSelect = '';
		};
	}, [isResizing]);

	return (
		<>
			{/* Sidebar */}
			<div
				ref={sidebarRef}
				className={className}
				style={{ width: `${sidebarWidth}px` }}
			>
				{children}
			</div>

			{/* Resize handle */}
			<div
				className={`w-1 cursor-col-resize transition-colors relative ${
					isResizing
						? 'bg-purple-500'
						: 'bg-gray-200 dark:bg-slate-600 hover:bg-purple-500/50 dark:hover:bg-purple-400/50 duration-400 transition-colors'
				}`}
				onMouseDown={handleMouseDown}
				onDoubleClick={handleDoubleClick}
				style={{ userSelect: 'none' }}
				title="Double-click to restore default width"
			>
				{/* Invisible wider hit area for easier grabbing */}
				<div className="absolute inset-y-0 -left-1 -right-1" />
			</div>
		</>
	);
}

