export const Separator = ({
	variant = 'full',
}: {
	variant?: 'full' | 'outer';
}) => {
	return (
		<div className="w-full h-px relative">
			{variant === 'full' ? (
				<div className="h-px border-b border-dashed -left-[calc(50vw-50%)] w-screen absolute" />
			) : (
				<>
					<div className="h-px border-b border-dashed absolute right-full w-[50vw]" />
					<div className="h-px border-b border-dashed absolute left-full w-[50vw]" />
				</>
			)}
		</div>
	);
};
