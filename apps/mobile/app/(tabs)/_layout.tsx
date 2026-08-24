import { Tabs } from 'expo-router';
import { CustomTabBar } from '@/components/CustomTabBar';

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="home" options={{ title: 'Inicio' }} />
      <Tabs.Screen name="calendar" options={{ title: 'Agenda' }} />
      <Tabs.Screen name="tasks" options={{ title: 'Tareas' }} />
      <Tabs.Screen name="dashboard" options={{ tabBarButton: () => null, href: null }} />
      <Tabs.Screen name="settings" options={{ title: 'Config' }} />
    </Tabs>
  );
}
