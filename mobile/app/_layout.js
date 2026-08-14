import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { T } from '../src/lib/theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: T.paper },
          headerTintColor: T.ink,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: T.paper },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Unclaimed' }} />
        <Stack.Screen name="check" options={{ title: 'Check what you\'re owed' }} />
        <Stack.Screen name="results" options={{ title: 'Your result' }} />
        <Stack.Screen name="apply" options={{ title: 'Your applications' }} />
        <Stack.Screen name="apply/[slug]" options={{ title: 'Prepare application' }} />
        <Stack.Screen name="documents" options={{ title: 'Your documents' }} />
        <Stack.Screen name="account" options={{ title: 'Account' }} />
      </Stack>
    </SafeAreaProvider>
  );
}
