import { useLiveQuery } from "@repo/live-state/client";
import { nanoid } from "nanoid";
import { memo } from "react";
import { Button } from "../../components/ui/button";
import { Card } from "./card";
import { store } from "./live-client";

const MemoItem = memo(Card);

export const Group = ({ groupId }: { groupId: string }) => {
  const group = useLiveQuery(store.groups[groupId]);

  return (
    <div className="flex flex-col gap-4 border p-4 w-sm shrink-0">
      <h2 className="">{group.name}</h2>
      {Object.values(group.cards ?? {}).map((card) => (
        <MemoItem key={card.id} cardId={card.id} />
      ))}
      <Button
        onClick={() => {
          store.cards.insert({
            id: nanoid(),
            name: "New Card",
            counter: 0,
            groupId: group.id,
          });
        }}
      >
        Add Card
      </Button>
    </div>
  );
};
