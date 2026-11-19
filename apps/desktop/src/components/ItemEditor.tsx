import { Eye, EyeOff, Plus, Sparkles, Trash2, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";

import { useApp } from "@/lib/app-context";
import {
  emptyFields,
  itemTypeLabel,
  type CustomField,
  type ItemFields,
  type ItemType,
  type PasswordStrength,
  type TypedItem,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { Dialog } from "./dialog";
import { GeneratorDialog } from "./GeneratorDialog";
import { Button, Field, IconButton, Input, Select, Switch, Textarea } from "./ui";

const TYPES: ItemType[] = ["login", "secure_note", "card", "identity", "document", "custom"];

export function ItemEditor({
  open,
  onOpenChange,
  item,
  initialType,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item?: TypedItem | null;
  initialType?: ItemType;
}) {
  const { createItem, updateItem, showToast, evaluatePassword } = useApp();
  const editing = Boolean(item);

  const [kind, setKind] = useState<ItemType>(initialType ?? "login");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState("");
  const [favorite, setFavorite] = useState(false);
  const [fields, setFields] = useState<ItemFields>(emptyFields(initialType ?? "login"));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [revealPassword, setRevealPassword] = useState(false);
  const [strength, setStrength] = useState<PasswordStrength | null>(null);
  const [generatorOpen, setGeneratorOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (item) {
      setKind(item.kind);
      setTitle(item.title);
      setNotes(item.notes);
      setTags(item.tags.join(", "));
      setFavorite(item.favorite);
      const { id: _id, title: _t, notes: _n, tags: _tg, favorite: _f, created_at: _c, updated_at: _u, kind: _k, ...rest } = item;
      setFields(rest as unknown as ItemFields);
    } else {
      const nextKind = initialType ?? "login";
      setKind(nextKind);
      setTitle("");
      setNotes("");
      setTags("");
      setFavorite(false);
      setFields(emptyFields(nextKind));
    }
    setError(null);
    setRevealPassword(false);
    setStrength(null);
  }, [open, item, initialType]);

  const password =
    kind === "login" ? (fields as { password?: string }).password ?? "" : "";

  useEffect(() => {
    let cancelled = false;
    if (!open || kind !== "login") {
      setStrength(null);
      return;
    }
    const timer = window.setTimeout(async () => {
      const result = await evaluatePassword(password);
      if (!cancelled) setStrength(result);
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, kind, password, evaluatePassword]);

  const patch = (values: Record<string, unknown>) => {
    setFields((current) => ({ ...(current as object), ...values } as ItemFields));
  };

  const changeKind = (next: ItemType) => {
    setKind(next);
    setFields(emptyFields(next));
    setRevealPassword(false);
  };

  const customFields = kind === "custom" ? ((fields as { fields: CustomField[] }).fields ?? []) : [];

  const updateCustomField = (index: number, values: Partial<CustomField>) => {
    setFields({
      kind: "custom",
      fields: customFields.map((field, position) =>
        position === index ? { ...field, ...values } : field,
      ),
    });
  };

  const save = async () => {
    if (!title.trim()) {
      setError("Give this item a title");
      return;
    }
    setSaving(true);
    setError(null);
    const tagList = tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    try {
      if (item) {
        await updateItem({
          ...item,
          ...fields,
          title: title.trim(),
          notes,
          tags: tagList,
          favorite,
          kind,
        } as unknown as TypedItem);
        showToast({ title: "Item updated", tone: "success" });
      } else {
        await createItem({ fields, title: title.trim(), notes, tags: tagList, favorite });
        showToast({ title: "Item added to your vault", tone: "success" });
      }
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the item");
    } finally {
      setSaving(false);
    }
  };

  const scoreColors = ["bg-danger", "bg-danger", "bg-warning", "bg-success", "bg-success"];

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={editing ? "Edit item" : "New item"}
        description={
          editing
            ? "Changes are encrypted before they are written to disk."
            : "Everything you enter is encrypted with your vault key."
        }
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void save()} loading={saving}>
              {editing ? "Save changes" : "Add item"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-[1fr_180px] gap-3">
            <Field label="Title" htmlFor="item-title">
              <Input
                id="item-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="e.g. GitHub"
                autoFocus
                maxLength={256}
              />
            </Field>
            <Field label="Type" htmlFor="item-type">
              <Select
                id="item-type"
                value={kind}
                onChange={(event) => changeKind(event.target.value as ItemType)}
                disabled={editing}
              >
                {TYPES.map((type) => (
                  <option key={type} value={type}>
                    {itemTypeLabel(type)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {kind === "login" ? (
            <>
              <Field label="Username or email" htmlFor="item-username">
                <Input
                  id="item-username"
                  value={(fields as { username?: string }).username ?? ""}
                  onChange={(event) => patch({ username: event.target.value })}
                  placeholder="you@example.com"
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>
              <Field label="Password" htmlFor="item-password">
                <div className="flex gap-1.5">
                  <div className="relative flex-1">
                    <Input
                      id="item-password"
                      type={revealPassword ? "text" : "password"}
                      value={password}
                      onChange={(event) => patch({ password: event.target.value })}
                      placeholder="Enter or generate a password"
                      autoComplete="new-password"
                      spellCheck={false}
                      className="pr-9 font-mono"
                    />
                    <IconButton
                      aria-label={revealPassword ? "Hide password" : "Show password"}
                      onClick={() => setRevealPassword((current) => !current)}
                      className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
                      type="button"
                    >
                      {revealPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </IconButton>
                  </div>
                  <Button variant="secondary" type="button" onClick={() => setGeneratorOpen(true)}>
                    <Wand2 className="h-3.5 w-3.5" />
                    Generate
                  </Button>
                </div>
                {strength && password ? (
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex flex-1 gap-1">
                      {[0, 1, 2, 3, 4].map((segment) => (
                        <div
                          key={segment}
                          className={cn(
                            "h-1 flex-1 rounded-full",
                            segment <= strength.score ? scoreColors[strength.score] : "bg-muted-foreground/20",
                          )}
                        />
                      ))}
                    </div>
                    <span className="text-[11px] text-muted-foreground">
                      {strength.label} · {Math.round(strength.bits)} bits
                    </span>
                  </div>
                ) : null}
              </Field>
              <Field label="Website" htmlFor="item-url" hint="Used for the favicon and the Open action">
                <Input
                  id="item-url"
                  value={(fields as { url?: string }).url ?? ""}
                  onChange={(event) => patch({ url: event.target.value })}
                  placeholder="https://example.com"
                  spellCheck={false}
                />
              </Field>
              <Field label="One-time password secret (optional)" htmlFor="item-totp">
                <Input
                  id="item-totp"
                  value={(fields as { totp?: string }).totp ?? ""}
                  onChange={(event) => patch({ totp: event.target.value })}
                  placeholder="otpauth:// or base32 secret"
                  spellCheck={false}
                  className="font-mono text-[12px]"
                />
              </Field>
            </>
          ) : null}

          {kind === "card" ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Cardholder" htmlFor="card-holder" className="col-span-2">
                <Input
                  id="card-holder"
                  value={(fields as { cardholder?: string }).cardholder ?? ""}
                  onChange={(event) => patch({ cardholder: event.target.value })}
                />
              </Field>
              <Field label="Card number" htmlFor="card-number" className="col-span-2">
                <Input
                  id="card-number"
                  value={(fields as { number?: string }).number ?? ""}
                  onChange={(event) => patch({ number: event.target.value })}
                  className="font-mono"
                  inputMode="numeric"
                  spellCheck={false}
                />
              </Field>
              <Field label="Expiry month" htmlFor="card-exp-month">
                <Input
                  id="card-exp-month"
                  value={(fields as { expiry_month?: string }).expiry_month ?? ""}
                  onChange={(event) => patch({ expiry_month: event.target.value })}
                  placeholder="MM"
                  maxLength={2}
                />
              </Field>
              <Field label="Expiry year" htmlFor="card-exp-year">
                <Input
                  id="card-exp-year"
                  value={(fields as { expiry_year?: string }).expiry_year ?? ""}
                  onChange={(event) => patch({ expiry_year: event.target.value })}
                  placeholder="YYYY"
                  maxLength={4}
                />
              </Field>
              <Field label="CVV" htmlFor="card-cvv">
                <Input
                  id="card-cvv"
                  value={(fields as { cvv?: string }).cvv ?? ""}
                  onChange={(event) => patch({ cvv: event.target.value })}
                  maxLength={4}
                  className="font-mono"
                />
              </Field>
              <Field label="PIN (optional)" htmlFor="card-pin">
                <Input
                  id="card-pin"
                  value={(fields as { pin?: string }).pin ?? ""}
                  onChange={(event) => patch({ pin: event.target.value })}
                  className="font-mono"
                />
              </Field>
            </div>
          ) : null}

          {kind === "identity" ? (
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ["first_name", "First name"],
                  ["last_name", "Last name"],
                  ["email", "Email"],
                  ["phone", "Phone"],
                  ["address", "Address"],
                  ["city", "City"],
                  ["state", "State / region"],
                  ["postal_code", "Postal code"],
                  ["country", "Country"],
                  ["company", "Company"],
                ] as const
              ).map(([key, label]) => (
                <Field key={key} label={label} htmlFor={`identity-${key}`}>
                  <Input
                    id={`identity-${key}`}
                    value={(fields as Record<string, unknown>)[key] as string ?? ""}
                    onChange={(event) => patch({ [key]: event.target.value })}
                  />
                </Field>
              ))}
            </div>
          ) : null}

          {kind === "document" ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="File name" htmlFor="document-filename" className="col-span-2">
                <Input
                  id="document-filename"
                  value={(fields as { filename?: string }).filename ?? ""}
                  onChange={(event) => patch({ filename: event.target.value })}
                  placeholder="passport.pdf"
                />
              </Field>
              <Field label="MIME type" htmlFor="document-mime">
                <Input
                  id="document-mime"
                  value={(fields as { mime_type?: string }).mime_type ?? ""}
                  onChange={(event) => patch({ mime_type: event.target.value })}
                  placeholder="application/pdf"
                />
              </Field>
              <Field label="Size in bytes" htmlFor="document-size">
                <Input
                  id="document-size"
                  type="number"
                  min={0}
                  value={(fields as { size_bytes?: number }).size_bytes ?? 0}
                  onChange={(event) => patch({ size_bytes: Number(event.target.value) })}
                />
              </Field>
              <Field label="SHA-256 (optional)" htmlFor="document-sha" className="col-span-2">
                <Input
                  id="document-sha"
                  value={(fields as { sha256?: string }).sha256 ?? ""}
                  onChange={(event) => patch({ sha256: event.target.value })}
                  className="font-mono text-[12px]"
                />
              </Field>
              <p className="col-span-2 text-[11.5px] leading-relaxed text-muted-foreground">
                Acuye Pass stores document metadata in this phase. File attachments are not
                implemented yet, so nothing is uploaded or copied.
              </p>
            </div>
          ) : null}

          {kind === "custom" ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[13px] font-medium">Custom fields</p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setFields({
                      kind: "custom",
                      fields: [...customFields, { label: "", value: "", concealed: false }],
                    })
                  }
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add field
                </Button>
              </div>
              {customFields.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[12px] text-muted-foreground">
                  Add a label and value pair.
                </p>
              ) : null}
              {customFields.map((field, index) => (
                <div key={index} className="flex items-end gap-2">
                  <Field label="Label" className="w-40" htmlFor={`custom-label-${index}`}>
                    <Input
                      id={`custom-label-${index}`}
                      value={field.label}
                      onChange={(event) => updateCustomField(index, { label: event.target.value })}
                    />
                  </Field>
                  <Field label="Value" className="flex-1" htmlFor={`custom-value-${index}`}>
                    <Input
                      id={`custom-value-${index}`}
                      type={field.concealed ? "password" : "text"}
                      value={field.value}
                      onChange={(event) => updateCustomField(index, { value: event.target.value })}
                    />
                  </Field>
                  <label className="flex h-9 items-center gap-1.5 text-[11.5px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={field.concealed}
                      onChange={(event) => updateCustomField(index, { concealed: event.target.checked })}
                      className="accent-[hsl(var(--accent))]"
                    />
                    Secret
                  </label>
                  <IconButton
                    aria-label="Remove field"
                    className="mb-0.5"
                    onClick={() =>
                      setFields({
                        kind: "custom",
                        fields: customFields.filter((_, position) => position !== index),
                      })
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </IconButton>
                </div>
              ))}
            </div>
          ) : null}

          <Field label="Notes" htmlFor="item-notes">
            <Textarea
              id="item-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Optional notes, encrypted with the item"
              maxLength={100_000}
            />
          </Field>

          <div className="grid grid-cols-[1fr_auto] items-end gap-3">
            <Field label="Tags" htmlFor="item-tags" hint="Comma separated">
              <Input
                id="item-tags"
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                placeholder="work, finance"
              />
            </Field>
            <div className="flex h-9 items-center">
              <Switch
                id="item-favorite"
                label="Favorite"
                checked={favorite}
                onCheckedChange={setFavorite}
              />
            </div>
          </div>

          {error ? (
            <p className="rounded-md bg-danger/10 px-3 py-2 text-[12.5px] text-danger" role="alert">
              {error}
            </p>
          ) : null}

          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Sparkles className="h-3 w-3" />
            Items are encrypted individually; the vault key never leaves the Rust backend.
          </p>
        </div>
      </Dialog>

      <GeneratorDialog
        open={generatorOpen}
        onOpenChange={setGeneratorOpen}
        onUse={(value) => patch({ password: value })}
      />
    </>
  );
}
