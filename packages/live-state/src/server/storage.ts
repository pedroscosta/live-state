import { LiveObjectAny, MaterializedLiveType } from "../schema";

export abstract class Storage {
  public abstract updateSchema(opts: {
    entities: LiveObjectAny[];
  }): Promise<void>;

  public abstract findById<T extends LiveObjectAny>(
    resourceId: string,
    id: string
  ): Promise<MaterializedLiveType<T> | undefined>;

  public abstract find<T extends LiveObjectAny>(
    resourceId: string,
    where?: Record<string, any>
  ): Promise<Record<string, MaterializedLiveType<T>>>;

  public abstract insert<T extends LiveObjectAny>(
    resourceId: string,
    payload: MaterializedLiveType<T>
  ): Promise<MaterializedLiveType<T>>;
}

export class InMemoryStorage extends Storage {
  private storage: Record<string, Record<string, any>> = {};

  public async updateSchema(opts: {
    entities: LiveObjectAny[];
  }): Promise<void> {
    console.log("Updating schema", opts);
    this.storage = opts.entities.reduce(
      (acc, entity) => {
        acc[entity.name] = {};
        return acc;
      },
      {} as typeof this.storage
    );
  }

  public async findById<T extends LiveObjectAny>(
    resourceId: string,
    id: string
  ): Promise<MaterializedLiveType<T> | undefined> {
    return this.storage[resourceId]?.[id] as MaterializedLiveType<T>;
  }

  public async find<T extends LiveObjectAny>(
    resourceId: string,
    where?: Record<string, any>
  ): Promise<Record<string, MaterializedLiveType<T>>> {
    // TODO implement where conditions
    return (this.storage[resourceId] ?? {}) as Record<
      string,
      MaterializedLiveType<T>
    >;
  }

  public async insert<T extends LiveObjectAny>(
    resourceId: string,
    payload: MaterializedLiveType<T>
  ): Promise<MaterializedLiveType<T>> {
    if (!this.storage[resourceId]) this.storage[resourceId] = {};

    const id = (payload.value as unknown as { id: { value: string } }).id.value;

    if (await this.findById(resourceId, id))
      throw new Error("Resource already exists");

    this.storage[resourceId][id] = payload.value;

    return payload;
  }
}
