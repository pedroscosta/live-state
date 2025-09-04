"use client";

import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
} from "@dnd-kit/core";
import { ReactNode, useState } from "react";
import { Card } from "./card";
import { store } from "./live-client";

export function DndProvider({ children }: { children: ReactNode }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeCard, setActiveCard] = useState<any>(null);

  function handleDragStart(event: DragStartEvent) {
    const { active } = event;
    setActiveId(active.id as string);
    setActiveCard(active.data.current?.card);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const newGroupId = over.id as string;
      const cardId = active.id as string;

      // Update the card's groupId in the store
      store.mutate.cards.update(cardId, { groupId: newGroupId });
    }

    setActiveId(null);
    setActiveCard(null);
  }

  return (
    <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      {children}
      <DragOverlay>
        {activeId && activeCard ? (
          <div className="opacity-70">
            <Card cardId={activeCard.id} isDragging />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
