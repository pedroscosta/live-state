import { ulid } from "ulid";

export const generateId = () => ulid().toLowerCase();

export type Promisify<T> = T extends Promise<any> ? T : Promise<T>;
