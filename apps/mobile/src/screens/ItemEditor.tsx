/**
 * Create or edit any of the eight vault item types.
 *
 * The form is generated from a per-type field list so the Android editor stays
 * in step with the Rust `ItemFields` model, and every value is validated again
 * in Rust before it is saved.
 */

import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useApp } from "../app-context";
import { Badge, Btn, Chip, ErrorBox, Field, Sheet, StrengthBar, Toggle } from "../components/ui";
import {
  api,
  errorMessage,
  type CustomField,
  type ItemFields,
  type PasswordOptions,
  type PasswordStrength,
  type VaultItem,
} from "../native";
import { SECRET_ENVIRONMENTS, typeLabel } from "../theme";

interface FieldSpec {
  key: string;
  label: string;
  secure?: boolean;
  multiline?: boolean;
  keyboardType?: "default" | "email-address" | "url" | "numeric" | "phone-pad";
  placeholder?: string;
}

const SPECS: Record<string, FieldSpec[]> = {
  login: [
    { key: "username", label: "Username", placeholder: "you@example.com" },
    { key: "password", label: "Password", secure: true },
    { key: "url", label: "Website", keyboardType: "url", placeholder: "https://example.com" },
    { key: "totp", label: "Authenticator secret (optional)", placeholder: "otpauth://… or a base32 secret" },
  ],
  card: [
    { key: "cardholder", label: "Cardholder" },
    { key: "number", label: "Card number", keyboardType: "numeric" },
    { key: "expiry_month", label: "Expiry month", keyboardType: "numeric", placeholder: "09" },
    { key: "expiry_year", label: "Expiry year", keyboardType: "numeric", placeholder: "2029" },
    { key: "cvv", label: "CVV", secure: true, keyboardType: "numeric" },
    { key: "brand", label: "Brand", placeholder: "Visa" },
    { key: "pin", label: "PIN", secure: true, keyboardType: "numeric" },
  ],
  identity: [
    { key: "first_name", label: "First name" },
    { key: "last_name", label: "Last name" },
    { key: "email", label: "Email", keyboardType: "email-address" },
    { key: "phone", label: "Phone", keyboardType: "phone-pad" },
    { key: "address", label: "Address" },
    { key: "city", label: "City" },
    { key: "state", label: "State / region" },
    { key: "postal_code", label: "Postal code" },
    { key: "country", label: "Country" },
    { key: "company", label: "Company" },
  ],
  document: [
    { key: "filename", label: "Filename" },
    { key: "mime_type", label: "MIME type", placeholder: "application/pdf" },
    { key: "sha256", label: "SHA-256", multiline: true },
  ],
  totp: [
    { key: "issuer", label: "Issuer", placeholder: "GitHub" },
    { key: "account", label: "Account", placeholder: "you@example.com" },
    { key: "secret", label: "Shared secret", secure: true, placeholder: "Base32 secret" },
  ],
  secret: [{ key: "category", label: "Category", placeholder: "API key, database, SSH key" }],
};

const KINDS: { kind: ItemFields["kind"]; label: string }[] = [
  { kind: "login", label: "Login" },
  { kind: "secure_note", label: "Note" },
  { kind: "card", label: "Card" },
  { kind: "identity", label: "Identity" },
  { kind: "document", label: "Document" },
  { kind: "custom", label: "Custom" },
  { kind: "totp", label: "Authenticator" },
  { kind: "secret", label: "Secret" },
];

function emptyFields(kind: ItemFields["kind"]): ItemFields {
  switch (kind) {
    case "login":
      return { kind, username: "", password: "", url: "", totp: "", password_changed_at: null };
    case "secure_note":
      return { kind };
    case "card":
      return { kind, cardholder: "", number: "", expiry_month: "", expiry_year: "", cvv: "", brand: "", pin: "" };
    case "identity":
      return {
        kind,
        first_name: "",
        last_name: "",
        email: "",
        phone: "",
        address: "",
        city: "",
        state: "",
        postal_code: "",
        country: "",
        company: "",
      };
    case "document":
      return { kind, filename: "", mime_type: "", size_bytes: 0, sha256: "" };
    case "custom":
      return { kind, fields: [{ label: "Field", value: "", concealed: false }] };
    case "totp":
      return {
        kind,
        secret: "",
        issuer: "",
        account: "",
        algorithm: "sha1",
        digits: 6,
        period: 30,
        otp_type: "totp",
        counter: 0,
      };
    case "secret":
      return {
        kind,
        environment: "development",
        category: "",
        fields: [{ label: "API key", value: "", concealed: true }],
        expires_at: null,
        rotate_every_days: null,
        last_rotated_at: null,
      };
  }
}

export function ItemEditor(props: {
  visible: boolean;
  initial: VaultItem | null;
  initialKind?: ItemFields["kind"];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { theme, notify } = useApp();
  const [kind, setKind] = useState<ItemFields["kind"]>(props.initial?.fields.kind ?? props.initialKind ?? "login");
  const [fields, setFields] = useState<ItemFields>(props.initial?.fields ?? emptyFields(props.initialKind ?? "login"));
  const [title, setTitle] = useState(props.initial?.title ?? "");
  const [notes, setNotes] = useState(props.initial?.notes ?? "");
  const [tags, setTags] = useState(props.initial?.tags.join(", ") ?? "");
  const [favorite, setFavorite] = useState(props.initial?.favorite ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [strength, setStrength] = useState<PasswordStrength | null>(null);
  const [generator, setGenerator] = useState<PasswordOptions>({
    length: 22,
    uppercase: true,
    lowercase: true,
    numbers: true,
    symbols: true,
    exclude_chars: "",
  });

  const editing = Boolean(props.initial);

  useEffect(() => {
    if (!props.visible) return;
    setKind(props.initial?.fields.kind ?? props.initialKind ?? "login");
    setFields(props.initial?.fields ?? emptyFields(props.initialKind ?? "login"));
    setTitle(props.initial?.title ?? "");
    setNotes(props.initial?.notes ?? "");
    setTags(props.initial?.tags.join(", ") ?? "");
    setFavorite(props.initial?.favorite ?? false);
    setError(null);
    setStrength(null);
  }, [props.initial, props.initialKind, props.visible]);

  const record = fields as unknown as Record<string, unknown>;
  const valueOf = (key: string): string => {
    const value = record[key];
    return value === null || value === undefined ? "" : String(value);
  };

  const setField = (key: string, value: string | number | null) => {
    setFields((current) => ({ ...current, [key]: value } as ItemFields));
  };

  const password = kind === "login" ? valueOf("password") : "";

  useEffect(() => {
    if (!props.visible || !password) {
      setStrength(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .evaluatePassword(password)
        .then((next) => {
          if (!cancelled) setStrength(next);
        })
        .catch(() => undefined);
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [password, props.visible]);

  const customFields: CustomField[] = useMemo(() => {
    if (kind === "custom" || kind === "secret") {
      const list = (record.fields as CustomField[] | undefined) ?? [];
      return list;
    }
    return [];
  }, [kind, record.fields]);

  const setCustomFields = (next: CustomField[]) => {
    setFields((current) => ({ ...current, fields: next } as ItemFields));
  };

  const generatePassword = async () => {
    try {
      const generated = await api.generatePassword(generator);
      setField("password", generated);
    } catch (cause) {
      setError(errorMessage(cause, "Could not generate a password"));
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    const cleanedTags = tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    try {
      const payload = {
        title: title.trim(),
        notes,
        tags: cleanedTags,
        favorite,
        fields,
      };
      if (props.initial) {
        await api.updateItem({ ...props.initial, ...payload, fields });
      } else {
        await api.createItem(payload);
      }
      notify(editing ? "Item saved" : "Item added");
      props.onSaved();
    } catch (cause) {
      setError(errorMessage(cause, "Could not save the item"));
    } finally {
      setBusy(false);
    }
  };

  const specs = SPECS[kind] ?? [];
  const canSave = title.trim().length > 0 && (kind !== "totp" || valueOf("secret").trim().length > 0);

  return (
    <Sheet
      visible={props.visible}
      title={editing ? "Edit item" : "New item"}
      subtitle={editing ? typeLabel(kind) : "Choose a type, then fill in what matters."}
      onClose={props.onClose}
      footer={<Btn label={editing ? "Save changes" : "Add item"} onPress={() => void save()} busy={busy} disabled={!canSave} />}
    >
      {!editing ? (
        <View style={{ gap: 8 }}>
          <Text style={[styles.caption, { color: theme.muted }]}>TYPE</Text>
          <View style={styles.chips}>
            {KINDS.map((entry) => (
              <Chip
                key={entry.kind}
                label={entry.label}
                active={kind === entry.kind}
                onPress={() => {
                  setKind(entry.kind);
                  setFields(emptyFields(entry.kind));
                }}
              />
            ))}
          </View>
        </View>
      ) : null}

      <Field label="Title" value={title} onChangeText={setTitle} placeholder={kind === "login" ? "GitHub" : "A name you will recognise"} />

      {specs.map((spec) => (
        <Field
          key={spec.key}
          label={spec.label}
          value={valueOf(spec.key)}
          onChangeText={(value) => setField(spec.key, value)}
          secure={spec.secure}
          multiline={spec.multiline}
          placeholder={spec.placeholder}
          keyboardType={spec.keyboardType}
        />
      ))}

      {kind === "login" ? (
        <>
          {strength ? <StrengthBar score={strength.score} label={strength.label} bits={strength.bits} /> : null}
          <Card title="Generator">
            <View style={styles.lengthRow}>
              <Text style={[styles.body, { color: theme.text }]}>Length</Text>
              <View style={styles.stepper}>
                <Pressable
                  onPress={() => setGenerator((current) => ({ ...current, length: Math.max(8, current.length - 1) }))}
                  style={[styles.stepBtn, { borderColor: theme.border }]}
                >
                  <Text style={[styles.stepText, { color: theme.text }]}>−</Text>
                </Pressable>
                <Text style={[styles.length, { color: theme.text }]}>{generator.length}</Text>
                <Pressable
                  onPress={() => setGenerator((current) => ({ ...current, length: Math.min(64, current.length + 1) }))}
                  style={[styles.stepBtn, { borderColor: theme.border }]}
                >
                  <Text style={[styles.stepText, { color: theme.text }]}>+</Text>
                </Pressable>
              </View>
            </View>
            <View style={styles.chips}>
              {([
                ["uppercase", "A-Z"],
                ["lowercase", "a-z"],
                ["numbers", "0-9"],
                ["symbols", "!@#"],
              ] as const).map(([key, label]) => (
                <Chip
                  key={key}
                  label={label}
                  active={generator[key]}
                  onPress={() => setGenerator((current) => ({ ...current, [key]: !current[key] }))}
                />
              ))}
            </View>
            <Btn label="Generate a strong password" tone="soft" compact onPress={() => void generatePassword()} />
          </Card>
        </>
      ) : null}

      {kind === "custom" || kind === "secret" ? (
        <CustomFieldsEditor fields={customFields} onChange={setCustomFields} />
      ) : null}

      {kind === "secret" ? (
        <>
          <View style={{ gap: 8 }}>
            <Text style={[styles.caption, { color: theme.muted }]}>ENVIRONMENT</Text>
            <View style={styles.chips}>
              {SECRET_ENVIRONMENTS.map((environment) => (
                <Chip
                  key={environment}
                  label={environment}
                  active={valueOf("environment") === environment}
                  onPress={() => setField("environment", environment)}
                />
              ))}
            </View>
          </View>
          <Field
            label="Expires in (days, optional)"
            value={record.expires_at ? String(Math.max(1, Math.round((Number(record.expires_at) - Date.now() / 1000) / 86400))) : ""}
            onChangeText={(value) => {
              const days = Number(value.replace(/[^0-9]/g, ""));
              setField("expires_at", value && days > 0 ? Math.round(Date.now() / 1000) + days * 86400 : null);
            }}
            keyboardType="numeric"
          />
          <Field
            label="Rotate every (days, optional)"
            value={record.rotate_every_days ? String(record.rotate_every_days) : ""}
            onChangeText={(value) => {
              const days = Number(value.replace(/[^0-9]/g, ""));
              setField("rotate_every_days", value && days > 0 ? days : null);
            }}
            keyboardType="numeric"
          />
          <Field
            label="Last rotated (days ago, optional)"
            value={record.last_rotated_at ? String(Math.max(0, Math.round((Date.now() / 1000 - Number(record.last_rotated_at)) / 86400))) : ""}
            onChangeText={(value) => {
              const days = Number(value.replace(/[^0-9]/g, ""));
              setField("last_rotated_at", value ? Math.round(Date.now() / 1000) - days * 86400 : null);
            }}
            keyboardType="numeric"
          />
        </>
      ) : null}

      {kind === "totp" ? (
        <>
          <View style={{ gap: 8 }}>
            <Text style={[styles.caption, { color: theme.muted }]}>CODE TYPE</Text>
            <View style={styles.chips}>
              <Chip label="Time based" active={valueOf("otp_type") === "totp"} onPress={() => setField("otp_type", "totp")} />
              <Chip label="Counter based" active={valueOf("otp_type") === "hotp"} onPress={() => setField("otp_type", "hotp")} />
            </View>
          </View>
          <View style={{ gap: 8 }}>
            <Text style={[styles.caption, { color: theme.muted }]}>ALGORITHM</Text>
            <View style={styles.chips}>
              {["sha1", "sha256", "sha512"].map((algorithm) => (
                <Chip
                  key={algorithm}
                  label={algorithm.toUpperCase()}
                  active={valueOf("algorithm") === algorithm}
                  onPress={() => setField("algorithm", algorithm)}
                />
              ))}
            </View>
          </View>
          <View style={{ gap: 8 }}>
            <Text style={[styles.caption, { color: theme.muted }]}>DIGITS</Text>
            <View style={styles.chips}>
              {[6, 7, 8].map((digits) => (
                <Chip
                  key={digits}
                  label={String(digits)}
                  active={Number(record.digits ?? 6) === digits}
                  onPress={() => setField("digits", digits)}
                />
              ))}
            </View>
          </View>
          <View style={{ gap: 8 }}>
            <Text style={[styles.caption, { color: theme.muted }]}>PERIOD</Text>
            <View style={styles.chips}>
              {[30, 60].map((period) => (
                <Chip
                  key={period}
                  label={`${period}s`}
                  active={Number(record.period ?? 30) === period}
                  onPress={() => setField("period", period)}
                />
              ))}
            </View>
          </View>
        </>
      ) : null}

      {kind === "document" ? (
        <Field
          label="Size in bytes"
          value={record.size_bytes ? String(record.size_bytes) : ""}
          onChangeText={(value) => setField("size_bytes", Number(value.replace(/[^0-9]/g, "")) || 0)}
          keyboardType="numeric"
        />
      ) : null}

      <Field label="Notes" value={notes} onChangeText={setNotes} multiline placeholder="Anything you want kept with this item" />
      <Field label="Tags" value={tags} onChangeText={setTags} placeholder="work, personal" hint="Separate tags with commas." />
      <Toggle label="Favourite" value={favorite} onChange={setFavorite} description="Pin this item to the top of the vault." />
      <View style={[styles.privacy, { backgroundColor: theme.surfaceAlt }]}>
        <Text style={[styles.body, { color: theme.muted }]}>
          Saved items are encrypted with this vault's key before they reach the database.
        </Text>
      </View>
      {error ? <ErrorBox message={error} /> : null}
    </Sheet>
  );
}

function Card(props: { title: string; children: React.ReactNode }) {
  const { theme } = useApp();
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={styles.cardHeader}>
        <Text style={[styles.cardTitle, { color: theme.text }]}>{props.title}</Text>
        <Badge label="Local" tone="muted" />
      </View>
      {props.children}
    </View>
  );
}

function CustomFieldsEditor(props: { fields: CustomField[]; onChange: (fields: CustomField[]) => void }) {
  const { theme } = useApp();
  return (
    <View style={{ gap: 8 }}>
      <Text style={[styles.caption, { color: theme.muted }]}>FIELDS</Text>
      {props.fields.map((field, index) => (
        <View key={index} style={[styles.customField, { borderColor: theme.border, backgroundColor: theme.surface }]}>
          <View style={styles.customFieldHeader}>
            <Text style={[styles.caption, { color: theme.muted }]}>FIELD {index + 1}</Text>
            <Pressable
              onPress={() =>
                props.onChange(
                  props.fields.length > 1
                    ? props.fields.filter((_, position) => position !== index)
                    : props.fields,
                )
              }
              hitSlop={8}
            >
              <Text style={[styles.link, { color: theme.danger }]}>Remove</Text>
            </Pressable>
          </View>
          <Field
            label="Label"
            value={field.label}
            onChangeText={(value) =>
              props.onChange(props.fields.map((entry, position) => (position === index ? { ...entry, label: value } : entry)))
            }
          />
          <Field
            label="Value"
            value={field.value}
            secure={field.concealed}
            multiline={field.value.length > 60}
            onChangeText={(value) =>
              props.onChange(props.fields.map((entry, position) => (position === index ? { ...entry, value } : entry)))
            }
          />
          <Toggle
            label="Concealed"
            value={field.concealed}
            onChange={(value) =>
              props.onChange(props.fields.map((entry, position) => (position === index ? { ...entry, concealed: value } : entry)))
            }
          />
        </View>
      ))}
      <Btn
        label="Add field"
        tone="ghost"
        compact
        onPress={() => props.onChange([...props.fields, { label: "Field", value: "", concealed: false }])}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  caption: { fontSize: 10.5, fontWeight: "700", letterSpacing: 0.8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  body: { fontSize: 12.5, lineHeight: 18 },
  card: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 10 },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardTitle: { fontSize: 13.5, fontWeight: "700" },
  lengthRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  stepper: { flexDirection: "row", alignItems: "center", gap: 12 },
  stepBtn: { width: 34, height: 34, borderWidth: 1, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  stepText: { fontSize: 18, fontWeight: "700" },
  length: { fontSize: 16, fontWeight: "800", fontVariant: ["tabular-nums"], minWidth: 26, textAlign: "center" },
  customField: { borderWidth: 1, borderRadius: 13, padding: 11, gap: 9 },
  customFieldHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  link: { fontSize: 12, fontWeight: "700" },
  privacy: { borderRadius: 12, padding: 11 },
});
