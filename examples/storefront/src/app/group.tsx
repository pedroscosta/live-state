import { useDroppable } from "@dnd-kit/core";
import { useLiveQuery } from "@live-state/sync/client";
import { memo } from "react";
import { ulid } from "ulid";
import { Button } from "../../components/ui/button";
import { Card } from "./card";
import { store } from "./live-client";

const MemoItem = memo(Card);

export const Group = ({ groupId }: { groupId: string }) => {
  const group = useLiveQuery(
    store.query.groups.one(groupId).include({
      cards: true,
    })
  );

  if (!group) return null;

  const { setNodeRef, isOver } = useDroppable({
    id: groupId,
    data: {
      type: "group",
      groupId: groupId,
    },
  });

  const groupStyle = {
    backgroundColor: isOver ? "rgba(0, 0, 0, 0.05)" : "transparent",
    transition: "background-color 0.2s ease",
  };

  return (
    <div
      ref={setNodeRef}
      className="flex flex-col gap-4 border p-4 w-sm shrink-0 rounded-lg"
      style={groupStyle}
    >
      <h2 className="">{group.name}</h2>
      {Object.values(group.cards ?? {}).map((card) => (
        <MemoItem key={card.id} cardId={card.id} />
      ))}
      <Button
        onClick={() => {
          store.mutate.cards.insert({
            id: ulid().toLowerCase(),
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
