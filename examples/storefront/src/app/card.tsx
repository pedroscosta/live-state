import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useLiveQuery } from "@live-state/sync/client";
import { GripVertical } from "lucide-react";
import { Button } from "../../components/ui/button";
import { store } from "./live-client";

const DragHandle = ({ dragHandleProps }: { dragHandleProps: any }) => (
  <div
    className="p-1 -ml-2 mr-1 rounded hover:bg-gray-200 transition-colors cursor-grab active:cursor-grabbing"
    {...dragHandleProps}
  >
    <GripVertical className="w-4 h-4 text-gray-500" />
  </div>
);

export const Card = ({
  cardId,
  isDragging = false,
}: {
  cardId: string;
  isDragging?: boolean;
}) => {
  const card = useLiveQuery(store.query.cards.where({ id: cardId }))?.[0];
  const {
    setNodeRef,
    transform,
    isDragging: isBeingDragged,
    attributes,
    listeners,
  } = useDraggable({
    id: cardId,
    data: {
      type: "card",
      card: { ...card },
    },
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isBeingDragged ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex flex-col gap-4 border p-4 w-full shrink-0"
    >
      <div className="flex items-center">
        <DragHandle dragHandleProps={{ ...listeners, ...attributes }} />
        <h2 className="flex-1">{card.name}</h2>
      </div>

      <div className="flex gap-2 items-center">
        <p className="text-lg border bg-muted p-2 rounded-lg">{card.counter}</p>
        <Button
          onClick={() => {
            store.mutate.cards.update(cardId, {
              counter: card.counter + 1,
            });
          }}
        >
          +
        </Button>
        <Button
          onClick={() => {
            store.mutate.cards.update(cardId, {
              counter: card.counter - 1,
            });
          }}
        >
          -
        </Button>
      </div>
    </div>
  );
};
