export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue };

export type PublicErrorOptions<
	TCode extends string = string,
	TDetails extends JsonValue = JsonValue,
> = {
	code: TCode;
	message: string;
	status?: number;
	details?: TDetails;
};

export type SerializedPublicError = {
	code: string;
	message: string;
	status: number;
	details?: JsonValue;
};

export type ErrorEnvelope = {
	error: SerializedPublicError;
};

const PUBLIC_ERROR_MARKER = Symbol.for('@live-state/sync/PublicError');

export class PublicError<
	TCode extends string = string,
	TDetails extends JsonValue = JsonValue,
> extends Error {
	readonly code: TCode;
	readonly status: number;
	readonly details?: TDetails;
	readonly [PUBLIC_ERROR_MARKER] = true;

	constructor(options: PublicErrorOptions<TCode, TDetails>) {
		super(options.message);
		const status = options.status ?? 400;
		if (!Number.isInteger(status) || status < 400 || status > 599) {
			throw new RangeError(
				'PublicError status must be an integer from 400 to 599',
			);
		}
		this.name = 'PublicError';
		this.code = options.code;
		this.status = status;
		this.details = options.details;
	}
}

export const isPublicError = (error: unknown): error is PublicError =>
	typeof error === 'object' &&
	error !== null &&
	PUBLIC_ERROR_MARKER in error &&
	(error as PublicError)[PUBLIC_ERROR_MARKER] === true;

export const serializePublicError = (error: unknown): SerializedPublicError => {
	if (isPublicError(error)) {
		return {
			code: error.code,
			message: error.message,
			status: error.status,
			...(error.details === undefined ? {} : { details: error.details }),
		};
	}

	return {
		code: 'INTERNAL_SERVER_ERROR',
		message: 'Internal server error',
		status: 500,
	};
};

export const deserializePublicError = (
	error: SerializedPublicError,
): PublicError => new PublicError(error);

export const isErrorEnvelope = (value: unknown): value is ErrorEnvelope => {
	if (typeof value !== 'object' || value === null || !('error' in value)) {
		return false;
	}

	const error = (value as { error?: unknown }).error;
	return (
		typeof error === 'object' &&
		error !== null &&
		typeof (error as SerializedPublicError).code === 'string' &&
		typeof (error as SerializedPublicError).message === 'string' &&
		typeof (error as SerializedPublicError).status === 'number'
	);
};
