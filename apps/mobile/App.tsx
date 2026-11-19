import React from "react";
import { SafeAreaView, StatusBar, StyleSheet, Text, View } from "react-native";

/**
 * Mobile scaffold only. No vault, authentication or sync logic lives here yet.
 * The desktop application is the supported target for this release.
 */
export default function App() {
  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#0b1220" />
      <View style={styles.content}>
        <Text style={styles.title}>Acuye Pass</Text>
        <Text style={styles.subtitle}>Mobile app is not available yet.</Text>
        <Text style={styles.body}>
          This scaffold is reserved for a future release. The Windows desktop application is the
          supported client today.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0b1220" },
  content: { flex: 1, justifyContent: "center", paddingHorizontal: 28, gap: 12 },
  title: { color: "#f8fafc", fontSize: 28, fontWeight: "700" },
  subtitle: { color: "#93c5fd", fontSize: 16, fontWeight: "600" },
  body: { color: "#94a3b8", fontSize: 14, lineHeight: 21 },
});
