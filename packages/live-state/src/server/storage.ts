import { LiveObjectAny, MaterializedLiveType } from "../schema";

export abstract class Storage {
  public abstract updateSchema(opts: {
    entities: LiveObjectAny[];
  }): Promise<void>;
  public abstract find<T extends LiveObjectAny>(
    resourceId: string,
    where?: Record<string, any>
  ): Promise<Record<string, MaterializedLiveType<T>>>;
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

  public async find<T extends LiveObjectAny>(
    resourceId: string,
    where?: Record<string, any>
  ): Promise<Record<string, MaterializedLiveType<T>>> {
    return (this.storage[resourceId] ?? {}) as Record<
      string,
      MaterializedLiveType<T>
    >;
  }
}
