'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

export const NavLink = ({
	href,
	children,
	className,
}: {
	href: string;
	children: React.ReactNode;
	className?: string;
}) => {
	const pathname = usePathname();
	return (
		<Link
			href={href}
			className={cn(
				'text-foreground/80 transition-colors hover:text-foreground',
				pathname.startsWith(href) && 'text-foreground border-b border-primary',
				className,
			)}
		>
			{children}
		</Link>
	);
};
