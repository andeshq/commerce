import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CSSProperties, ReactNode, RefCallback } from "react";

type Strategy = "vertical" | "grid";

/**
 * Drag-and-drop reordering built on dnd-kit. `SortableList` owns the context;
 * each `SortableItem` hands its child the refs/styles and the drag-handle props.
 */
export function SortableList({
  ids,
  onReorder,
  strategy = "vertical",
  children,
}: {
  ids: string[];
  /** Source and destination indices of the completed drag. */
  onReorder(from: number, to: number): void;
  strategy?: Strategy;
  children: ReactNode;
}) {
  const sensors = useSensors(
    // A small distance so clicks on buttons/inputs inside an item still work.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    onReorder(from, to);
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext
        items={ids}
        strategy={strategy === "grid" ? rectSortingStrategy : verticalListSortingStrategy}
      >
        {children}
      </SortableContext>
    </DndContext>
  );
}

export interface SortableRenderProps {
  itemRef: RefCallback<HTMLElement>;
  itemStyle: CSSProperties;
  /** Spread onto the drag handle (a `<button>`); includes its own ref. */
  handleProps: Record<string, any>;
  isDragging: boolean;
}

export function SortableItem({
  id,
  children,
}: {
  id: string;
  children(props: SortableRenderProps): ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  return (
    <>
      {children({
        itemRef: setNodeRef,
        itemStyle: {
          transform: CSS.Transform.toString(transform),
          transition,
          opacity: isDragging ? 0.5 : undefined,
          position: isDragging ? "relative" : undefined,
          zIndex: isDragging ? 1 : undefined,
        },
        handleProps: { ref: setActivatorNodeRef, ...attributes, ...listeners },
        isDragging,
      })}
    </>
  );
}

/** Shared handle styling: a small, quiet grab affordance. */
export const dragHandleClass =
  "flex cursor-grab touch-none items-center justify-center rounded-md text-muted hover:text-foreground active:cursor-grabbing";
