import { useEffect, useState } from "react";

import { ItemDetail } from "@/components/ItemDetail";
import { ItemEditor } from "@/components/ItemEditor";
import { ItemList } from "@/components/ItemList";
import { GeneratorDialog } from "@/components/GeneratorDialog";
import { useApp } from "@/lib/app-context";
import type { ItemType, TypedItem } from "@/lib/types";

export function VaultPage() {
  const { filter } = useApp();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<TypedItem | null>(null);
  const [initialType, setInitialType] = useState<ItemType>("login");
  const [generatorOpen, setGeneratorOpen] = useState(false);

  const openNew = () => {
    setEditing(null);
    setInitialType(filter === "secure_note" ? "secure_note" : filter === "card" ? "card" : filter === "identity" ? "identity" : filter === "custom" ? "custom" : "login");
    setEditorOpen(true);
  };

  useEffect(() => {
    const newItem = () => openNew();
    const generator = () => setGeneratorOpen(true);
    window.addEventListener("acuye:new-item", newItem);
    window.addEventListener("acuye:generator", generator);
    return () => {
      window.removeEventListener("acuye:new-item", newItem);
      window.removeEventListener("acuye:generator", generator);
    };
  });

  return (
    <div className="flex min-h-0 flex-1">
      <ItemList onAdd={openNew} />
      <ItemDetail
        onEdit={(item) => {
          setEditing(item);
          setEditorOpen(true);
        }}
      />
      <ItemEditor
        open={editorOpen}
        onOpenChange={(open) => {
          setEditorOpen(open);
          if (!open) setEditing(null);
        }}
        item={editing}
        initialType={initialType}
      />
      <GeneratorDialog open={generatorOpen} onOpenChange={setGeneratorOpen} />
    </div>
  );
}
