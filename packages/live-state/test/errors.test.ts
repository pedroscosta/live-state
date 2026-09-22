import { describe, expect, test } from 'vitest';
import { svRejectMsgSchema } from '../src/core/schemas/web-socket';
import { isErrorEnvelope } from '../src/errors';

const errorEnvelope = (status: number) => ({
	error: {
		code: 'TEST_ERROR',
		message: 'Test error',
		status,
	},
});

describe('public error validation', () => {
	test.each([400, 499, 599])('accepts status %i', (status) => {
		expect(isErrorEnvelope(errorEnvelope(status))).toBe(true);
		expect(
			svRejectMsgSchema.safeParse({
				id: 'message-1',
				type: 'REJECT',
				resource: 'posts',
				...errorEnvelope(status),
			}).success,
		).toBe(true);
	});

	test.each([399, 400.5, 600])('rejects status %s', (status) => {
		expect(isErrorEnvelope(errorEnvelope(status))).toBe(false);
		expect(
			svRejectMsgSchema.safeParse({
				id: 'message-1',
				type: 'REJECT',
				resource: 'posts',
				...errorEnvelope(status),
			}).success,
		).toBe(false);
	});
});
