import pc from "picocolors";
import { migrations, getMigration } from "./migrations/index.js";
import { runMigration, runMigrations } from "./runner.js";

const VERSION = "0.0.1";

interface CliOptions {
	dryRun: boolean;
	verbose: boolean;
	cwd: string;
}

function printHelp(): void {
	console.log(`
${pc.bold("@live-state/migrate")} - Migration tool for @live-state/sync

${pc.bold("USAGE")}
  ${pc.cyan("live-state-migrate")} ${pc.dim("<command>")} ${pc.dim("[options]")}

${pc.bold("COMMANDS")}
  ${pc.cyan("list")}                    List all available migrations
  ${pc.cyan("run")} ${pc.dim("<migration-id>")}     Run a specific migration
  ${pc.cyan("run-all")}                 Run all migrations
  ${pc.cyan("help")}                    Show this help message

${pc.bold("OPTIONS")}
  ${pc.cyan("--dry-run")}               Preview changes without writing files
  ${pc.cyan("--verbose")}               Show detailed output
  ${pc.cyan("--cwd")} ${pc.dim("<path>")}            Working directory (default: current)

${pc.bold("EXAMPLES")}
  ${pc.dim("# List available migrations")}
  ${pc.cyan("live-state-migrate list")}

  ${pc.dim("# Run a specific migration (dry run)")}
  ${pc.cyan("live-state-migrate run v0.0.7-include-syntax --dry-run")}

  ${pc.dim("# Run all migrations")}
  ${pc.cyan("live-state-migrate run-all")}
`);
}

function printVersion(): void {
	console.log(`@live-state/migrate v${VERSION}`);
}

function listMigrations(): void {
	console.log(`\n${pc.bold("Available Migrations:")}\n`);

	for (const migration of migrations) {
		console.log(`  ${pc.cyan(migration.id)}`);
		console.log(`    ${pc.dim("Name:")} ${migration.name}`);
		console.log(`    ${pc.dim("Description:")} ${migration.description}`);
		console.log(
			`    ${pc.dim("Upgrades:")} ${migration.fromVersion} → ${migration.toVersion}`
		);
		console.log();
	}
}

function parseArgs(args: string[]): {
	command: string;
	migrationId?: string;
	options: CliOptions;
} {
	const options: CliOptions = {
		dryRun: false,
		verbose: false,
		cwd: process.cwd(),
	};

	let command = "";
	let migrationId: string | undefined;
	const positional: string[] = [];

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];

		if (arg === "--dry-run") {
			options.dryRun = true;
		} else if (arg === "--verbose" || arg === "-v") {
			options.verbose = true;
		} else if (arg === "--cwd") {
			options.cwd = args[++i] || process.cwd();
		} else if (arg === "--help" || arg === "-h") {
			command = "help";
		} else if (arg === "--version") {
			command = "version";
		} else if (!arg.startsWith("-")) {
			positional.push(arg);
		}
	}

	if (positional.length > 0) {
		command = command || positional[0];
		migrationId = positional[1];
	}

	return { command, migrationId, options };
}

async function runCommand(
	command: string,
	migrationId: string | undefined,
	options: CliOptions
): Promise<void> {
	switch (command) {
		case "list":
			listMigrations();
			break;

		case "run": {
			if (!migrationId) {
				console.error(
					pc.red("Error: Please specify a migration ID to run")
				);
				console.log(
					pc.dim("Use 'live-state-migrate list' to see available migrations")
				);
				process.exit(1);
			}

			const migration = getMigration(migrationId);
			if (!migration) {
				console.error(pc.red(`Error: Migration '${migrationId}' not found`));
				console.log(
					pc.dim("Use 'live-state-migrate list' to see available migrations")
				);
				process.exit(1);
			}

			console.log(
				`\n${pc.bold("Running migration:")} ${pc.cyan(migration.id)}`
			);
			console.log(`${pc.dim(migration.description)}\n`);

			if (options.dryRun) {
				console.log(pc.yellow("DRY RUN - No files will be modified\n"));
			}

			const result = await runMigration(migration, {
				cwd: options.cwd,
				dryRun: options.dryRun,
				verbose: options.verbose,
			});

			printResult(result, options.dryRun);
			break;
		}

		case "run-all": {
			console.log(`\n${pc.bold("Running all migrations...")}\n`);

			if (options.dryRun) {
				console.log(pc.yellow("DRY RUN - No files will be modified\n"));
			}

			const result = await runMigrations(migrations, {
				cwd: options.cwd,
				dryRun: options.dryRun,
				verbose: options.verbose,
			});

			printResult(result, options.dryRun);
			break;
		}

		case "help":
			printHelp();
			break;

		case "version":
			printVersion();
			break;

		default:
			if (command) {
				console.error(pc.red(`Unknown command: ${command}`));
			}
			printHelp();
			process.exit(command ? 1 : 0);
	}
}

function printResult(
	result: Awaited<ReturnType<typeof runMigration>>,
	dryRun: boolean
): void {
	const verb = dryRun ? "would be modified" : "modified";

	if (result.modifiedFiles.length > 0) {
		console.log(
			pc.green(`\n✓ ${result.modifiedFiles.length} file(s) ${verb}:`)
		);
		for (const file of result.modifiedFiles) {
			console.log(`  ${pc.dim("•")} ${file}`);
		}
	} else {
		console.log(pc.dim("\nNo files needed migration."));
	}

	if (result.warnings.length > 0) {
		console.log(pc.yellow(`\n⚠ ${result.warnings.length} warning(s):`));
		for (const warning of result.warnings) {
			console.log(`  ${pc.dim("•")} ${warning.file}: ${warning.message}`);
		}
	}

	if (result.errors.length > 0) {
		console.log(pc.red(`\n✗ ${result.errors.length} error(s):`));
		for (const error of result.errors) {
			console.log(`  ${pc.dim("•")} ${error.file}: ${error.message}`);
		}
	}

	console.log();
}

// Main entry point
const args = process.argv.slice(2);
const { command, migrationId, options } = parseArgs(args);

runCommand(command, migrationId, options).catch((error) => {
	console.error(pc.red("Error:"), error.message);
	process.exit(1);
});
