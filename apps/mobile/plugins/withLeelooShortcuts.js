/**
 * Expo config plugin — adds app shortcuts (long-press icon) for both platforms.
 *
 * Android: Static shortcuts via shortcuts.xml + AndroidManifest meta-data
 * iOS:     UIApplicationShortcutItems in Info.plist
 *
 * Shortcut opens leeloo://voice deep-link → HomeScreen handles it.
 */
const {
  withAndroidManifest,
  withInfoPlist,
  withDangerousMod,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const SHORTCUTS_XML = `<?xml version="1.0" encoding="utf-8"?>
<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">

  <shortcut
    android:shortcutId="activate_leeloo"
    android:enabled="true"
    android:icon="@mipmap/ic_launcher"
    android:shortcutShortLabel="@string/shortcut_activate_short"
    android:shortcutLongLabel="@string/shortcut_activate_long"
    android:shortcutDisabledMessage="@string/shortcut_disabled">
    <intent
      android:action="android.intent.action.VIEW"
      android:data="leeloo://voice"
      android:targetPackage="com.leeloo.app"
      android:targetClass="com.leeloo.app.MainActivity" />
    <categories android:name="android.shortcut.conversation" />
  </shortcut>

  <shortcut
    android:shortcutId="open_shopping"
    android:enabled="true"
    android:icon="@mipmap/ic_launcher"
    android:shortcutShortLabel="@string/shortcut_shopping_short"
    android:shortcutLongLabel="@string/shortcut_shopping_long"
    android:shortcutDisabledMessage="@string/shortcut_disabled">
    <intent
      android:action="android.intent.action.VIEW"
      android:data="leeloo://shopping"
      android:targetPackage="com.leeloo.app"
      android:targetClass="com.leeloo.app.MainActivity" />
    <categories android:name="android.shortcut.conversation" />
  </shortcut>

</shortcuts>`;

const STRINGS_PATCH = `
  <string name="shortcut_activate_short">Leeloo</string>
  <string name="shortcut_activate_long">Activar Leeloo</string>
  <string name="shortcut_shopping_short">Compras</string>
  <string name="shortcut_shopping_long">Lista de compras</string>
  <string name="shortcut_disabled">Shortcut no disponible</string>`;

module.exports = function withLeelooShortcuts(config) {
  // ── Android: shortcuts.xml ──────────────────────────────────────────────────
  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      const resDir = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res');

      // Write xml/shortcuts.xml
      const xmlDir = path.join(resDir, 'xml');
      fs.mkdirSync(xmlDir, { recursive: true });
      fs.writeFileSync(path.join(xmlDir, 'shortcuts.xml'), SHORTCUTS_XML, 'utf8');

      // Patch values/strings.xml
      const stringsPath = path.join(resDir, 'values', 'strings.xml');
      if (fs.existsSync(stringsPath)) {
        let content = fs.readFileSync(stringsPath, 'utf8');
        if (!content.includes('shortcut_activate_short')) {
          content = content.replace('</resources>', `${STRINGS_PATCH}\n</resources>`);
          fs.writeFileSync(stringsPath, content, 'utf8');
        }
      }

      return cfg;
    },
  ]);

  // ── Android: register shortcuts.xml in AndroidManifest ─────────────────────
  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    const app = manifest.manifest.application[0];
    const activities = app.activity ?? [];

    // Find the main activity
    const mainActivity = activities.find(
      (a) =>
        a['intent-filter']?.some((f) =>
          f.action?.some((ac) => ac.$?.['android:name'] === 'android.intent.action.MAIN'),
        ),
    );

    if (mainActivity) {
      const metaData = mainActivity['meta-data'] ?? [];
      const alreadyAdded = metaData.some(
        (m) => m.$?.['android:name'] === 'android.app.shortcuts',
      );
      if (!alreadyAdded) {
        mainActivity['meta-data'] = [
          ...metaData,
          {
            $: {
              'android:name': 'android.app.shortcuts',
              'android:resource': '@xml/shortcuts',
            },
          },
        ];
      }
    }

    return cfg;
  });

  // ── iOS: UIApplicationShortcutItems in Info.plist ───────────────────────────
  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.UIApplicationShortcutItems = [
      {
        UIApplicationShortcutItemType: 'com.hyperbyte.leeloo.activate',
        UIApplicationShortcutItemTitle: 'Activar Leeloo',
        UIApplicationShortcutItemSubtitle: 'Hablar ahora',
        UIApplicationShortcutItemIconType: 'UIApplicationShortcutIconTypeMicrophone',
        UIApplicationShortcutItemUserInfo: { url: 'leeloo://voice' },
      },
      {
        UIApplicationShortcutItemType: 'com.hyperbyte.leeloo.shopping',
        UIApplicationShortcutItemTitle: 'Lista de compras',
        UIApplicationShortcutItemSubtitle: 'Ver compras pendientes',
        UIApplicationShortcutItemIconType: 'UIApplicationShortcutIconTypeShare',
        UIApplicationShortcutItemUserInfo: { url: 'leeloo://shopping' },
      },
    ];
    return cfg;
  });

  return config;
};
