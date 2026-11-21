/**
 * Generator tab: the desktop password/passphrase engines with the same
 * options, rendered as a phone-friendly card.
 */

import React, { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, Pressable, View } from "react-native";

import { useApp } from "../app-context";
import { Btn, Chip, ErrorBox, Loading, StrengthBar, Toggle } from "../components/ui";
import { api, errorMessage, type PassphraseOptions, type PasswordOptions, type PasswordStrength } from "../native";

const PRESET_LENGTHS = [12, 16, 20, 24, 32];

export function GeneratorScreen() {
  const { theme, copy } = useApp();
  const [mode, setMode] = useState<"password" | "passphrase">("password");
  const [options, setOptions] = useState<PasswordOptions>({
    length: 20,
    uppercase: true,
    lowercase: true,
    numbers: true,
    symbols: true,
    exclude_chars: "",
  });
  const [phrase, setPhrase] = useState<PassphraseOptions>({
    words: 6,
    separator: "-",
    capitalize: false,
    include_number: false,
  });
  const [value, setValue] = useState("");
  const [strength, setStrength] = useState<PasswordStrength | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const generate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === "password") {
        const next = await api.generatePassword(options);
        setValue(next);
        setStrength(await api.evaluatePassword(next));
      } else {
        const next = await api.generatePassphrase(phrase);
        setValue(next);
        setStrength(await api.evaluatePassword(next));
      }
    } catch (cause) {
      setError(errorMessage(cause, "Could not generate"));
    } finally {
      setBusy(false);
    }
  }, [mode, options, phrase]);

  useEffect(() => {
    void generate();
    // Regenerating on every keystroke would spam the core; the explicit
    // "Regenerate" button covers option changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const lengthRow = (
    <View style={styles.stepperRow}>
      <Pressable
        onPress={() => setOptions((current) => ({ ...current, length: Math.max(8, current.length - 1) }))}
        style={[styles.stepBtn, { borderColor: theme.border, backgroundColor: theme.surfaceAlt }]}
        accessibilityLabel="Shorter"
      >
        <Text style={[styles.stepText, { color: theme.text }]}>−</Text>
      </Pressable>
      <View style={{ alignItems: "center", flex: 1 }}>
        <Text style={[styles.length, { color: theme.text }]}>{options.length}</Text>
        <Text style={[styles.caption, { color: theme.muted }]}>CHARACTERS</Text>
      </View>
      <Pressable
        onPress={() => setOptions((current) => ({ ...current, length: Math.min(64, current.length + 1) }))}
        style={[styles.stepBtn, { borderColor: theme.border, backgroundColor: theme.surfaceAlt }]}
        accessibilityLabel="Longer"
      >
        <Text style={[styles.stepText, { color: theme.text }]}>+</Text>
      </Pressable>
    </View>
  );

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>Generator</Text>
        <Text style={[styles.meta, { color: theme.muted }]}>
          Randomness comes from the platform CSPRNG; nothing is stored unless you add it to the vault.
        </Text>
      </View>

      <View style={styles.tabs}>
        <Chip label="Password" active={mode === "password"} onPress={() => setMode("password")} />
        <Chip label="Passphrase" active={mode === "passphrase"} onPress={() => setMode("passphrase")} />
      </View>

      <View style={[styles.output, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        {busy && !value ? (
          <Loading />
        ) : (
          <Text selectable style={[styles.outputText, { color: theme.text }]}>
            {value}
          </Text>
        )}
        {strength ? <StrengthBar score={strength.score} label={strength.label} bits={strength.bits} /> : null}
        <View style={styles.outputActions}>
          <Btn label="Regenerate" tone="ghost" compact onPress={() => void generate()} busy={busy} />
          <Btn label="Copy" compact onPress={() => copy(value, "Generated value copied")} disabled={!value} />
        </View>
      </View>

      {error ? <ErrorBox message={error} /> : null}

      {mode === "password" ? (
        <>
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            {lengthRow}
            <View style={styles.chips}>
              {PRESET_LENGTHS.map((length) => (
                <Chip
                  key={length}
                  label={String(length)}
                  active={options.length === length}
                  onPress={() => setOptions((current) => ({ ...current, length }))}
                />
              ))}
            </View>
          </View>

          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.caption, { color: theme.muted }]}>CHARACTER SET</Text>
            <Toggle
              label="Uppercase"
              description="A-Z"
              value={options.uppercase}
              onChange={(value) => setOptions((current) => ({ ...current, uppercase: value }))}
            />
            <Toggle
              label="Lowercase"
              description="a-z"
              value={options.lowercase}
              onChange={(value) => setOptions((current) => ({ ...current, lowercase: value }))}
            />
            <Toggle
              label="Numbers"
              description="0-9"
              value={options.numbers}
              onChange={(value) => setOptions((current) => ({ ...current, numbers: value }))}
            />
            <Toggle
              label="Symbols"
              description="!@#$%^&*"
              value={options.symbols}
              onChange={(value) => setOptions((current) => ({ ...current, symbols: value }))}
            />
            <View style={{ gap: 6 }}>
              <Text style={[styles.caption, { color: theme.muted }]}>EXCLUDE CHARACTERS</Text>
              <TextInput
                value={options.exclude_chars}
                onChangeText={(text) => setOptions((current) => ({ ...current, exclude_chars: text }))}
                placeholder="e.g. O0lI"
                placeholderTextColor={theme.muted}
                autoCapitalize="none"
                autoCorrect={false}
                style={[
                  styles.input,
                  { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceAlt },
                ]}
              />
            </View>
          </View>
        </>
      ) : (
        <>
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.caption, { color: theme.muted }]}>WORDS</Text>
            <View style={styles.chips}>
              {[4, 5, 6, 7, 8].map((words) => (
                <Chip
                  key={words}
                  label={String(words)}
                  active={phrase.words === words}
                  onPress={() => setPhrase((current) => ({ ...current, words }))}
                />
              ))}
            </View>
            <Text style={[styles.caption, { color: theme.muted }]}>SEPARATOR</Text>
            <View style={styles.chips}>
              {["-", ".", "_", " "].map((separator) => (
                <Chip
                  key={separator || "space"}
                  label={separator === " " ? "space" : separator}
                  active={phrase.separator === separator}
                  onPress={() => setPhrase((current) => ({ ...current, separator }))}
                />
              ))}
            </View>
            <Toggle
              label="Capitalise words"
              value={phrase.capitalize}
              onChange={(value) => setPhrase((current) => ({ ...current, capitalize: value }))}
            />
            <Toggle
              label="Append a number"
              value={phrase.include_number}
              onChange={(value) => setPhrase((current) => ({ ...current, include_number: value }))}
            />
          </View>
        </>
      )}

      <Text style={[styles.footnote, { color: theme.muted }]}>
        Generated values exist only in this screen until you copy them or save them to the vault.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14, paddingBottom: 30 },
  header: { gap: 4 },
  title: { fontSize: 20, fontWeight: "800" },
  meta: { fontSize: 11.5, lineHeight: 16 },
  tabs: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  output: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 12 },
  outputText: { fontSize: 20, fontWeight: "700", letterSpacing: 0.6, lineHeight: 28 },
  outputActions: { flexDirection: "row", gap: 8 },
  card: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 12 },
  stepperRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  stepBtn: { width: 42, height: 42, borderWidth: 1, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  stepText: { fontSize: 21, fontWeight: "700" },
  length: { fontSize: 24, fontWeight: "800", fontVariant: ["tabular-nums"] },
  caption: { fontSize: 10.5, fontWeight: "700", letterSpacing: 0.8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 10, fontSize: 14.5 },
  footnote: { fontSize: 10.5, textAlign: "center" },
});
