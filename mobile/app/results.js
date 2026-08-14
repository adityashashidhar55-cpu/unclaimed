import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { T } from '../src/lib/theme';
import { billingOrigin } from '../src/lib/api';

const money = (n, cur) => {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${cur} ${n}`;
  }
};

export default function Results() {
  const { payload, profile } = useLocalSearchParams();
  const router = useRouter();
  const r = JSON.parse(payload);
  const locked = !r.entitled;

  const headline = r.total_max > 0
    ? (r.total_min > 0 && r.total_min !== r.total_max
        ? `${money(r.total_min, r.currency)}–${money(r.total_max, r.currency)}`
        : `up to ${money(r.total_max, r.currency)}`)
    : `${r.counts.eligible} programmes`;

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
      {/* FREE — the number is always visible. That is the whole promise. */}
      <View style={s.hero}>
        <Text style={s.heroEyebrow}>{r.country.toUpperCase()} · MATCHED AGAINST THE FULL CATALOGUE</Text>
        <Text style={s.figure}>{headline}</Text>
        <Text style={s.figureUnit}>PER YEAR IN PUBLISHED CEILINGS YOU APPEAR TO QUALIFY FOR</Text>
        <Text style={s.heroNote}>
          {r.counts.eligible} eligible · {r.counts.must_apply} need an application · {r.counts.automatic} pay
          out automatically{r.counts.conditional ? ` · ${r.counts.conditional} depend on a circumstance you didn't claim` : ''}
        </Text>
        {r.counts.unpriced > 0 && (
          <View style={s.honest}>
            <Text style={s.honestText}>
              <Text style={{ fontWeight: '700', color: '#f0c8a8' }}>This is not your real total. </Text>
              {r.counts.unpriced} of your matches publish no fixed amount — the authority calculates it from your
              circumstances — so they count as zero here. They are often the largest of all.
            </Text>
          </View>
        )}
      </View>

      {/* Category shape: enough to make the number feel real without giving
          away what the subscription is for. */}
      <Text style={s.h2}>Where it comes from</Text>
      <View style={s.catWrap}>
        {Object.entries(r.by_category).map(([cat, n]) => (
          <View key={cat} style={s.cat}>
            <Text style={s.catN}>{n}</Text>
            <Text style={s.catL}>{cat.replace(/_/g, ' ')}</Text>
          </View>
        ))}
      </View>

      {locked ? (
        <View style={s.wall}>
          <Text style={s.wallH}>Which schemes, and how to claim them</Text>
          <Text style={s.wallP}>
            You've seen the total for free — that part stays free forever. A subscription unlocks the
            {' '}{r.counts.eligible} schemes behind it: what each one is, the exact steps, the documents you need,
            and a prepared application for every single one, drafted and filled ready to send.
          </Text>
          <Pressable
            style={s.cta}
            onPress={() => WebBrowser.openBrowserAsync(`${billingOrigin}/pricing/?from=app`)}
          >
            <Text style={s.ctaText}>See plans</Text>
          </Pressable>
          <Text style={s.tiny}>
            Already subscribed on the web? Sign in and it unlocks here.
          </Text>
          <Pressable onPress={() => router.push('/account')}>
            <Text style={s.link}>Sign in</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <Text style={s.h2}>Apply for these</Text>
          {r.eligible.filter((p) => !p.is_automatic).map((p) => (
            <Pressable
              key={p.slug}
              style={s.card}
              onPress={() => router.push({ pathname: `/apply/${p.slug}`, params: { profile } })}
            >
              <Text style={s.cardH}>{p.name_en}</Text>
              <Text style={s.cardSub}>{p.funder}</Text>
              <View style={s.badges}>
                <Badge tone={p.verification_status === 'verified' ? 'verified' : 'auto'}>
                  {p.verification_status === 'verified' ? 'Verified' : 'Not human-checked'}
                </Badge>
                {p.documents_required?.length ? <Badge>{p.documents_required.length} documents</Badge> : null}
              </View>
            </Pressable>
          ))}

          <Pressable style={s.cta} onPress={() => router.push({ pathname: '/apply', params: { profile } })}>
            <Text style={s.ctaText}>Prepare all my applications</Text>
          </Pressable>
        </>
      )}

      <Text style={s.disclaimer}>{r.disclaimer}</Text>
      <Text style={s.tiny}>Data as of {r.data_as_of}.</Text>
    </ScrollView>
  );
}

function Badge({ children, tone }) {
  const bg = tone === 'verified' ? T.verifiedBg : tone === 'auto' ? T.autoBg : T.paper2;
  const fg = tone === 'verified' ? T.verifiedFg : tone === 'auto' ? T.autoFg : T.ink2;
  return (
    <View style={[s.badge, { backgroundColor: bg }]}>
      <Text style={[s.badgeText, { color: fg }]}>{children}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: T.paper },
  hero: { backgroundColor: T.ink, borderRadius: 16, padding: 24 },
  heroEyebrow: { color: '#a89c8a', fontSize: 10, letterSpacing: 1.2, marginBottom: 14 },
  figure: { color: '#f0c8a8', fontSize: 44, fontWeight: '700', letterSpacing: -1.5 },
  figureUnit: { color: '#a89c8a', fontSize: 11, letterSpacing: 0.8, marginTop: 10 },
  heroNote: { color: '#cfc7b8', fontSize: 13, lineHeight: 20, marginTop: 16 },
  honest: { borderWidth: 1, borderColor: '#3d3831', borderRadius: 10, padding: 14, marginTop: 16 },
  honestText: { color: '#cfc7b8', fontSize: 13, lineHeight: 19 },
  h2: { fontSize: 22, fontWeight: '700', color: T.ink, marginTop: 30, marginBottom: 12 },
  catWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cat: { backgroundColor: T.card, borderWidth: 1, borderColor: T.line, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14, minWidth: 96 },
  catN: { fontSize: 22, fontWeight: '700', color: T.ink },
  catL: { fontSize: 12, color: T.ink3, marginTop: 2, textTransform: 'capitalize' },
  wall: { backgroundColor: T.card, borderWidth: 1, borderColor: T.line, borderRadius: 16, padding: 22, marginTop: 28 },
  wallH: { fontSize: 20, fontWeight: '700', color: T.ink, marginBottom: 10 },
  wallP: { fontSize: 14, lineHeight: 22, color: T.ink2 },
  cta: { backgroundColor: T.terracotta, paddingVertical: 17, borderRadius: 999, alignItems: 'center', marginTop: 20, minHeight: 54, justifyContent: 'center' },
  ctaText: { color: T.paper, fontSize: 16, fontWeight: '700' },
  link: { color: T.terracotta, textAlign: 'center', marginTop: 12, fontWeight: '600', paddingVertical: 12 },
  card: { backgroundColor: T.card, borderWidth: 1, borderColor: T.line, borderRadius: 12, padding: 16, marginBottom: 10 },
  cardH: { fontSize: 16, fontWeight: '700', color: T.ink },
  cardSub: { fontSize: 13, color: T.ink3, marginTop: 3 },
  badges: { flexDirection: 'row', gap: 6, marginTop: 10, flexWrap: 'wrap' },
  badge: { borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  badgeText: { fontSize: 11, fontWeight: '600' },
  tiny: { fontSize: 12, color: T.ink3, marginTop: 10, textAlign: 'center' },
  disclaimer: { fontSize: 12, color: T.ink3, marginTop: 28, lineHeight: 18 },
});
