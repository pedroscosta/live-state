import { IDBPDatabase, openDB } from "idb";
import { DefaultMutationMessage } from "../../core/schemas/web-socket";
import { Schema } from "../../schema";
import { hash } from "../../utils";

const META_KEY = "__meta";
const DATABASES_KEY = "databases";

export class KVStorage {
  private db?: IDBPDatabase<Record<string, DefaultMutationMessage["payload"]>>;

  public async init(schema: Schema<any>, name: string) {
    if (typeof window === "undefined") return;

    const dbs = await window.indexedDB.databases();

    let dbVersion = dbs.find((db) => db.name === name)?.version ?? 1;

    const schemaHash = await hash(schema);

    const objectHashes: Record<string, string> = Object.fromEntries(
      await Promise.all(
        Object.entries(schema).map(async ([key, value]) => [
          key,
          await hash(value),
        ])
      )
    );

    const metaDb = await openDB("live-state-databases", 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(DATABASES_KEY))
          db.createObjectStore(DATABASES_KEY);
      },
    });

    const databaseInfo = (
      await this.getAll<{
        schemaHash: string;
        objectHashes: Record<string, string>;
      }>(metaDb, DATABASES_KEY)
    )?.[name];

    if (databaseInfo?.schemaHash !== schemaHash) {
      dbVersion++;
    }

    this.db = await openDB(name, dbVersion, {
      async upgrade(db) {
        [...Object.keys(schema), META_KEY].forEach((k) => {
          if (databaseInfo?.objectHashes[k] !== objectHashes[k])
            db.deleteObjectStore(k);

          if (!db.objectStoreNames.contains(k)) db.createObjectStore(k);
        });
        await metaDb.put(DATABASES_KEY, { schemaHash, objectHashes }, name);
      },
      blocking() {
        // TODO: properly handle this
        window.location.reload();
      },
      blocked() {
        // TODO: properly handle this
        window.location.reload();
      },
    });
  }

  public async get(
    resourceType: string
  ): Promise<Record<string, DefaultMutationMessage["payload"]>> {
    return (await this.getAll(this.db, resourceType)) ?? {};
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

  private async getAll<T = any>(
    db: IDBPDatabase<any> | undefined,
    storeName: string
  ): Promise<Record<string, T> | undefined> {
    if (!db) return undefined;

    if ((db as any).getAllRecords) return (db as any).getAllRecords(storeName);

    const [allValues, allKeys] = await Promise.all([
      db.getAll(storeName),
      db.getAllKeys(storeName),
    ]);

    return Object.fromEntries(
      allValues.map((v, i) => [allKeys[i], v])
    ) as Record<string, T>;
  }
}
