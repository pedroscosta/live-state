import type { ReactNode } from 'react';

export default function Layout({ children }: { children: ReactNode }) {
	return (
		<div className="flex flex-col w-screen overflow-x-hidden">
			<div className="flex flex-col max-w-7xl w-full mx-auto">{children}</div>
		</div>
	);
}
