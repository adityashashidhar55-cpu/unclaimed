import { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { T } from '../src/lib/theme';
import { vaultList } from '../src/lib/api';
import { DOC_TYPES, docLabel, expiresAt, isExpired, isExpiringSoon } from '../src/packages/vault/index.js';

/**
 * The document vault.
 *
 * Deliberately boring to look at, because the value is that it removes a
 * Saturday afternoon from the user's life: keep the payslip once, and the
 * next eight claims that ask for it are already answered.
 *
 * Everything is encrypted on device before it leaves. This screen shows
 * metadata the server is allowed to know — a type and two dates — and nothing
 * else. The files themselves are opened locally.
 */
export default function Documents() {
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    (async () => {
      try {
        const { status, data } = await vaultList();
        if (status === 401) return setState({ loading: false, signedOut: true });
        setState({ loading: false, documents: data?.documents ?? [] });
      } catch (e) {
        setState({ loading: false, error: e.message });
      }
    })();
  }, []);

  if (state.loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={T.terracotta} />
      </View>
    );
  }

  if (state.signedOut) {
    return (
      <View style={s.center}>
        <Text style={s.h2}>Sign in to use your vault</Text>
        <Text style={s.p}>Your documents are encrypted with your passphrase before they leave this device.</Text>
      </View>
    );
  }

  if (state.error) {
    return (
      <View style={s.center}>
        <Text style={s.err}>{state.error}</Text>
      </View>
    );
  }

  const now = Date.now();
  const docs = state.documents || [];
  const stale = docs.filter((d) => isExpired({ type: d.doc_type, issued_at: d.issued_at }, now));
  const soon = docs.filter((d) => isExpiringSoon({ type: d.doc_type, issued_at: d.issued_at }, now));

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
      <Text style={s.h1}>Your documents</Text>
      <Text style={s.lede}>
        Stored once, reused by every claim that asks for them. Encrypted on this device — we cannot read them.
      </Text>

      {docs.length === 0 ? (
        <View style={s.card}>
          <Text style={s.cardH}>Nothing here yet</Text>
          <Text style={s.p}>
            Add a proof of identity, a recent payslip and a proof of address first. Those three unlock more
            claims than anything else.
          </Text>
        </View>
      ) : null}

      {stale.length > 0 ? (
        <View style={[s.card, s.warn]}>
          <Text style={s.cardH}>{stale.length} out of date</Text>
          <Text style={s.p}>
            Agencies usually want these dated within the last three months. Replace them before you submit.
          </Text>
        </View>
      ) : null}

      {soon.length > 0 ? (
        <View style={s.card}>
          <Text style={s.cardH}>{soon.length} expiring within a month</Text>
        </View>
      ) : null}

      {docs.map((d) => {
        const exp = expiresAt({ type: d.doc_type, issued_at: d.issued_at });
        const dead = isExpired({ type: d.doc_type, issued_at: d.issued_at }, now);
        return (
          <View key={d.id} style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowH}>{docLabel(d.doc_type, 'en')}</Text>
              <Text style={s.meta}>
                {Math.round(d.bytes / 1024)} KB
                {exp ? ` · ${dead ? 'out of date' : `valid to ${new Date(exp).toLocaleDateString()}`}` : ' · no expiry'}
                {d.source && d.source !== 'upload' ? ` · via ${d.source}` : ''}
              </Text>
            </View>
            {dead ? <Text style={s.badge}>Replace</Text> : null}
          </View>
        );
      })}

      <View style={s.card}>
        <Text style={s.cardH}>What we never do</Text>
        <Text style={s.p}>
          We never hold a login to a government website, and we never send your documents to an agency for
          you. You attach them yourself, from your own account. The vault exists so that you only ever have
          to find each one once.
        </Text>
      </View>

      <Text style={s.foot}>
        {Object.keys(DOC_TYPES).length - 1} document types recognised across 25 countries.
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: T.cream },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: T.cream },
  h1: { fontSize: 30, fontWeight: '700', color: T.ink, marginBottom: 8 },
  h2: { fontSize: 20, fontWeight: '700', color: T.ink, marginBottom: 8, textAlign: 'center' },
  lede: { fontSize: 15, color: T.ink3, marginBottom: 24, lineHeight: 22 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: T.line },
  warn: { borderColor: T.terracotta },
  cardH: { fontSize: 16, fontWeight: '700', color: T.ink, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: T.line },
  rowH: { fontSize: 16, color: T.ink, fontWeight: '600' },
  meta: { fontSize: 13, color: T.ink3, marginTop: 3 },
  badge: { fontSize: 12, color: T.terracotta, fontWeight: '700' },
  p: { fontSize: 14, color: T.ink3, lineHeight: 21 },
  err: { color: T.terracotta, fontSize: 15, textAlign: 'center' },
  foot: { fontSize: 12, color: T.ink3, marginTop: 24, textAlign: 'center' },
});
