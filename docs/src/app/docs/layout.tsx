'use client';

import type { PageTree } from 'fumadocs-core/server';
import { RootToggle } from 'fumadocs-ui/components/layout/root-toggle';
import { LargeSearchToggle } from 'fumadocs-ui/components/layout/search-toggle';
import {
	CollapsibleSidebar,
	Sidebar,
	SidebarFooter,
	SidebarHeader,
	SidebarPageTree as SidebarPageTreeOriginal,
	SidebarViewport,
} from 'fumadocs-ui/components/layout/sidebar';
import {
	CollapsibleControl,
	DocsLayout,
	DocsLayoutSidebarFooter,
	type LinkItemType,
} from 'fumadocs-ui/layouts/docs';
import {
	getSidebarTabsFromOptions,
	SidebarLinkItem,
	type SidebarOptions,
} from 'fumadocs-ui/layouts/docs/shared';
import { getLinks } from 'fumadocs-ui/layouts/shared';
import { type ReactNode, useMemo } from 'react';
import { docsOptions } from '@/app/layout.config';
import { cn } from '@/lib/utils';

const Separator = ({ item }: { item: PageTree.Separator }) => {
	return <div className="my-4 text-sm text-muted-foreground">{item.name}</div>;
};

export const SidebarPageTree = () => {
	return <SidebarPageTreeOriginal components={{ Separator }} />;
};

function DocsLayoutSidebar({
	collapsible = true,
	links = [],
	footer,
	banner,
	...props
}: Omit<SidebarOptions, 'tabs'> & {
	links?: LinkItemType[];
	nav?: ReactNode;
}) {
	const Aside = collapsible ? CollapsibleSidebar : Sidebar;

	return (
		<>
			{collapsible ? <CollapsibleControl /> : null}
			<Aside
				{...props}
				className={cn('md:ps-(--fd-layout-offset)', props.className)}
			>
				<SidebarHeader>
					{/* <div className="flex flex-row py-1.5 max-md:hidden">
            {nav}
            {collapsible && (
              <SidebarCollapseTrigger
                className={cn(
                  buttonVariants({
                    color: 'ghost',
                    size: 'icon-sm',
                  }),
                  'ms-auto mb-auto -my-1.5 text-fd-muted-foreground max-md:hidden',
                )}
              >
                <SidebarIcon />
              </SidebarCollapseTrigger>
            )}
          </div> */}
					{banner}
				</SidebarHeader>
				<SidebarViewport>
					<div className="mb-4 empty:hidden">
						{links
							.filter((v) => v.type !== 'icon')
							.map((item, i) => (
								<SidebarLinkItem key={i} item={item} />
							))}
					</div>
					<SidebarPageTree />
				</SidebarViewport>
				<SidebarFooter>{footer}</SidebarFooter>
			</Aside>
		</>
	);
}

export default function Layout({ children }: { children: ReactNode }) {
	const tabs = useMemo(
		() =>
			getSidebarTabsFromOptions(docsOptions.sidebar?.tabs, docsOptions.tree) ??
			[],
		[docsOptions.sidebar?.tabs, docsOptions.tree],
	);
	const links = getLinks(docsOptions.links ?? [], docsOptions.githubUrl);

	return (
		<DocsLayout
			{...docsOptions}
			// sidebar={{
			//   className: "[--fd-nav-height:56px] bg-background",
			//   collapsible: false,
			// }}
			sidebar={{
				component: (
					<DocsLayoutSidebar
						className="bg-background"
						// links={links}
						// nav={
						//   <>
						//     <Link
						//       href={nav.url ?? "/"}
						//       className="inline-flex text-[15px] items-center gap-2.5 font-medium"
						//     >
						//       {nav.title}
						//     </Link>
						//     {nav.children}
						//   </>
						// }
						banner={
							<>
								{tabs.length > 0 ? <RootToggle options={tabs} /> : null}
								<LargeSearchToggle
									hideIfDisabled
									className="rounded-lg max-md:hidden"
								/>
							</>
						}
						footer={
							<>
								<DocsLayoutSidebarFooter
									links={links?.filter((item) => item.type === 'icon')}
									i18n={docsOptions.i18n}
									themeSwitch={docsOptions.themeSwitch}
								/>
								{docsOptions.sidebar?.footer}
							</>
						}
					/>
				),
			}}
		>
			{children}
		</DocsLayout>
	);
}
