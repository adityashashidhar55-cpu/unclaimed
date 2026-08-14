import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { T } from '../src/lib/theme';

export default function Home() {
  const router = useRouter();
  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ padding: 24, paddingBottom: 48 }}>
      <Text style={s.eyebrow}>2,216 REAL PROGRAMMES · 25 COUNTRIES · SOURCED &amp; DATED</Text>
      <Text style={s.h1}>
        How much money are you <Text style={s.accent}>leaving on the table</Text>?
      </Text>
      <Text style={s.lede}>
        Governments pay out rent support, family payments, energy discounts and tax credits — and most
        of it goes unclaimed because nobody tells you it exists.
      </Text>

      <Pressable style={s.cta} onPress={() => router.push('/check')}>
        <Text style={s.ctaText}>Check what you're owed</Text>
      </Pressable>
      <Text style={s.tiny}>
        Free to see your total. Nothing is stored until you create an account.
      </Text>

      <View style={s.card}>
        <Text style={s.cardH}>What you get free</Text>
        <Text style={s.cardP}>Your total, how many schemes, and how many pay out automatically.</Text>
      </View>
      <View style={s.card}>
        <Text style={s.cardH}>What a subscription unlocks</Text>
        <Text style={s.cardP}>
          Which schemes, the exact steps, the documents, and a prepared application for each one —
          drafted, filled and ready for you to send.
        </Text>
      </View>

      <Text style={s.disclaimer}>
        Discovery tool, not advice. Every figure is the published rule, not a decision on your case.
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: T.paper },
  eyebrow: { fontSize: 11, letterSpacing: 1.4, color: T.terracotta, marginBottom: 16, fontWeight: '600' },
  h1: { fontSize: 38, lineHeight: 42, fontWeight: '700', color: T.ink, letterSpacing: -0.8 },
  accent: { color: T.terracotta, fontStyle: 'italic' },
  lede: { fontSize: 17, lineHeight: 26, color: T.ink2, marginTop: 18 },
  cta: {
    backgroundColor: T.terracotta, paddingVertical: 18, borderRadius: 999,
    alignItems: 'center', marginTop: 28, minHeight: 56, justifyContent: 'center',
  },
  ctaText: { color: T.paper, fontSize: 17, fontWeight: '700' },
  tiny: { fontSize: 12, color: T.ink3, marginTop: 10, textAlign: 'center' },
  card: { backgroundColor: T.card, borderColor: T.line, borderWidth: 1, borderRadius: T.radius, padding: 18, marginTop: 18 },
  cardH: { fontSize: 17, fontWeight: '700', color: T.ink, marginBottom: 6 },
  cardP: { fontSize: 14, lineHeight: 21, color: T.ink2 },
  disclaimer: { fontSize: 12, color: T.ink3, marginTop: 32, lineHeight: 18 },
});
