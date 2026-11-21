/**
 * Small, dependency-free UI kit.
 *
 * Acuye Pass ships no component library on Android; these primitives keep the
 * screens consistent and let one file own accessibility and touch feedback.
 */

import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { useApp } from "../app-context";

export function Btn(props: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  tone?: "primary" | "ghost" | "danger" | "soft";
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useApp();
  const tone = props.tone ?? "primary";
  const background =
    tone === "primary"
      ? theme.accent
      : tone === "danger"
        ? theme.dangerSoft
        : tone === "soft"
          ? theme.accentSoft
          : theme.surfaceAlt;
  const foreground =
    tone === "primary" ? theme.accentText : tone === "danger" ? theme.danger : tone === "soft" ? theme.accent : theme.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      onPress={props.onPress}
      disabled={props.disabled || props.busy}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: background,
          borderColor: tone === "ghost" ? theme.border : "transparent",
          borderWidth: tone === "ghost" ? 1 : 0,
          paddingVertical: props.compact ? 9 : 14,
          paddingHorizontal: props.compact ? 14 : 18,
          opacity: props.disabled ? 0.45 : pressed ? 0.85 : 1,
        },
        props.style,
      ]}
    >
      {props.busy ? (
        <ActivityIndicator size="small" color={foreground} />
      ) : (
        <Text style={[styles.buttonText, { color: foreground, fontSize: props.compact ? 13 : 15 }]}>
          {props.label}
        </Text>
      )}
    </Pressable>
  );
}

export function Field(props: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  secure?: boolean;
  multiline?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: "none" | "sentences" | "words";
  hint?: string;
  right?: React.ReactNode;
  onFocus?: () => void;
}) {
  const { theme } = useApp();
  const [hidden, setHidden] = useState(Boolean(props.secure));
  return (
    <View style={{ gap: 6 }}>
      <View style={styles.fieldHeader}>
        <Text style={[styles.fieldLabel, { color: theme.muted }]}>{props.label}</Text>
        <View style={styles.fieldActions}>
          {props.secure ? (
            <Pressable onPress={() => setHidden((current) => !current)} hitSlop={10}>
              <Text style={[styles.link, { color: theme.accent }]}>{hidden ? "Show" : "Hide"}</Text>
            </Pressable>
          ) : null}
          {props.right}
        </View>
      </View>
      <TextInput
        style={[
          styles.input,
          {
            backgroundColor: theme.surface,
            borderColor: theme.border,
            color: theme.text,
            minHeight: props.multiline ? 96 : undefined,
            textAlignVertical: props.multiline ? "top" : "center",
          },
        ]}
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor={theme.muted}
        secureTextEntry={hidden}
        multiline={props.multiline}
        autoCapitalize={props.autoCapitalize ?? "none"}
        autoCorrect={false}
        keyboardType={props.keyboardType ?? "default"}
        onFocus={props.onFocus}
      />
      {props.hint ? <Text style={[styles.hint, { color: theme.muted }]}>{props.hint}</Text> : null}
    </View>
  );
}

export function Toggle(props: { label: string; description?: string; value: boolean; onChange: (value: boolean) => void }) {
  const { theme } = useApp();
  return (
    <View style={styles.toggleRow}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.rowTitle, { color: theme.text }]}>{props.label}</Text>
        {props.description ? (
          <Text style={[styles.rowSubtitle, { color: theme.muted }]}>{props.description}</Text>
        ) : null}
      </View>
      <Switch
        accessibilityLabel={props.label}
        value={props.value}
        onValueChange={props.onChange}
        trackColor={{ false: theme.border, true: theme.accentSoft }}
        thumbColor={props.value ? theme.accent : theme.surface}
      />
    </View>
  );
}

export function Chip(props: { label: string; active?: boolean; onPress: () => void; glyph?: string }) {
  const { theme } = useApp();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(props.active) }}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: props.active ? theme.accentSoft : theme.surface,
          borderColor: props.active ? theme.accent : theme.border,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      {props.glyph ? (
        <Text style={[styles.chipGlyph, { color: props.active ? theme.accent : theme.muted }]}>{props.glyph}</Text>
      ) : null}
      <Text style={[styles.chipText, { color: props.active ? theme.accent : theme.muted }]}>{props.label}</Text>
    </Pressable>
  );
}

export function Card(props: { children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  const { theme } = useApp();
  const content = (
    <View
      style={[
        {
          backgroundColor: theme.surface,
          borderColor: theme.border,
          borderWidth: 1,
          borderRadius: theme.radius,
          padding: theme.space(2),
          gap: theme.space(1.5),
        },
        props.style,
      ]}
    >
      {props.children}
    </View>
  );
  if (!props.onPress) return content;
  return (
    <Pressable onPress={props.onPress} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
      {content}
    </Pressable>
  );
}

export function SectionTitle(props: { title: string; caption?: string; right?: React.ReactNode }) {
  const { theme } = useApp();
  return (
    <View style={styles.sectionTitle}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.sectionHeading, { color: theme.text }]}>{props.title}</Text>
        {props.caption ? (
          <Text style={[styles.sectionCaption, { color: theme.muted }]}>{props.caption}</Text>
        ) : null}
      </View>
      {props.right}
    </View>
  );
}

export function LinkRow(props: {
  title: string;
  subtitle?: string;
  glyph?: string;
  tone?: "default" | "danger";
  onPress: () => void;
  right?: React.ReactNode;
}) {
  const { theme } = useApp();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.title}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.linkRow,
        { backgroundColor: theme.surface, borderColor: theme.border, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      {props.glyph ? (
        <View style={[styles.glyph, { backgroundColor: theme.accentSoft }]}>
          <Text style={[styles.glyphText, { color: theme.accent }]}>{props.glyph}</Text>
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.rowTitle, { color: props.tone === "danger" ? theme.danger : theme.text }]}>
          {props.title}
        </Text>
        {props.subtitle ? (
          <Text style={[styles.rowSubtitle, { color: theme.muted }]}>{props.subtitle}</Text>
        ) : null}
      </View>
      {props.right ?? <Text style={[styles.chevron, { color: theme.muted }]}>›</Text>}
    </Pressable>
  );
}

export function Badge(props: { label: string; tone?: "accent" | "success" | "danger" | "warning" | "muted" }) {
  const { theme } = useApp();
  const tone = props.tone ?? "muted";
  const background =
    tone === "accent"
      ? theme.accentSoft
      : tone === "success"
        ? theme.successSoft
        : tone === "danger"
          ? theme.dangerSoft
          : tone === "warning"
            ? theme.warningSoft
            : theme.surfaceAlt;
  const color =
    tone === "accent"
      ? theme.accent
      : tone === "success"
        ? theme.success
        : tone === "danger"
          ? theme.danger
          : tone === "warning"
            ? theme.warning
            : theme.muted;
  return (
    <View style={[styles.badge, { backgroundColor: background }]}>
      <Text style={[styles.badgeText, { color }]}>{props.label}</Text>
    </View>
  );
}

export function Empty(props: { title: string; body: string; action?: React.ReactNode }) {
  const { theme } = useApp();
  return (
    <View style={styles.empty}>
      <Text style={[styles.emptyTitle, { color: theme.text }]}>{props.title}</Text>
      <Text style={[styles.emptyBody, { color: theme.muted }]}>{props.body}</Text>
      {props.action}
    </View>
  );
}

export function Loading(props: { label?: string }) {
  const { theme } = useApp();
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={theme.accent} />
      {props.label ? <Text style={[styles.hint, { color: theme.muted }]}>{props.label}</Text> : null}
    </View>
  );
}

export function ErrorBox(props: { message: string }) {
  const { theme } = useApp();
  return (
    <View style={[styles.errorBox, { backgroundColor: theme.dangerSoft }]}>
      <Text style={[styles.errorText, { color: theme.danger }]}>{props.message}</Text>
    </View>
  );
}

export function StrengthBar(props: { score: number; label: string; bits?: number }) {
  const { theme } = useApp();
  const colors = [theme.danger, theme.danger, theme.warning, theme.success, theme.success];
  const color = colors[Math.min(4, Math.max(0, props.score))];
  return (
    <View style={{ gap: 6 }}>
      <View style={styles.track}>
        <View style={[styles.fill, { backgroundColor: color, width: `${Math.max(6, ((props.score + 1) / 5) * 100)}%` }]} />
      </View>
      <Text style={[styles.hint, { color: theme.muted }]}>
        {props.label}
        {typeof props.bits === "number" ? ` · ~${Math.round(props.bits)} bits` : ""}
      </Text>
    </View>
  );
}

/** Bottom sheet with a sticky header, used by every form and picker. */
export function Sheet(props: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  subtitle?: string;
}) {
  const { theme } = useApp();
  return (
    <Modal visible={props.visible} animationType="slide" onRequestClose={props.onClose} transparent={false}>
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: theme.bg }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={[styles.sheetHeader, { borderBottomColor: theme.border }]}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[styles.sheetTitle, { color: theme.text }]} numberOfLines={1}>
              {props.title}
            </Text>
            {props.subtitle ? (
              <Text style={[styles.sheetSubtitle, { color: theme.muted }]}>{props.subtitle}</Text>
            ) : null}
          </View>
          <Pressable onPress={props.onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
            <Text style={[styles.sheetClose, { color: theme.accent }]}>Close</Text>
          </Pressable>
        </View>
        <ScrollView
          contentContainerStyle={{ padding: theme.space(2.5), gap: theme.space(1.75), paddingBottom: 64 }}
          keyboardShouldPersistTaps="handled"
        >
          {props.children}
        </ScrollView>
        {props.footer ? (
          <View style={[styles.sheetFooter, { backgroundColor: theme.surface, borderTopColor: theme.border }]}>
            {props.footer}
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Fade-in wrapper that respects the "reduce motion" setting. */
export function Fade(props: { children: React.ReactNode; trigger?: string | number }) {
  const { settings } = useApp();
  const opacity = useRef(new Animated.Value(settings.reduce_motion ? 1 : 0)).current;
  useEffect(() => {
    if (settings.reduce_motion) {
      opacity.setValue(1);
      return;
    }
    Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  }, [opacity, settings.reduce_motion, props.trigger]);
  return <Animated.View style={{ flex: 1, opacity }}>{props.children}</Animated.View>;
}

const styles = StyleSheet.create({
  button: { borderRadius: 13, alignItems: "center", justifyContent: "center" },
  buttonText: { fontWeight: "700" },
  fieldHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  fieldActions: { flexDirection: "row", gap: 12, alignItems: "center" },
  fieldLabel: { fontSize: 11, letterSpacing: 0.7, textTransform: "uppercase", fontWeight: "700" },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
  },
  hint: { fontSize: 11.5, lineHeight: 16 },
  link: { fontSize: 12.5, fontWeight: "700" },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 4 },
  rowTitle: { fontSize: 14.5, fontWeight: "600" },
  rowSubtitle: { fontSize: 12, lineHeight: 16 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipGlyph: { fontSize: 11, fontWeight: "800" },
  chipText: { fontSize: 12.5, fontWeight: "600" },
  sectionTitle: { flexDirection: "row", alignItems: "flex-end", gap: 12, marginTop: 6 },
  sectionHeading: { fontSize: 15.5, fontWeight: "700" },
  sectionCaption: { fontSize: 11.5, lineHeight: 16 },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  glyph: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  glyphText: { fontSize: 14, fontWeight: "800" },
  chevron: { fontSize: 20, fontWeight: "600" },
  badge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, alignSelf: "flex-start" },
  badgeText: { fontSize: 10.5, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase" },
  empty: { alignItems: "center", paddingVertical: 52, paddingHorizontal: 24, gap: 8 },
  emptyTitle: { fontSize: 15.5, fontWeight: "700" },
  emptyBody: { fontSize: 12.5, textAlign: "center", lineHeight: 18 },
  loading: { paddingVertical: 28, alignItems: "center", gap: 10 },
  errorBox: { borderRadius: 12, paddingHorizontal: 13, paddingVertical: 10 },
  errorText: { fontSize: 12.5, lineHeight: 18 },
  track: { height: 6, borderRadius: 999, backgroundColor: "rgba(148,163,184,0.28)", overflow: "hidden" },
  fill: { height: 6, borderRadius: 999 },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  sheetTitle: { fontSize: 17, fontWeight: "700" },
  sheetSubtitle: { fontSize: 11.5 },
  sheetClose: { fontSize: 13, fontWeight: "700" },
  sheetFooter: { padding: 14, borderTopWidth: 1 },
});
