import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { T } from '../src/lib/theme';
import { me, requestLink, billingOrigin } from '../src/lib/api';

export default function Account() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [state, setState] = useState(null);

  useEffect(() => { me().then(({ data }) => setState(data)).catch(() => setState({ signed_in: false })); }, []);

  async function send() {
    await requestLink(email);
    setSent(true);
  }

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ padding: 20 }}>
      {state?.signed_in ? (
        <>
          <Text style={s.h1}>Signed in</Text>
          <Text style={s.p}>{state.email}</Text>
          <View style={s.card}>
            <Text style={s.cardH}>Subscription</Text>
            <Text style={s.p}>
              {state.entitlement?.entitled
                ? state.entitlement.reason === 'free_in_jurisdiction'
                  ? 'Included free in your country — the law reserves paid help with a claim here.'
                  : 'Active'
                : 'Not subscribed'}
            </Text>
            <Pressable style={s.cta} onPress={() => WebBrowser.openBrowserAsync(`${billingOrigin}/account/`)}>
              <Text style={s.ctaText}>Manage on the web</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <>
          <Text style={s.h1}>Sign in</Text>
          <Text style={s.p}>We email you a link. No password to forget.</Text>
          <TextInput
            style={s.input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <Pressable style={s.cta} onPress={send}>
            <Text style={s.ctaText}>{sent ? 'Link sent — check your email' : 'Email me a link'}</Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: T.paper },
  h1: { fontSize: 28, fontWeight: '700', color: T.ink },
  p: { fontSize: 15, color: T.ink2, marginTop: 10, lineHeight: 22 },
  input: { backgroundColor: T.card, borderWidth: 1, borderColor: T.line, borderRadius: 10, padding: 14, fontSize: 16, marginTop: 18, minHeight: 50 },
  cta: { backgroundColor: T.terracotta, paddingVertical: 17, borderRadius: 999, alignItems: 'center', marginTop: 16, minHeight: 54, justifyContent: 'center' },
  ctaText: { color: T.paper, fontSize: 16, fontWeight: '700' },
  card: { backgroundColor: T.card, borderWidth: 1, borderColor: T.line, borderRadius: 12, padding: 18, marginTop: 22 },
  cardH: { fontSize: 16, fontWeight: '700', color: T.ink },
});
