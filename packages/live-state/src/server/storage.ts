import { LiveObjectAny, MaterializedLiveType, Schema } from "../schema";

export abstract class Storage {
  public abstract updateSchema(opts: Schema<any>): Promise<void>;

  public abstract findById<T extends LiveObjectAny>(
    resourceName: string,
    id: string
  ): Promise<MaterializedLiveType<T> | undefined>;

  public abstract find<T extends LiveObjectAny>(
    resourceName: string,
    where?: Record<string, any>
  ): Promise<Record<string, MaterializedLiveType<T>>>;

  public abstract upsert<T extends LiveObjectAny>(
    resourceName: string,
    resourceId: string,
    value: MaterializedLiveType<T>
  ): Promise<MaterializedLiveType<T>>;
}

export class InMemoryStorage extends Storage {
  private storage: Record<string, Record<string, any>> = {};

  public async updateSchema(opts: Schema<any>): Promise<void> {
    console.log("Updating schema", opts);
    this.storage = Object.entries(opts).reduce(
      (acc, [_, entity]) => {
        acc[entity.name] = {};
        return acc;
      },
      {} as typeof this.storage
    );
  }

  public async findById<T extends LiveObjectAny>(
    resourceName: string,
    id: string
  ): Promise<MaterializedLiveType<T> | undefined> {
    return this.storage[resourceName]?.[id] as MaterializedLiveType<T>;
  }

  public async find<T extends LiveObjectAny>(
    resourceName: string,
    where?: Record<string, any>
  ): Promise<Record<string, MaterializedLiveType<T>>> {
    // TODO implement where conditions

    return (this.storage[resourceName] ?? {}) as Record<
      string,
      MaterializedLiveType<T>
    >;
  }

  public async upsert<T extends LiveObjectAny>(
    resourceName: string,
    resourceId: string,
    value: MaterializedLiveType<T>
  ): Promise<MaterializedLiveType<T>> {
    this.storage[resourceName] ??= {};

    this.storage[resourceName][resourceId] = value;

    return value;
  }
}
