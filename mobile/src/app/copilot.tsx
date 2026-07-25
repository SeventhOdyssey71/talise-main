import { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming } from "react-native-reanimated";

import { CHAT_SUGGESTIONS, greeting, sendChat, type ChatMessage } from "@/api/chat";
import { useSession } from "@/auth/session";
import { AgentIntentCard } from "@/components/chat/AgentIntentCard";
import { AgentMascot } from "@/components/chat/AgentMascot";
import { Icon } from "@/design/Icon";
import { colors, radius, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

let seq = 0;
const nextId = () => String(++seq);

/**
 * CopilotScreen — the Agent chat. Header + auto-scrolling transcript + a bottom
 * input pill. Empty state shows the mascot, a lede and 2×2 starter suggestions.
 * Assistant turns can carry an intent, rendered as an AgentIntentCard. Mirrors
 * the ios ChatTabView.
 */
export default function CopilotScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useSession();
  const firstName = user?.name?.split(" ")[0];

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(t);
  }, [messages]);

  const send = async (text: string) => {
    if (!text.trim() || sending) return;
    const userMsg: ChatMessage = { id: nextId(), role: "user", content: text, ts: Date.now() };
    const placeholderId = nextId();
    const history = [...messages.filter((m) => !m.streaming), userMsg];

    setMessages((prev) => [...prev, userMsg, { id: placeholderId, role: "assistant", content: "", streaming: true, ts: Date.now() }]);
    setInput("");
    setSending(true);

    try {
      const res = await sendChat(history.map((m) => ({ role: m.role, content: m.content })));
      setMessages((prev) =>
        prev.map((m) => (m.id === placeholderId ? { ...m, content: res.content || "…", streaming: false, intent: res.intent } : m)),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong. Please try again.";
      setMessages((prev) => prev.map((m) => (m.id === placeholderId ? { ...m, content: msg, streaming: false } : m)));
    } finally {
      setSending(false);
    }
  };

  const canSend = input.trim().length > 0 && !sending;

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.headerLeft}>
          <AgentMascot size={34} />
          <View style={styles.headerText}>
            <Text style={styles.greeting}>{greeting(firstName)}</Text>
            <Text style={styles.subtitle}>Let&apos;s make sense of your numbers.</Text>
          </View>
        </View>
        <Pressable style={styles.closeDisc} onPress={() => router.back()}>
          <Icon name="xmark" size={16} color={colors.fg} />
        </Pressable>
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={styles.transcript}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {messages.length === 0 ? (
            <View style={styles.empty}>
              <AgentMascot size={62} animated />
              <Text style={styles.emptyTitle}>Your money, made simple.</Text>
              <Text style={styles.emptyBody}>Ask me anything about your money and I&apos;ll help you make sense of it.</Text>
              <View style={styles.grid}>
                {CHAT_SUGGESTIONS.map((s) => (
                  <Pressable key={s.title} style={styles.suggestion} onPress={() => send(s.prompt)}>
                    <View style={styles.suggestionIcon}>
                      <Icon name={s.icon} size={18} color={colors.accent} />
                    </View>
                    <Text style={styles.suggestionTitle}>{s.title}</Text>
                    <Text style={styles.suggestionSubtitle}>{s.subtitle}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : (
            messages.map((m) => <MessageBubble key={m.id} message={m} />)
          )}
        </ScrollView>

        <View style={[styles.inputBar, { paddingBottom: insets.bottom + spacing.md }]}>
          <View style={styles.inputPill}>
            <TextInput
              style={styles.textInput}
              value={input}
              onChangeText={setInput}
              placeholder="Ask anything"
              placeholderTextColor={colors.fgDim}
              multiline
              maxLength={2000}
            />
            <Pressable
              style={[styles.sendButton, { backgroundColor: canSend ? colors.accent : colors.surface2 }]}
              onPress={() => send(input)}
              disabled={!canSend}
            >
              <Icon name={sending ? "ellipsis" : "arrow.up"} size={18} color={canSend ? colors.inkOnAccent : colors.fgDim} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <View style={styles.userRow}>
        <View style={styles.userBubble}>
          <Text style={styles.userText}>{message.content}</Text>
        </View>
      </View>
    );
  }

  const empty = message.streaming && !message.content;
  return (
    <View style={styles.assistantBlock}>
      <View style={styles.assistantRow}>
        <View style={styles.assistantMascot}>
          <AgentMascot size={30} />
        </View>
        <View style={styles.assistantBubble}>
          {empty ? <TypingDots /> : <Text style={styles.assistantText}>{message.content}</Text>}
        </View>
      </View>
      {message.intent ? (
        <View style={styles.intentWrap}>
          <AgentIntentCard intent={message.intent} />
        </View>
      ) : null}
    </View>
  );
}

function TypingDots() {
  return (
    <View style={styles.dotsRow}>
      <Dot delay={0} />
      <Dot delay={160} />
      <Dot delay={320} />
    </View>
  );
}

function Dot({ delay }: { delay: number }) {
  const v = useSharedValue(0.35);
  useEffect(() => {
    v.value = withDelay(delay, withRepeat(withTiming(1, { duration: 560, easing: Easing.inOut(Easing.ease) }), -1, true));
  }, [delay, v]);
  const style = useAnimatedStyle(() => ({ opacity: v.value }));
  return <Animated.View style={[styles.dot, style]} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: spacing.md, flex: 1 },
  headerText: { flex: 1 },
  greeting: { fontFamily: family.sans, fontSize: 18, fontWeight: "500", color: colors.fg },
  subtitle: { fontFamily: family.sans, fontSize: 13, color: colors.fgMuted },
  closeDisc: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  transcript: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.xl, gap: spacing.lg, flexGrow: 1 },

  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, paddingVertical: spacing.xxl },
  emptyTitle: { fontFamily: family.sans, fontSize: 22, fontWeight: "500", color: colors.fg, textAlign: "center", marginTop: spacing.sm },
  emptyBody: { fontFamily: family.sans, fontSize: 14, color: colors.fgMuted, textAlign: "center", lineHeight: 20, maxWidth: 300 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, marginTop: spacing.lg, justifyContent: "center" },
  suggestion: {
    width: "47%",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  suggestionIcon: { marginBottom: spacing.xs },
  suggestionTitle: { fontFamily: family.sans, fontSize: 14, fontWeight: "500", color: colors.fg },
  suggestionSubtitle: { fontFamily: family.sans, fontSize: 12, color: colors.fgMuted },

  userRow: { alignItems: "flex-end" },
  userBubble: { maxWidth: "78%", backgroundColor: colors.greenMint, borderRadius: 18, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  userText: { fontFamily: family.sans, fontSize: 15, color: "#0A140C", lineHeight: 21 },

  assistantBlock: { gap: spacing.sm },
  assistantRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  assistantMascot: { marginBottom: 2 },
  assistantBubble: { maxWidth: "82%", backgroundColor: colors.surface, borderRadius: 18, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  assistantText: { fontFamily: family.sans, fontSize: 15, color: colors.fg, lineHeight: 21 },
  intentWrap: { marginLeft: 30 + spacing.sm },

  dotsRow: { flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.fgMuted },

  inputBar: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  inputPill: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    backgroundColor: colors.surface2,
    borderRadius: radius.pill,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
    paddingVertical: spacing.xs,
  },
  textInput: {
    flex: 1,
    fontFamily: family.sans,
    fontSize: 15,
    color: colors.fg,
    maxHeight: 120,
    paddingVertical: spacing.sm,
    paddingTop: Platform.OS === "ios" ? spacing.sm : spacing.xs,
  },
  sendButton: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
});
