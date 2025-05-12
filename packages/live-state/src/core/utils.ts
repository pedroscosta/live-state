import { ulid } from "ulid";

export const generateId = () => ulid().toLowerCase();
