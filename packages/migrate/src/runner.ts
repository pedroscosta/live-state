import * as fs from "node:fs";
import * as path from "node:path";
import { glob } from "tinyglobby";
import type {
	Migration,
	MigrationRunResult,
	RunOptions,
} from "./types.js";

const DEFAULT_INCLUDE = ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"];
const DEFAULT_EXCLUDE = [
	"**/node_modules/**",
	"**/dist/**",
	"**/build/**",
	"**/.next/**",
	"**/coverage/**",
];

export async function runMigration(
	migration: Migration,
	options: Partial<RunOptions> = {}
): Promise<MigrationRunResult> {
	const opts: RunOptions = {
		cwd: options.cwd || process.cwd(),
		include: options.include || DEFAULT_INCLUDE,
		exclude: options.exclude || DEFAULT_EXCLUDE,
		dryRun: options.dryRun ?? false,
		verbose: options.verbose ?? false,
	};

	const result: MigrationRunResult = {
		modifiedFiles: [],
		skippedFiles: [],
		totalChanges: 0,
		warnings: [],
		errors: [],
	};

	// Find all matching files
	const files = await glob(opts.include, {
		cwd: opts.cwd,
		ignore: opts.exclude,
		absolute: true,
	});

	for (const filePath of files) {
		try {
			const content = fs.readFileSync(filePath, "utf-8");
			const migrationResult = migration.migrate(content, filePath);

			if (migrationResult.modified) {
				if (!opts.dryRun) {
					fs.writeFileSync(filePath, migrationResult.content, "utf-8");
				}
				result.modifiedFiles.push(path.relative(opts.cwd, filePath));
				result.totalChanges += migrationResult.changes.length;

				if (opts.verbose) {
					for (const change of migrationResult.changes) {
						console.log(`  ${change}`);
					}
				}
			} else {
				result.skippedFiles.push(path.relative(opts.cwd, filePath));
			}

			for (const warning of migrationResult.warnings) {
				result.warnings.push({
					file: path.relative(opts.cwd, filePath),
					message: warning,
				});
			}
		} catch (error) {
			result.errors.push({
				file: path.relative(opts.cwd, filePath),
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return result;
}

export async function runMigrations(
	migrations: Migration[],
	options: Partial<RunOptions> = {}
): Promise<MigrationRunResult> {
	const combinedResult: MigrationRunResult = {
		modifiedFiles: [],
		skippedFiles: [],
		totalChanges: 0,
		warnings: [],
		errors: [],
	};

	for (const migration of migrations) {
		const result = await runMigration(migration, options);

		combinedResult.modifiedFiles.push(...result.modifiedFiles);
		combinedResult.totalChanges += result.totalChanges;
		combinedResult.warnings.push(...result.warnings);
		combinedResult.errors.push(...result.errors);
	}

	// Deduplicate modified files
	combinedResult.modifiedFiles = Array.from(new Set(combinedResult.modifiedFiles));

	return combinedResult;
}
