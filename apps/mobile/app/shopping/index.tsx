import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, TextInput, Alert, Linking, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { WaveBackground } from '@/components/WaveBackground';
import { T } from '@/lib/theme';
import { shoppingListAPI } from '@/lib/api';
import { useSettingsStore } from '@/store/settings';

type ShoppingItem = {
  id: string;
  name: string;
  store: string;
  checked: boolean;
  deeplink?: string;
  created_at?: string;
};

type StoreConfig = {
  key: string;
  label: string;
  emoji: string;
  gradient: [string, string];
};

const STORES: StoreConfig[] = [
  { key: 'amazon',    label: 'Amazon',    emoji: '📦', gradient: ['#FF9900', '#F0760A'] },
  { key: 'walmart',   label: 'Walmart',   emoji: '🏪', gradient: ['#0071CE', '#004A8C'] },
  { key: 'instacart', label: 'Instacart', emoji: '🌿', gradient: ['#43B02A', '#2D8A1A'] },
  { key: 'general',   label: 'General',   emoji: '🛒', gradient: ['#7C3AED', '#5B21B6'] },
];

const ST = {
  en: {
    title: 'Shopping',
    sub: 'Your shopping lists',
    add: 'Add item...',
    addBtn: 'Add',
    empty: 'No items yet.',
    deeplink: 'Shop',
    checked: 'Purchased ✓',
    clear: 'Clear list',
    clearConfirm: 'Remove all items from this list?',
    yes: 'Yes, clear',
    cancel: 'Cancel',
    errLoad: 'Could not load shopping list.',
    errAdd: 'Could not add item.',
  },
  es: {
    title: 'Compras',
    sub: 'Tus listas de compras',
    add: 'Agregar artículo...',
    addBtn: 'Agregar',
    empty: 'No hay artículos.',
    deeplink: 'Comprar',
    checked: 'Comprado ✓',
    clear: 'Limpiar lista',
    clearConfirm: '¿Eliminar todos los artículos de esta lista?',
    yes: 'Sí, limpiar',
    cancel: 'Cancelar',
    errLoad: 'No se pudo cargar la lista.',
    errAdd: 'No se pudo agregar el artículo.',
  },
  pt: {
    title: 'Compras',
    sub: 'Suas listas de compras',
    add: 'Adicionar item...',
    addBtn: 'Adicionar',
    empty: 'Nenhum item ainda.',
    deeplink: 'Comprar',
    checked: 'Comprado ✓',
    clear: 'Limpar lista',
    clearConfirm: 'Remover todos os itens desta lista?',
    yes: 'Sim, limpar',
    cancel: 'Cancelar',
    errLoad: 'Não foi possível carregar a lista.',
    errAdd: 'Não foi possível adicionar o item.',
  },
  fr: {
    title: 'Courses',
    sub: 'Vos listes de courses',
    add: 'Ajouter un article...',
    addBtn: 'Ajouter',
    empty: 'Aucun article pour l\'instant.',
    deeplink: 'Acheter',
    checked: 'Acheté ✓',
    clear: 'Vider la liste',
    clearConfirm: 'Supprimer tous les articles de cette liste ?',
    yes: 'Oui, vider',
    cancel: 'Annuler',
    errLoad: 'Impossible de charger la liste.',
    errAdd: 'Impossible d\'ajouter l\'article.',
  },
} as const;

export default function ShoppingScreen() {
  const language = useSettingsStore((s) => s.language);
  const st = ST[language as keyof typeof ST] ?? ST.es;

  const [activeStore, setActiveStore] = useState<string>('general');
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [allItems, setAllItems] = useState<Record<string, ShoppingItem[]>>({});
  const [loading, setLoading] = useState(true);
  const [newItem, setNewItem] = useState('');
  const [adding, setAdding] = useState(false);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await shoppingListAPI.getItems();
      const data = res.data as any;
      const raw: ShoppingItem[] = Array.isArray(data?.items) ? data.items : [];
      const grouped: Record<string, ShoppingItem[]> = {};
      for (const store of STORES) {
        grouped[store.key] = raw.filter((i) => i.store === store.key);
      }
      setAllItems(grouped);
      setItems(grouped[activeStore] ?? []);
    } catch {
      Alert.alert('Error', st.errLoad);
    } finally {
      setLoading(false);
    }
  }, [st.errLoad, activeStore]);

  useEffect(() => { loadItems(); }, [loadItems]);
  useFocusEffect(useCallback(() => { loadItems(); }, [loadItems]));

  useEffect(() => {
    setItems(allItems[activeStore] ?? []);
  }, [activeStore, allItems]);

  const handleAdd = async () => {
    const text = newItem.trim();
    if (!text) return;
    setAdding(true);
    try {
      await shoppingListAPI.addItems([text], activeStore);
      setNewItem('');
      await loadItems();
    } catch {
      Alert.alert('Error', st.errAdd);
    } finally {
      setAdding(false);
    }
  };

  const handleCheck = async (id: string) => {
    try {
      // Optimistic update
      setItems((prev) => prev.map((i) => i.id === id ? { ...i, checked: true } : i));
      setAllItems((prev) => ({
        ...prev,
        [activeStore]: (prev[activeStore] ?? []).map((i) => i.id === id ? { ...i, checked: true } : i),
      }));
      await shoppingListAPI.checkItem(id);
    } catch {
      await loadItems();
    }
  };

  const handleOpenDeeplink = (item: ShoppingItem) => {
    const storeKey = item.store;
    const query = encodeURIComponent(item.name);
    let url = '';
    if (storeKey === 'amazon') {
      url = Platform.OS === 'ios'
        ? `com.amazon.mobile.shopping.web://www.amazon.com/s?k=${query}`
        : `https://www.amazon.com/s?k=${query}`;
    } else if (storeKey === 'walmart') {
      url = `https://www.walmart.com/search?q=${query}`;
    } else if (storeKey === 'instacart') {
      url = `https://www.instacart.com/store/s?k=${query}`;
    } else {
      return;
    }
    Linking.openURL(url).catch(() => {});
  };

  const handleClear = () => {
    Alert.alert(st.clear, st.clearConfirm, [
      { text: st.cancel, style: 'cancel' },
      {
        text: st.yes,
        style: 'destructive',
        onPress: async () => {
          try {
            await shoppingListAPI.clearStore(activeStore);
            await loadItems();
          } catch {}
        },
      },
    ]);
  };

  const storeCfg = STORES.find((s) => s.key === activeStore) ?? STORES[3];
  const pendingItems = items.filter((i) => !i.checked);
  const checkedItems = items.filter((i) => i.checked);
  const totalCount = Object.values(allItems).reduce((acc, arr) => acc + arr.filter((i) => !i.checked).length, 0);

  return (
    <SafeAreaView style={sty.container}>
      <Stack.Screen options={{
        title: st.title,
        headerBackTitle: language === 'en' ? 'Back' : language === 'pt' ? 'Voltar' : language === 'fr' ? 'Retour' : 'Atrás',
        headerStyle: { backgroundColor: T.colors.navy },
        headerTintColor: T.colors.white,
      }} />
      <WaveBackground opacity={0.04} cellSize={38} />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={sty.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Header ──────────────────────────── */}
        <LinearGradient
          colors={['#2D266C', '#7C3AED']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={sty.headerCard}
        >
          <Text style={sty.headerTitle}>🛒 {st.title}</Text>
          <Text style={sty.headerSub}>{totalCount} {language === 'en' ? 'items pending' : language === 'pt' ? 'itens pendentes' : language === 'fr' ? 'articles en attente' : 'artículos pendientes'}</Text>
        </LinearGradient>

        {/* ── Store tabs ──────────────────────── */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={sty.tabsScroll} contentContainerStyle={sty.tabsContent}>
          {STORES.map((store) => {
            const count = (allItems[store.key] ?? []).filter((i) => !i.checked).length;
            const isActive = activeStore === store.key;
            return (
              <TouchableOpacity
                key={store.key}
                style={[sty.tab, isActive && sty.tabActive]}
                onPress={() => setActiveStore(store.key)}
                activeOpacity={0.75}
              >
                <Text style={sty.tabEmoji}>{store.emoji}</Text>
                <Text style={[sty.tabLabel, isActive && sty.tabLabelActive]}>{store.label}</Text>
                {count > 0 && (
                  <View style={sty.tabBadge}>
                    <Text style={sty.tabBadgeText}>{count}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* ── Add item ────────────────────────── */}
        <View style={sty.addRow}>
          <TextInput
            style={sty.addInput}
            value={newItem}
            onChangeText={setNewItem}
            placeholder={st.add}
            placeholderTextColor={T.colors.muted}
            returnKeyType="done"
            onSubmitEditing={handleAdd}
            editable={!adding}
          />
          <TouchableOpacity
            style={[sty.addBtn, (!newItem.trim() || adding) && { opacity: 0.5 }]}
            onPress={handleAdd}
            disabled={!newItem.trim() || adding}
          >
            {adding
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={sty.addBtnText}>{st.addBtn}</Text>
            }
          </TouchableOpacity>
        </View>

        {/* ── Item list ───────────────────────── */}
        {loading ? (
          <ActivityIndicator color={T.colors.purple} style={{ marginTop: 40 }} />
        ) : pendingItems.length === 0 && checkedItems.length === 0 ? (
          <View style={sty.emptyBox}>
            <Text style={sty.emptyEmoji}>{storeCfg.emoji}</Text>
            <Text style={sty.emptyText}>{st.empty}</Text>
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            {pendingItems.map((item) => (
              <TouchableOpacity
                key={item.id}
                style={sty.itemCard}
                onPress={() => handleOpenDeeplink(item)}
                onLongPress={() => handleCheck(item.id)}
                activeOpacity={0.8}
              >
                <TouchableOpacity
                  style={sty.checkCircle}
                  onPress={() => handleCheck(item.id)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <View style={sty.checkCircleInner} />
                </TouchableOpacity>
                <Text style={sty.itemName} numberOfLines={2}>{item.name}</Text>
                {activeStore !== 'general' && (
                  <View style={sty.deepLinkBtn}>
                    <Text style={sty.deepLinkText}>{st.deeplink} →</Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}

            {checkedItems.length > 0 && (
              <>
                <Text style={sty.checkedHeader}>{st.checked}</Text>
                {checkedItems.map((item) => (
                  <View key={item.id} style={[sty.itemCard, sty.itemCardChecked]}>
                    <View style={[sty.checkCircle, sty.checkCircleDone]}>
                      <Text style={{ fontSize: 12, color: '#fff' }}>✓</Text>
                    </View>
                    <Text style={[sty.itemName, sty.itemNameChecked]} numberOfLines={1}>{item.name}</Text>
                  </View>
                ))}
              </>
            )}

            {items.length > 0 && (
              <TouchableOpacity style={sty.clearBtn} onPress={handleClear}>
                <Text style={sty.clearBtnText}>{st.clear}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const sty = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.colors.cream },
  scroll: { padding: 20, paddingBottom: 48, gap: 16 },
  headerCard: {
    borderRadius: 20,
    padding: 20,
    marginBottom: 4,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#fff',
    fontFamily: T.fonts.bold,
  },
  headerSub: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.75)',
    fontFamily: T.fonts.regular,
    marginTop: 4,
  },
  tabsScroll: { marginHorizontal: -20 },
  tabsContent: { paddingHorizontal: 20, gap: 8, flexDirection: 'row' },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 24,
    backgroundColor: T.colors.white,
    borderWidth: 1.5,
    borderColor: T.colors.border,
  },
  tabActive: {
    backgroundColor: T.colors.navy,
    borderColor: T.colors.navy,
  },
  tabEmoji: { fontSize: 16 },
  tabLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: T.colors.navy,
    fontFamily: T.fonts.semiBold,
  },
  tabLabelActive: { color: '#fff' },
  tabBadge: {
    backgroundColor: T.colors.purple,
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  tabBadgeText: { fontSize: 10, color: '#fff', fontWeight: '700' },
  addRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  addInput: {
    flex: 1,
    height: 46,
    backgroundColor: T.colors.white,
    borderRadius: 14,
    paddingHorizontal: 14,
    fontSize: 15,
    color: T.colors.navy,
    fontFamily: T.fonts.regular,
    borderWidth: 1,
    borderColor: T.colors.border,
  },
  addBtn: {
    backgroundColor: T.colors.purple,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 80,
  },
  addBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
    fontFamily: T.fonts.bold,
  },
  emptyBox: {
    alignItems: 'center',
    paddingTop: 40,
    gap: 12,
  },
  emptyEmoji: { fontSize: 52 },
  emptyText: {
    fontSize: 15,
    color: T.colors.muted,
    textAlign: 'center',
    fontFamily: T.fonts.regular,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: T.colors.white,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: T.colors.border,
    shadowColor: T.colors.navy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  itemCardChecked: {
    opacity: 0.55,
  },
  checkCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: T.colors.purple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkCircleInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: 'transparent',
  },
  checkCircleDone: {
    backgroundColor: T.colors.purple,
    borderColor: T.colors.purple,
  },
  itemName: {
    flex: 1,
    fontSize: 15,
    color: T.colors.navy,
    fontFamily: T.fonts.regular,
    lineHeight: 20,
  },
  itemNameChecked: {
    textDecorationLine: 'line-through',
    color: T.colors.muted,
  },
  deepLinkBtn: {
    backgroundColor: '#F3F0FF',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  deepLinkText: {
    fontSize: 12,
    color: T.colors.purple,
    fontWeight: '600',
    fontFamily: T.fonts.semiBold,
  },
  checkedHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: T.colors.muted,
    fontFamily: T.fonts.semiBold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 8,
  },
  clearBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 8,
  },
  clearBtnText: {
    fontSize: 13,
    color: '#EF4444',
    fontWeight: '600',
    fontFamily: T.fonts.semiBold,
  },
});
