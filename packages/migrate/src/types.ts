export interface Migration {
	/** Unique identifier for this migration */
	id: string;
	/** Human-readable name */
	name: string;
	/** Description of what this migration does */
	description: string;
	/** Version this migration upgrades from */
	fromVersion: string;
	/** Version this migration upgrades to */
	toVersion: string;
	/** Run the migration on a file's content */
	migrate: (content: string, filePath: string) => MigrationResult;
}

export interface MigrationResult {
	/** Whether the file was modified */
	modified: boolean;
	/** The new content (if modified) */
	content: string;
	/** List of changes made */
	changes: string[];
	/** Any warnings */
	warnings: string[];
}

export interface MigrationRunResult {
	/** Files that were modified */
	modifiedFiles: string[];
	/** Files that were skipped */
	skippedFiles: string[];
	/** Total changes made */
	totalChanges: number;
	/** All warnings */
	warnings: { file: string; message: string }[];
	/** Any errors */
	errors: { file: string; message: string }[];
}

export interface RunOptions {
	/** Directory to run migrations in */
	cwd: string;
	/** Glob patterns for files to include */
	include: string[];
	/** Glob patterns for files to exclude */
	exclude: string[];
	/** Dry run - don't write changes */
	dryRun: boolean;
	/** Verbose output */
	verbose: boolean;
}
