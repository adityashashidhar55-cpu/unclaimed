import { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { T } from '../../src/lib/theme';
import { applyPlan } from '../../src/lib/api';

/**
 * The claim plan: every application, ordered so the user does the most
 * complete, highest-value one first, plus one consolidated list of what we
 * still need — asked once, not per form.
 */
export default function ApplyPlan() {
  const { profile } = useLocalSearchParams();
  const router = useRouter();
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    (async () => {
      try {
        const { status, data } = await applyPlan(JSON.parse(profile), 'en');
        setState({ loading: false, paywalled: status === 402, ...data });
      } catch (e) {
        setState({ loading: false, error: e.message });
      }
    })();
  }, [profile]);

  if (state.loading) return <View style={s.center}><ActivityIndicator color={T.terracotta} /></View>;
  if (state.error) return <View style={s.center}><Text style={s.err}>{state.error}</Text></View>;
  if (state.paywalled) {
    return (
      <View style={s.center}>
        <Text style={s.h2}>Subscription required</Text>
        <Text style={s.p}>Prepared applications are part of the paid plan.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
      <Text style={s.h1}>{state.ready_count} ready to send</Text>
      <Text style={s.p}>
        {state.packages.length} applications prepared. We fill everything we can from what you've told us —
        you review it and send it from your own account.
      </Text>

      {state.gaps?.length > 0 && (
        <View style={s.gaps}>
          <Text style={s.gapsH}>Tell us {state.gaps.length} more things and the rest unlock</Text>
          {state.gaps.slice(0, 6).map((g) => (
            <Text key={g.field} style={s.gap}>
              • {g.label} — unlocks {g.unlocks.length} application{g.unlocks.length === 1 ? '' : 's'}
            </Text>
          ))}
        </View>
      )}

      {state.packages.map((pkg) => (
        <Pressable
          key={pkg.programme_slug}
          style={s.card}
          onPress={() => router.push({ pathname: `/apply/${pkg.programme_slug}`, params: { profile } })}
        >
          <View style={s.cardTop}>
            <Text style={s.cardH}>{pkg.programme_slug}</Text>
            <Text style={[s.pct, pkg.readiness.ready && { color: T.sage }]}>{pkg.readiness.fields_pct}%</Text>
          </View>
          <View style={s.bar}>
            <View style={[s.barFill, { width: `${pkg.readiness.fields_pct}%` }]} />
          </View>
          <Text style={s.cardSub}>
            {pkg.readiness.ready
              ? 'Ready — review and send'
              : `${pkg.fields_missing.length} answer${pkg.fields_missing.length === 1 ? '' : 's'} still needed`}
            {pkg.documents.length ? ` · ${pkg.documents.length} documents` : ''}
          </Text>
          {pkg.blockers?.length > 0 && <Text style={s.blocked}>{pkg.blockers[0].message}</Text>}
        </Pressable>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: T.paper },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30, backgroundColor: T.paper },
  h1: { fontSize: 30, fontWeight: '700', color: T.ink, letterSpacing: -0.6 },
  h2: { fontSize: 20, fontWeight: '700', color: T.ink, marginBottom: 8 },
  p: { fontSize: 15, lineHeight: 23, color: T.ink2, marginTop: 10 },
  err: { color: '#8c2c2c', fontSize: 15 },
  gaps: { backgroundColor: '#fdf8ec', borderLeftWidth: 4, borderLeftColor: '#9a7415', borderRadius: 10, padding: 16, marginTop: 20 },
  gapsH: { fontSize: 15, fontWeight: '700', color: T.ink, marginBottom: 8 },
  gap: { fontSize: 13, color: T.ink2, lineHeight: 21 },
  card: { backgroundColor: T.card, borderWidth: 1, borderColor: T.line, borderRadius: 12, padding: 16, marginTop: 12 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardH: { fontSize: 15, fontWeight: '700', color: T.ink, flex: 1 },
  pct: { fontSize: 15, fontWeight: '700', color: T.ink3 },
  bar: { height: 4, backgroundColor: T.line, borderRadius: 2, marginTop: 10, overflow: 'hidden' },
  barFill: { height: 4, backgroundColor: T.sage },
  cardSub: { fontSize: 13, color: T.ink3, marginTop: 8 },
  blocked: { fontSize: 12, color: '#8c2c2c', marginTop: 8, lineHeight: 18 },
});
