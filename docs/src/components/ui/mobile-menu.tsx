'use client';

import { Menu } from 'lucide-react';
import { Button } from './button';

export const MobileMenu = () => {
	return (
		<Button className="text-foreground/80 md:hidden" variant="ghost">
			<Menu className="size-5" />
		</Button>
	);
};
