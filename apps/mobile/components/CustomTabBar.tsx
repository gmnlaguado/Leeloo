import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet, Platform } from 'react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Home, Calendar, ListTodo, Settings } from 'lucide-react-native';
import { T } from '@/lib/theme';

const TAB_ICONS: Record<string, (active: boolean) => React.ReactNode> = {
  home: (a) => <Home size={22} color={a ? T.colors.purple : '#B0AACC'} strokeWidth={a ? 2.5 : 1.8} />,
  calendar: (a) => <Calendar size={22} color={a ? T.colors.purple : '#B0AACC'} strokeWidth={a ? 2.5 : 1.8} />,
  tasks: (a) => <ListTodo size={22} color={a ? T.colors.purple : '#B0AACC'} strokeWidth={a ? 2.5 : 1.8} />,
  settings: (a) => <Settings size={22} color={a ? T.colors.purple : '#B0AACC'} strokeWidth={a ? 2.5 : 1.8} />,
};

export function CustomTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const visibleRoutes = state.routes.filter(
    (r) => descriptors[r.key].options.tabBarButton !== (() => null) &&
           !descriptors[r.key].options.href === false &&
           r.name !== 'dashboard',
  );

  // Split into left 2 and right 2 for center button
  const left = visibleRoutes.slice(0, 2);
  const right = visibleRoutes.slice(2);

  const navigateTo = (routeName: string) => {
    const target = state.routes.find((r) => r.name === routeName);
    if (!target) return;
    const isFocused = state.routes[state.index].name === routeName;
    if (!isFocused) navigation.navigate(routeName);
  };

  const activeRoute = state.routes[state.index].name;

  const pb = Math.max(insets.bottom, 8);

  return (
    <View style={[styles.container, { paddingBottom: pb, height: 64 + pb }]}>
      {/* Left tabs */}
      <View style={styles.side}>
        {left.map((route) => {
          const active = activeRoute === route.name;
          return (
            <TouchableOpacity
              key={route.key}
              style={styles.tabItem}
              onPress={() => navigateTo(route.name)}
              activeOpacity={0.7}
            >
              {TAB_ICONS[route.name]?.(active)}
              <Text style={[styles.label, active && styles.labelActive]}>
                {descriptors[route.key].options.title ?? route.name}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Center — Leeloo avatar button */}
      <View style={styles.centerWrap}>
        <TouchableOpacity
          onPress={() => navigateTo('home')}
          activeOpacity={0.85}
          style={styles.centerOuter}
        >
          <LinearGradient
            colors={['#F07040', '#C4507A', '#8375FA']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.centerBtn}
          >
            {/* Leeloo avatar mark — simplified SVG inline */}
            <Text style={styles.centerIcon}>◎</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {/* Right tabs */}
      <View style={styles.side}>
        {right.map((route) => {
          const active = activeRoute === route.name;
          return (
            <TouchableOpacity
              key={route.key}
              style={styles.tabItem}
              onPress={() => navigateTo(route.name)}
              activeOpacity={0.7}
            >
              {TAB_ICONS[route.name]?.(active)}
              <Text style={[styles.label, active && styles.labelActive]}>
                {descriptors[route.key].options.title ?? route.name}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: T.colors.white,
    borderTopWidth: 1,
    borderTopColor: '#EDE9F8',
    paddingHorizontal: 8,
    shadowColor: T.colors.navy,
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 8,
  },
  side: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 8,
    gap: 3,
  },
  label: {
    fontSize: 10,
    color: '#B0AACC',
    fontWeight: '500',
  },
  labelActive: {
    color: T.colors.purple,
    fontWeight: '700',
  },
  centerWrap: {
    width: 72,
    alignItems: 'center',
    justifyContent: 'flex-start',
    marginTop: -20,
  },
  centerOuter: {
    shadowColor: T.colors.orange,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 10,
  },
  centerBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: T.colors.white,
  },
  centerIcon: {
    fontSize: 26,
    color: T.colors.white,
    fontWeight: '700',
  },
});
