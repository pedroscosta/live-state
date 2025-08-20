import { IDBPDatabase, openDB } from "idb";
import { DefaultMutationMessage } from "../../core/schemas/web-socket";
import { Schema } from "../../schema";

const META_KEY = "__meta";

export class KVStorage {
  private db?: IDBPDatabase<Record<string, DefaultMutationMessage["payload"]>>;

  public async init(schema: Schema<any>, name: string) {
    if (typeof window === "undefined") return;

    this.db = await openDB(name, 1, {
      upgrade(db) {
        Object.keys(schema).forEach((k) => db.createObjectStore(k));
        db.createObjectStore(META_KEY);
      },
    });
  }

  public async get(
    resourceType: string
  ): Promise<Record<string, DefaultMutationMessage["payload"]>> {
    if (!this.db) return {};
    if ((this.db as any).getAllRecords)
      return (this.db as any).getAllRecords(resourceType);

    const [allValues, allKeys] = await Promise.all([
      this.db!.getAll(resourceType),
      this.db!.getAllKeys(resourceType),
    ]);

    return Object.fromEntries(allValues.map((v, i) => [allKeys[i], v]));
  }

  public getOne(
    resourceType: string,
    id: string
  ): Promise<DefaultMutationMessage["payload"] | undefined> {
    if (!this.db) return new Promise((resolve) => resolve(undefined));

    return this.db.get(resourceType, id);
  }

  public set(
    resourceType: string,
    id: string,
    value: DefaultMutationMessage["payload"]
  ) {
    return this.db?.put(resourceType, value, id);
  }

  public delete(resourceType: string, id: string) {
    return this.db?.delete(resourceType, id);
  }

  public getMeta<T = unknown>(key: string): Promise<T | undefined> {
    if (!this.db) return new Promise((resolve) => resolve(undefined));
    return this.db.get(META_KEY, key);
  }

  public setMeta<T>(key: string, value: T) {
    return this.db?.put(META_KEY, value, key);
  }
}
