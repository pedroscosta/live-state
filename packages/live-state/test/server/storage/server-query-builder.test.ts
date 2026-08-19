import { describe, expect, test, vi } from 'vitest';
import { createSchema, id, object, string } from '../../../src/schema';
import {
	createServerDB,
	type Storage,
} from '../../../src/server/storage';

const updateCollection = object('update', {
	id: id(),
	replicatedStr: string(),
});

const schema = createSchema({ update: updateCollection });

describe('createServerDB', () => {
	test('supports a collection named update alongside the legacy method', async () => {
		const get = vi
			.fn()
			.mockResolvedValue([{ id: 'update-1', replicatedStr: 'pending' }]);
		const rawUpdate = vi.fn().mockResolvedValue({
			data: {
				value: {
					replicatedStr: { value: 'done' },
				},
			},
			acceptedValues: {},
		});
		const storage = {
			get,
			_getTimestamp: vi.fn().mockReturnValue('2026-01-01T00:00:00.000Z'),
			rawUpdate,
		} as unknown as Storage;
		const db = createServerDB(storage, schema);

		expect(typeof db.update).toBe('function');
		await expect(db.update.one('update-1').get()).resolves.toEqual({
			id: 'update-1',
			replicatedStr: 'pending',
		});
		expect(get).toHaveBeenCalledWith(
			expect.objectContaining({
				resource: 'update',
				where: { id: 'update-1' },
				limit: 1,
			}),
		);

		await expect(
			db.update.update('update-1', { replicatedStr: 'done' }),
		).resolves.toEqual({ replicatedStr: 'done' });
		await expect(
			db.update(schema.update, 'update-1', { replicatedStr: 'legacy' }),
		).resolves.toEqual({ replicatedStr: 'done' });
		expect(rawUpdate).toHaveBeenCalledTimes(2);
	});
});
