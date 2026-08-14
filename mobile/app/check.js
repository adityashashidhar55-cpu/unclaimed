import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { T } from '../src/lib/theme';
import { check } from '../src/lib/api';

const COUNTRIES = [
  ['fr', '🇫🇷 France'], ['gb', '🇬🇧 United Kingdom'], ['de', '🇩🇪 Germany'], ['es', '🇪🇸 Spain'],
  ['it', '🇮🇹 Italy'], ['pt', '🇵🇹 Portugal'], ['in', '🇮🇳 India'], ['us', '🇺🇸 United States'],
];
const STATUSES = [
  ['employee', 'Working for an employer'], ['self_employed', 'Self-employed'],
  ['student', 'Studying'], ['unemployed', 'Out of work'],
  ['jobseeker', 'Looking for work'], ['retired', 'Retired'], ['parent', 'At home with children'],
];
const TENURES = [['renting', 'I rent'], ['owner', 'I own my home'], ['hosted', 'With family or friends'], ['student_housing', 'Student housing']];
const CIRCUMSTANCES = [
  ['disability', 'Disability or long-term condition'], ['carer', 'I care for someone unpaid'],
  ['sickness', 'Off work sick'], ['newbaby', 'Pregnant or new baby'],
  ['bereavement', 'Recent bereavement'], ['veteran', 'Armed-forces service'],
];

export default function Check() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [p, setP] = useState({
    country_code: 'fr', status: 'employee', age: '', income_annual: '',
    household_size: '1', children_count: '0', housing_tenure: 'renting',
    nationality_group: 'citizen_or_pr', residency_months: '', circumstances: [],
  });

  const set = (k, v) => setP((prev) => ({ ...prev, [k]: v }));
  const toggle = (c) =>
    setP((prev) => ({
      ...prev,
      circumstances: prev.circumstances.includes(c)
        ? prev.circumstances.filter((x) => x !== c)
        : [...prev.circumstances, c],
    }));

  async function run() {
    setBusy(true);
    try {
      const profile = {
        ...p,
        country_code: p.country_code.toUpperCase(),
        age: p.age ? Number(p.age) : null,
        income_annual: p.income_annual ? Number(p.income_annual) : null,
        household_size: Number(p.household_size || 1),
        children_count: Number(p.children_count || 0),
        residency_months: p.residency_months ? Number(p.residency_months) : null,
        income_band: null, admin_area: null,
      };
      const { data } = await check(profile);
      router.push({ pathname: '/results', params: { payload: JSON.stringify(data), profile: JSON.stringify(profile) } });
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
      <Field label="Where do you live?">
        <Chips options={COUNTRIES} value={p.country_code} onChange={(v) => set('country_code', v)} />
      </Field>

      <Field label="What best describes you?">
        <Chips options={STATUSES} value={p.status} onChange={(v) => set('status', v)} />
      </Field>

      <Field
        label="Does any of this describe you?"
        hint="These unlock the largest payments. Unticked means we keep them out of your total rather than counting money you can't get."
      >
        <Chips multi options={CIRCUMSTANCES} value={p.circumstances} onChange={toggle} />
      </Field>

      <View style={s.row}>
        <Field label="Your age" flex>
          <TextInput style={s.input} keyboardType="number-pad" value={p.age} onChangeText={(v) => set('age', v)} placeholder="34" />
        </Field>
        <Field label="Household size" flex>
          <TextInput style={s.input} keyboardType="number-pad" value={p.household_size} onChangeText={(v) => set('household_size', v)} />
        </Field>
      </View>

      <View style={s.row}>
        <Field label="Children" flex>
          <TextInput style={s.input} keyboardType="number-pad" value={p.children_count} onChangeText={(v) => set('children_count', v)} />
        </Field>
        <Field label="Annual household income" flex>
          <TextInput style={s.input} keyboardType="number-pad" value={p.income_annual} onChangeText={(v) => set('income_annual', v)} placeholder="optional" />
        </Field>
      </View>

      <Field label="Housing">
        <Chips options={TENURES} value={p.housing_tenure} onChange={(v) => set('housing_tenure', v)} />
      </Field>

      <Pressable style={[s.cta, busy && { opacity: 0.6 }]} onPress={run} disabled={busy}>
        {busy ? <ActivityIndicator color={T.paper} /> : <Text style={s.ctaText}>See what I'm owed</Text>}
      </Pressable>
      <Text style={s.tiny}>Your answers are sent once to compute the result and are not stored unless you sign in.</Text>
    </ScrollView>
  );
}

function Field({ label, hint, children, flex }) {
  return (
    <View style={[{ marginBottom: 22 }, flex && { flex: 1 }]}>
      <Text style={s.label}>{label}</Text>
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
      {children}
    </View>
  );
}

function Chips({ options, value, onChange, multi }) {
  const on = (v) => (multi ? value.includes(v) : value === v);
  return (
    <View style={s.chips}>
      {options.map(([v, label]) => (
        <Pressable key={v} onPress={() => onChange(v)} style={[s.chip, on(v) && s.chipOn]}>
          <Text style={[s.chipText, on(v) && s.chipTextOn]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: T.paper },
  label: { fontSize: 15, fontWeight: '700', color: T.ink, marginBottom: 6 },
  hint: { fontSize: 12, color: T.ink3, marginBottom: 10, lineHeight: 17 },
  input: { backgroundColor: T.card, borderColor: T.line, borderWidth: 1, borderRadius: 10, padding: 14, fontSize: 16, color: T.ink, minHeight: 50 },
  row: { flexDirection: 'row', gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: T.line, backgroundColor: T.card, borderRadius: 999, paddingVertical: 11, paddingHorizontal: 15, minHeight: 44, justifyContent: 'center' },
  chipOn: { backgroundColor: T.ink, borderColor: T.ink },
  chipText: { fontSize: 14, color: T.ink2 },
  chipTextOn: { color: T.paper, fontWeight: '600' },
  cta: { backgroundColor: T.terracotta, paddingVertical: 18, borderRadius: 999, alignItems: 'center', marginTop: 8, minHeight: 56, justifyContent: 'center' },
  ctaText: { color: T.paper, fontSize: 17, fontWeight: '700' },
  tiny: { fontSize: 12, color: T.ink3, marginTop: 12, textAlign: 'center', lineHeight: 17 },
});
