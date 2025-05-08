import { useLiveQuery } from "@live-state/sync/client";
import { Button } from "../../components/ui/button";
import { store } from "./live-client";

export const Card = ({ cardId }: { cardId: string }) => {
  const card = useLiveQuery(store.cards[cardId]);

  return (
    <div className="flex flex-col gap-4 border p-4 w-full shrink-0">
      <h2 className="">{card.name}</h2>
      <div className="flex gap-2 items-center">
        <p className="text-lg border bg-muted p-2 rounded-lg">{card.counter}</p>
        <Button
          onClick={() =>
            store.cards.update(cardId, { counter: card.counter + 1 })
          }
        >
          +
        </Button>
        <Button
          onClick={() =>
            store.cards.update(cardId, { counter: card.counter - 1 })
          }
        >
          -
        </Button>
      </div>
    </div>
  );
};
