import type { Migration } from "../types.js";
import { includesSyntaxMigration } from "./v0.0.7-include-syntax.js";

/**
 * All available migrations, ordered by version
 */
export const migrations: Migration[] = [includesSyntaxMigration];

/**
 * Get a migration by ID
 */
export function getMigration(id: string): Migration | undefined {
	return migrations.find((m) => m.id === id);
}

/**
 * Get all migrations between two versions
 */
export function getMigrationsBetween(
	fromVersion: string,
	toVersion: string
): Migration[] {
	return migrations.filter((m) => {
		const from = parseVersion(m.fromVersion);
		const to = parseVersion(m.toVersion);
		const targetFrom = parseVersion(fromVersion);
		const targetTo = parseVersion(toVersion);

		return (
			compareVersions(from, targetFrom) >= 0 &&
			compareVersions(to, targetTo) <= 0
		);
	});
}

function parseVersion(version: string): number[] {
	return version.split(".").map((n) => Number.parseInt(n, 10));
}

function compareVersions(a: number[], b: number[]): number {
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const aVal = a[i] || 0;
		const bVal = b[i] || 0;
		if (aVal < bVal) return -1;
		if (aVal > bVal) return 1;
	}
	return 0;
}
