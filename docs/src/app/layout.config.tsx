import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import type { DocsLayoutProps } from '@/components/layout/docs';
import { source } from '@/lib/source';

/**
 * Shared layout configurations
 *
 * you can customise layouts individually from:
 * Home Layout: app/(home)/layout.tsx
 * Docs Layout: app/docs/layout.tsx
 */
export const baseOptions: BaseLayoutProps = {
	nav: {
		enabled: false,
	},
	links: [],
};

export const docsOptions: DocsLayoutProps = {
	...baseOptions,
	tree: source.pageTree,
	themeSwitch: { enabled: false },
};
