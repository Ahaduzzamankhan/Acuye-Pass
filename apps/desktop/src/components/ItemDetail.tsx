import { motion } from "motion/react";
import {
  Copy,
  CopyPlus,
  Eye,
  EyeOff,
  ExternalLink,
  Globe,
  KeyRound,
  Pencil,
  Star,
  Trash2,
  MoreHorizontal,
  ShieldCheck,
  CalendarClock,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useApp } from "@/lib/app-context";
import { useBackend } from "@/lib/backend-context";
import { itemTypeLabel, type ItemType, type TypedItem } from "@/lib/types";
import { cn, formatBytes, formatDate, hostOf, truncateMiddle } from "@/lib/utils";
import { ConfirmDialog } from "./dialog";
import { ItemAvatar } from "./item-avatar";
import { ActionMenu } from "./menu";
import { Badge, Button, IconButton, Tooltip } from "./ui";

interface LoginFields {
  username: string;
  password: string;
  url: string;
  totp: string;
}
interface CardFields {
  cardholder: string;
  number: string;
  expiry_month: string;
  expiry_year: string;
  cvv: string;
  brand: string;
  pin: string;
}
interface IdentityFields {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  company: string;
}
interface DocumentFields {
  filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
}
interface CustomFields {
  fields: Array<{ label: string; value: string; concealed: boolean }>;
}

export function ItemDetail({ onEdit }: { onEdit: (item: TypedItem) => void }) {
  const backend = useBackend();
  const {
    selectedItem,
    settings,
    copyField,
    openWebsite,
    toggleFavorite,
    duplicateItem,
    deleteItem,
    showToast,
  } = useApp();
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [favicon, setFavicon] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const item = selectedItem;
  const host = useMemo(
    () => (item && item.kind === "login" ? hostOf((item as unknown as LoginFields).url) : ""),
    [item],
  );

  useEffect(() => {
    setReveal({});
    setFavicon(null);
  }, [item?.id]);

  useEffect(() => {
    let cancelled = false;
    if (!item || item.kind !== "login" || !settings.favicon_enabled) return;
    const url = (item as unknown as LoginFields).url;
    if (!url) return;
    void backend
      .getFavicon(url)
      .then((value) => {
        if (!cancelled) setFavicon(value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [backend, item, settings.favicon_enabled]);

  const copy = async (field: string, label: string) => {
    if (!item) return;
    try {
      const seconds = await copyField(item.id, field);
      showToast({
        title: `${label} copied`,
        description: seconds > 0 ? `Clipboard clears in ${seconds}s` : "Copied to clipboard",
        tone: "success",
      });
    } catch {
      showToast({ title: "Could not copy that field", tone: "error" });
    }
  };

  if (!item) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background p-10">
        <div className="flex max-w-xs flex-col items-center text-center">
          <div className="relative mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-soft text-accent">
            <ShieldCheck className="h-8 w-8" />
          </div>
          <h2 className="text-[15px] font-semibold">Your vault is unlocked</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
            Select an item to view its details, or press{" "}
            <span className="font-mono text-[11.5px]">Ctrl N</span> to add a password.
          </p>
          <p className="mt-4 text-[11px] text-muted-foreground/70">
            Decrypted data stays in memory and is never written to disk.
          </p>
        </div>
      </div>
    );
  }

  const menuActions = [
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
      onSelect: () => setConfirmDelete(true),
    },
  ];

  const type = item.kind as ItemType;
  const login = item.kind === "login" ? (item as unknown as LoginFields) : null;
  const card = item.kind === "card" ? (item as unknown as CardFields) : null;
  const identity = item.kind === "identity" ? (item as unknown as IdentityFields) : null;
  const document = item.kind === "document" ? (item as unknown as DocumentFields) : null;
  const custom = item.kind === "custom" ? (item as unknown as CustomFields) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex items-start gap-3.5 border-b border-border px-6 py-5">
        <ItemAvatar title={item.title} type={type} favicon={favicon} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-[19px] font-semibold tracking-[-0.015em]">{item.title}</h1>
            {item.favorite ? <Star className="h-4 w-4 shrink-0 fill-warning text-warning" /> : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge tone="accent">{itemTypeLabel(type)}</Badge>
            {host ? (
              <span className="text-[12px] text-muted-foreground">{host}</span>
            ) : item.tags.length ? (
              <span className="text-[12px] text-muted-foreground">{item.tags.join(" · ")}</span>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip content={item.favorite ? "Unfavorite" : "Favorite"}>
            <IconButton
              aria-label={item.favorite ? "Remove from favorites" : "Add to favorites"}
              onClick={() => void toggleFavorite(item.id)}
              className={cn(item.favorite && "text-warning")}
            >
              <Star className={cn("h-4 w-4", item.favorite && "fill-warning")} />
            </IconButton>
          </Tooltip>
          <Button variant="secondary" size="sm" onClick={() => onEdit(item)}>
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Button>
          <ActionMenu
            trigger={
              <IconButton aria-label="More actions">
                <MoreHorizontal className="h-4 w-4" />
              </IconButton>
            }
            actions={menuActions}
          />
        </div>
      </div>

      <motion.div
        key={item.id}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.16 }}
        className="min-h-0 flex-1 overflow-y-auto px-6 py-5"
      >
        {login ? (
          <section className="space-y-1">
            {login.username ? (
              <DetailRow label="Username" value={login.username} onCopy={() => void copy("username", "Username")} />
            ) : null}
            {login.password ? (
              <DetailRow
                label="Password"
                value={login.password}
                secret
                revealed={Boolean(reveal.password)}
                onToggleReveal={() => setReveal((current) => ({ ...current, password: !current.password }))}
                onCopy={() => void copy("password", "Password")}
                highlight
              />
            ) : (
              <div className="rounded-lg border border-dashed border-border px-3 py-2.5 text-[12.5px] text-muted-foreground">
                No password stored for this login.
                <Button variant="ghost" size="sm" className="ml-1 h-6 px-2 text-accent" onClick={() => onEdit(item)}>
                  Add one
                </Button>
              </div>
            )}
            {login.url ? (
              <DetailRow
                label="Website"
                value={login.url}
                icon={<Globe />}
                onCopy={() => void copy("url", "Website")}
                action={
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-accent" onClick={() => void openWebsite(login.url)}>
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open
                  </Button>
                }
              />
            ) : null}
            {login.totp ? (
              <DetailRow label="One-time code" value={truncateMiddle(login.totp, 40)} onCopy={() => void copy("totp", "One-time code")} />
            ) : null}
          </section>
        ) : null}

        {card ? (
          <section className="space-y-1">
            {card.cardholder ? <DetailRow label="Cardholder" value={card.cardholder} onCopy={() => void copy("card_cardholder", "Cardholder")} /> : null}
            {card.number ? (
              <DetailRow
                label="Card number"
                value={card.number}
                secret
                revealed={Boolean(reveal.number)}
                onToggleReveal={() => setReveal((current) => ({ ...current, number: !current.number }))}
                onCopy={() => void copy("card_number", "Card number")}
                highlight
              />
            ) : null}
            {card.expiry_month || card.expiry_year ? (
              <DetailRow label="Expiry" value={`${card.expiry_month || "—"}/${card.expiry_year || "—"}`} />
            ) : null}
            {card.cvv ? (
              <DetailRow
                label="CVV"
                value={card.cvv}
                secret
                revealed={Boolean(reveal.cvv)}
                onToggleReveal={() => setReveal((current) => ({ ...current, cvv: !current.cvv }))}
                onCopy={() => void copy("card_cvv", "CVV")}
              />
            ) : null}
            {card.pin ? (
              <DetailRow
                label="PIN"
                value={card.pin}
                secret
                revealed={Boolean(reveal.pin)}
                onToggleReveal={() => setReveal((current) => ({ ...current, pin: !current.pin }))}
                onCopy={() => void copy("card_pin", "PIN")}
              />
            ) : null}
            {card.brand ? <DetailRow label="Brand" value={card.brand} /> : null}
          </section>
        ) : null}

        {identity ? (
          <section className="space-y-1">
            <DetailRow label="Name" value={`${identity.first_name} ${identity.last_name}`.trim() || "—"} />
            {identity.email ? <DetailRow label="Email" value={identity.email} onCopy={() => void copy("identity_email", "Email")} /> : null}
            {identity.phone ? <DetailRow label="Phone" value={identity.phone} onCopy={() => void copy("identity_phone", "Phone")} /> : null}
            {identity.address || identity.city ? (
              <DetailRow
                label="Address"
                value={[identity.address, identity.city, identity.state, identity.postal_code, identity.country]
                  .filter(Boolean)
                  .join(", ")}
              />
            ) : null}
            {identity.company ? <DetailRow label="Company" value={identity.company} /> : null}
          </section>
        ) : null}

        {document ? (
          <section className="space-y-1">
            <DetailRow label="File name" value={document.filename || "—"} />
            <DetailRow label="Type" value={document.mime_type || "—"} />
            <DetailRow label="Size" value={document.size_bytes ? formatBytes(document.size_bytes) : "—"} />
            {document.sha256 ? <DetailRow label="SHA-256" value={document.sha256} mono /> : null}
            <p className="px-1 pt-2 text-[11.5px] text-muted-foreground">
              Only document metadata is stored in this phase; file attachments are not implemented.
            </p>
          </section>
        ) : null}

        {custom ? (
          <section className="space-y-1">
            {custom.fields.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">No custom fields yet.</p>
            ) : (
              custom.fields.map((field, index) => (
                <DetailRow
                  key={`${field.label}-${index}`}
                  label={field.label || "Field"}
                  value={field.value}
                  secret={field.concealed}
                  revealed={Boolean(reveal[`custom-${index}`])}
                  onToggleReveal={
                    field.concealed
                      ? () =>
                          setReveal((current) => ({
                            ...current,
                            [`custom-${index}`]: !current[`custom-${index}`],
                          }))
                      : undefined
                  }
                  onCopy={() => void copyUsingValue(field.value, field.label || "Field")}
                />
              ))
            )}
          </section>
        ) : null}

        {item.notes ? (
          <section className="mt-5">
            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Notes
            </h3>
            <div className="whitespace-pre-wrap rounded-lg border border-border/70 bg-surface p-3 text-[13px] leading-relaxed">
              {item.notes}
            </div>
          </section>
        ) : null}

        {item.tags.length > 0 ? (
          <section className="mt-5">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Tags
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {item.tags.map((tag) => (
                <Badge key={tag} tone="muted">
                  {tag}
                </Badge>
              ))}
            </div>
          </section>
        ) : null}

        <section className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <CalendarClock className="h-3 w-3" />
            Created {formatDate(item.created_at)}
          </span>
          <span>Modified {formatDate(item.updated_at)}</span>
          <span className="inline-flex items-center gap-1.5">
            <KeyRound className="h-3 w-3" />
            Encrypted with XChaCha20-Poly1305
          </span>
        </section>
      </motion.div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this item?"
        description={`“${item.title}” will be permanently removed from your vault. This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={async () => {
          setDeleting(true);
          try {
            await deleteItem(item.id);
            showToast({ title: "Item deleted", tone: "success" });
          } finally {
            setDeleting(false);
            setConfirmDelete(false);
          }
        }}
      />
    </div>
  );

  function copyUsingValue(value: string, label: string) {
    void navigator.clipboard
      .writeText(value)
      .then(() =>
        showToast({
          title: `${label} copied`,
          description:
            settings.clipboard_clear_secs > 0
              ? `Clipboard clears in ${settings.clipboard_clear_secs}s`
              : undefined,
          tone: "success",
        }),
      )
      .catch(() => showToast({ title: "Could not copy that field", tone: "error" }));
  }
}

function DetailRow({
  label,
  value,
  secret,
  revealed,
  onToggleReveal,
  onCopy,
  action,
  icon,
  highlight,
  mono,
}: {
  label: string;
  value: string;
  secret?: boolean;
  revealed?: boolean;
  onToggleReveal?: () => void;
  onCopy?: () => void;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  highlight?: boolean;
  mono?: boolean;
}) {
  return (
    <div
      className={cn(
        "group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/50",
        highlight && "border border-border/70 bg-surface",
      )}
    >
      <div className="w-28 shrink-0 text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {icon ? <span className="text-muted-foreground [&_svg]:h-3.5 [&_svg]:w-3.5">{icon}</span> : null}
        <span className={cn("truncate text-[13.5px]", mono && "font-mono text-[12px]", secret && "mono-secret")}>
          {secret && !revealed ? "••••••••••••" : value}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 opacity-70 transition-opacity group-hover:opacity-100">
        {action}
        {secret && onToggleReveal ? (
          <IconButton
            aria-label={revealed ? `Hide ${label}` : `Show ${label}`}
            onClick={onToggleReveal}
            className="h-7 w-7"
          >
            {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </IconButton>
        ) : null}
        {onCopy ? (
          <IconButton aria-label={`Copy ${label}`} onClick={onCopy} className="h-7 w-7">
            <Copy className="h-3.5 w-3.5" />
          </IconButton>
        ) : null}
      </div>
    </div>
  );
}
