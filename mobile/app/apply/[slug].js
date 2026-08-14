import { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator, Linking, Switch } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as MailComposer from 'expo-mail-composer';
import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import { T } from '../../src/lib/theme';
import { applyPlan, recordConsent } from '../../src/lib/api';

/**
 * One prepared application.
 *
 * The order on this screen is deliberate and legally load-bearing: the user
 * reads the drafted message, reads the exact declarations they are about to
 * swear, affirms them, and only then can they send. A benefits declaration
 * carries the same weight as a signed paper form and the person who repays an
 * error is them — so we show the words, capture the affirmation, and keep the
 * record.
 *
 * We never log into a government portal and never submit. The final act
 * happens in their session, on their device.
 */
export default function ApplyOne() {
  const { slug, profile } = useLocalSearchParams();
  const [pkg, setPkg] = useState(null);
  const [agreed, setAgreed] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await applyPlan(JSON.parse(profile), 'en');
      setPkg((data.packages || []).find((p) => p.programme_slug === slug) ?? null);
    })();
  }, [slug, profile]);

  if (!pkg) return <View style={s.center}><ActivityIndicator color={T.terracotta} /></View>;

  async function proceed(action) {
    if (!agreed) return;
    setSending(true);
    try {
      // Consent is written BEFORE the package leaves our hands.
      await recordConsent({
        programme_slug: pkg.programme_slug,
        country: pkg.country,
        attestations: pkg.attestations,
        values: pkg.fields,
      });

      if (action === 'email') {
        const available = await MailComposer.isAvailableAsync();
        if (available) {
          await MailComposer.composeAsync({ subject: pkg.message.subject, body: pkg.message.body });
        } else {
          await Clipboard.setStringAsync(`${pkg.message.subject}\n\n${pkg.message.body}`);
          alert('Copied to clipboard — paste it into your email app.');
        }
      } else {
        await Clipboard.setStringAsync(pkg.message.body);
        await WebBrowser.openBrowserAsync(pkg.submit.url);
      }
    } catch (e) {
      alert(e.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
      <Text style={s.h1}>{pkg.programme_slug}</Text>
      <Text style={s.pct}>{pkg.readiness.fields_pct}% filled from what you've told us</Text>

      {pkg.fields_missing.length > 0 && (
        <View style={s.warn}>
          <Text style={s.warnH}>Still needed</Text>
          {pkg.fields_missing.map((f) => <Text key={f} style={s.warnP}>• {f.replace(/_/g, ' ')}</Text>)}
        </View>
      )}

      <Text style={s.h2}>Your drafted message</Text>
      <View style={s.draft}>
        <Text style={s.draftSubject}>{pkg.message.subject}</Text>
        <Text style={s.draftBody}>{pkg.message.body}</Text>
      </View>

      {pkg.documents.length > 0 && (
        <>
          <Text style={s.h2}>Attach these</Text>
          {pkg.documents.map((d, i) => (
            <Text key={i} style={s.doc}>
              {d.mandatory ? '•' : '○'} {d.doc}{d.mandatory ? '' : ' (if applicable)'}
            </Text>
          ))}
        </>
      )}

      {pkg.steps.length > 0 && (
        <>
          <Text style={s.h2}>Steps from the official page</Text>
          {pkg.steps.map((st) => (
            <Text key={st.step} style={s.step}>{st.step}. {st.detail}</Text>
          ))}
        </>
      )}

      {/* The declarations, verbatim. Not a checkbox that says "I agree to the
          terms" — the actual sentences being sworn. */}
      <Text style={s.h2}>What you're declaring</Text>
      <View style={s.attest}>
        {pkg.attestations.map((a, i) => <Text key={i} style={s.attestLine}>• {a}</Text>)}
        <View style={s.switchRow}>
          <Switch value={agreed} onValueChange={setAgreed} trackColor={{ true: T.sage }} />
          <Text style={s.switchLabel}>I have read the above and confirm it is true.</Text>
        </View>
      </View>

      <Pressable style={[s.cta, (!agreed || sending) && { opacity: 0.4 }]} disabled={!agreed || sending} onPress={() => proceed('email')}>
        <Text style={s.ctaText}>{sending ? 'Preparing…' : 'Open in my email app'}</Text>
      </Pressable>
      <Pressable style={[s.cta2, (!agreed || sending) && { opacity: 0.4 }]} disabled={!agreed || sending} onPress={() => proceed('portal')}>
        <Text style={s.cta2Text}>Copy and open the official site</Text>
      </Pressable>

      <Text style={s.legal}>
        You send this yourself, from your own account. We prepare it; we never sign in as you and never submit
        on your behalf. That is a deliberate design choice — it keeps the declaration yours, which is what the
        law requires.
      </Text>

      <View style={s.source}>
        <Text style={s.sourceH}>Source</Text>
        <Pressable onPress={() => Linking.openURL(pkg.source.url)}>
          <Text style={s.sourceLink}>{pkg.source.url}</Text>
        </Pressable>
        <Text style={s.sourceMeta}>
          Last checked {pkg.source.last_verified_at} · {pkg.source.verification_status === 'verified' ? 'human-verified' : 'not yet human-checked'}
        </Text>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: T.paper },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: T.paper },
  h1: { fontSize: 26, fontWeight: '700', color: T.ink, letterSpacing: -0.5 },
  h2: { fontSize: 18, fontWeight: '700', color: T.ink, marginTop: 26, marginBottom: 10 },
  pct: { fontSize: 13, color: T.ink3, marginTop: 6 },
  warn: { backgroundColor: '#fdf8ec', borderLeftWidth: 4, borderLeftColor: '#9a7415', borderRadius: 10, padding: 14, marginTop: 16 },
  warnH: { fontWeight: '700', color: T.ink, marginBottom: 6 },
  warnP: { fontSize: 13, color: T.ink2, lineHeight: 20, textTransform: 'capitalize' },
  draft: { backgroundColor: T.card, borderWidth: 1, borderColor: T.line, borderRadius: 12, padding: 16 },
  draftSubject: { fontWeight: '700', color: T.ink, marginBottom: 10 },
  draftBody: { fontSize: 13, lineHeight: 20, color: T.ink2, fontFamily: 'System' },
  doc: { fontSize: 14, color: T.ink2, lineHeight: 24 },
  step: { fontSize: 14, color: T.ink2, lineHeight: 22, marginBottom: 6 },
  attest: { backgroundColor: '#f0f4ee', borderLeftWidth: 4, borderLeftColor: T.sage, borderRadius: 10, padding: 16 },
  attestLine: { fontSize: 13, color: T.ink2, lineHeight: 20, marginBottom: 6 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 },
  switchLabel: { flex: 1, fontSize: 14, fontWeight: '600', color: T.ink },
  cta: { backgroundColor: T.terracotta, paddingVertical: 17, borderRadius: 999, alignItems: 'center', marginTop: 20, minHeight: 54, justifyContent: 'center' },
  ctaText: { color: T.paper, fontSize: 16, fontWeight: '700' },
  cta2: { borderWidth: 1, borderColor: T.line, paddingVertical: 16, borderRadius: 999, alignItems: 'center', marginTop: 10, minHeight: 52, justifyContent: 'center' },
  cta2Text: { color: T.ink, fontSize: 15, fontWeight: '600' },
  legal: { fontSize: 12, color: T.ink3, lineHeight: 19, marginTop: 18 },
  source: { backgroundColor: T.paper2, borderRadius: 12, padding: 16, marginTop: 24 },
  sourceH: { fontSize: 12, fontWeight: '700', color: T.ink3, letterSpacing: 1, marginBottom: 6 },
  sourceLink: { fontSize: 13, color: T.terracotta },
  sourceMeta: { fontSize: 12, color: T.ink3, marginTop: 6 },
});
