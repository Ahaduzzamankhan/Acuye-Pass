import { AnimatePresence, motion } from "motion/react";
import {
  Copy,
  CopyPlus,
  Plus,
  Search,
  Star,
  Trash2,
  User,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useApp, type VaultFilter } from "@/lib/app-context";
import { itemTypeLabel, type ItemSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "./dialog";
import { ItemAvatar } from "./item-avatar";
import { ContextMenu, type MenuAction } from "./menu";
import { Badge, Button, IconButton, Input } from "./ui";

const FILTERS: Array<{ value: VaultFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "favorites", label: "Favorites" },
  { value: "login", label: "Passwords" },
  { value: "secure_note", label: "Notes" },
  { value: "card", label: "Cards" },
  { value: "identity", label: "Identities" },
];

export function ItemList({ onAdd }: { onAdd: () => void }) {
  const {
    items,
    filter,
    setFilter,
    query,
    setQuery,
    loading,
    selectedId,
    selectItem,
    toggleFavorite,
    copyField,
    duplicateItem,
    deleteItem,
    settings,
    showToast,
  } = useApp();
  const inputRef = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; item: ItemSummary } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ItemSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const focus = () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener("acuye:focus-search", focus);
    return () => window.removeEventListener("acuye:focus-search", focus);
  }, []);

  const heading = useMemo(() => {
    if (query) return `Results for “${query}”`;
    if (filter === "all") return "All Items";
    return FILTERS.find((entry) => entry.value === filter)?.label ?? "All Items";
  }, [filter, query]);

  const copy = async (item: ItemSummary, field: string, label: string) => {
    try {
      const seconds = await copyField(item.id, field);
      showToast({
        title: `${label} copied`,
        description: seconds > 0 ? `Clipboard clears in ${seconds}s` : undefined,
        tone: "success",
      });
    } catch {
      showToast({ title: "Could not copy", tone: "error" });
    }
  };

  const rowMenuActions = (item: ItemSummary): MenuAction[] => {
    const actions: MenuAction[] = [];
    if (item.item_type === "login") {
      actions.push(
        { label: "Copy password", icon: <Copy />, onSelect: () => void copy(item, "password", "Password") },
        { label: "Copy username", icon: <User />, onSelect: () => void copy(item, "username", "Username") },
      );
    }
    actions.push(
      {
        label: item.favorite ? "Remove from favorites" : "Add to favorites",
        icon: <Star />,
        onSelect: () => void toggleFavorite(item.id),
      },
      {
        label: "Duplicate",
        icon: <CopyPlus />,
        onSelect: () => void duplicateItem(item.id),
      },
      {
        label: "Delete",
        icon: <Trash2 />,
        danger: true,
        separatorBefore: true,
        onSelect: () => {
          if (settings.confirm_delete) setConfirmDelete(item);
          else void removeItem(item.id);
        },
      },
    );
    return actions;
  };

  const removeItem = async (id: string) => {
    setDeleting(true);
    try {
      await deleteItem(id);
      showToast({ title: "Item deleted", tone: "success" });
    } catch {
      showToast({ title: "Could not delete the item", tone: "error" });
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  };

  return (
    <section className="flex h-full w-[330px] shrink-0 flex-col border-r border-border bg-surface/40">
      <div className="space-y-2.5 px-3 pb-2.5 pt-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
            <Input
              ref={inputRef}
              id="item-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search vault"
              aria-label="Search vault"
              className="h-8 pl-8 pr-8 text-[13px]"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            ) : (
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border bg-muted/70 px-1 font-mono text-[9.5px] text-muted-foreground">
                ⌘K
              </span>
            )}
          </div>
          <IconButton
            aria-label="Add item"
            title="Add item (Ctrl+N)"
            variant="primary"
            onClick={onAdd}
            className="h-8 w-8"
          >
            <Plus className="h-4 w-4" />
          </IconButton>
        </div>
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((entry) => (
            <button
              key={entry.value}
              type="button"
              onClick={() => setFilter(entry.value)}
              aria-pressed={filter === entry.value}
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors",
                filter === entry.value
                  ? "bg-accent text-accent-foreground"
                  : "bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between px-4 pb-1.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          {heading}
        </h2>
        <span className="text-[11px] tabular-nums text-muted-foreground/70">{items.length}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {loading && items.length === 0 ? (
          <div className="space-y-1.5 px-1 pt-1">
            {[0, 1, 2, 3, 4].map((row) => (
              <div key={row} className="flex items-center gap-2.5 rounded-lg p-2">
                <div className="h-9 w-9 animate-pulse rounded-lg bg-muted" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-2.5 w-1/2 animate-pulse rounded bg-muted" />
                  <div className="h-2 w-2/3 animate-pulse rounded bg-muted/70" />
                </div>
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-14 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <Search className="h-5 w-5" />
            </div>
            <p className="mt-3 text-[13px] font-medium">
              {query ? "No matching items" : filter === "favorites" ? "No favorites yet" : "This vault is empty"}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {query
                ? "Try a different title, username or tag."
                : filter === "favorites"
                  ? "Star an item to keep it within reach."
                  : "Add your first password or secure note."}
            </p>
            {!query && filter !== "favorites" ? (
              <Button variant="secondary" size="sm" className="mt-3" onClick={onAdd}>
                <Plus className="h-3.5 w-3.5" />
                Add an item
              </Button>
            ) : null}
          </div>
        ) : (
          <ul className="space-y-0.5" aria-label="Vault items">
            <AnimatePresence initial={false}>
              {items.map((item) => (
                <motion.li
                  key={item.id}
                  layout
                  initial={{ opacity: 0, y: 3 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.14 }}
                >
                  <button
                    type="button"
                    onClick={() => void selectItem(item.id)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setMenu({ x: event.clientX, y: event.clientY, item });
                    }}
                    aria-current={selectedId === item.id ? "true" : undefined}
                    className={cn(
                      "item-row group flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors",
                      selectedId === item.id
                        ? "bg-accent-soft"
                        : "hover:bg-muted/70 focus-visible:bg-muted/70",
                    )}
                  >
                    <ItemAvatar title={item.title} type={item.item_type} size="md" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "truncate text-[13px] font-medium",
                            selectedId === item.id && "text-accent",
                          )}
                        >
                          {item.title}
                        </span>
                        {item.favorite ? (
                          <Star className="h-3 w-3 shrink-0 fill-warning text-warning" aria-label="Favorite" />
                        ) : null}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                        <span className="truncate">
                          {item.item_type === "login"
                            ? item.subtitle || "No username"
                            : itemTypeLabel(item.item_type)}
                        </span>
                      </span>
                    </span>
                    {item.tags.length > 0 ? (
                      <Badge tone="muted" className="hidden shrink-0 xl:inline-flex">
                        {item.tags[0]}
                      </Badge>
                    ) : null}
                  </button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>

      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          actions={rowMenuActions(menu.item)}
          onClose={() => setMenu(null)}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
        title="Delete this item?"
        description={
          confirmDelete
            ? `“${confirmDelete.title}” will be permanently removed from your vault. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={() => (confirmDelete ? removeItem(confirmDelete.id) : undefined)}
      />
    </section>
  );
}
