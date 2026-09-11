/**
 * withLeelooSiri — Expo config plugin (iOS only)
 *
 * 1. Adds NSUserActivityTypes to Info.plist
 * 2. Links Intents.framework to the main target
 * 3. Copies LeelooSiriModule.swift + .m into ios/ and adds to Xcode sources
 */

const { withInfoPlist, withXcodeProject } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

const ACTIVITY_TYPE = 'com.hyperbyte.leeloo.openvoice';
const MODULE_DIR = path.join(__dirname, '..', 'modules', 'leeloo-siri', 'ios');

// ── 1. Info.plist ──────────────────────────────────────────────────────────
function withSiriInfoPlist(config) {
  return withInfoPlist(config, (cfg) => {
    const plist = cfg.modResults;
    const existing = Array.isArray(plist.NSUserActivityTypes) ? plist.NSUserActivityTypes : [];
    if (!existing.includes(ACTIVITY_TYPE)) {
      plist.NSUserActivityTypes = [...existing, ACTIVITY_TYPE];
    }
    plist.NSUserTrackingUsageDescription =
      plist.NSUserTrackingUsageDescription ||
      'Leeloo uses Siri to let you open voice mode with "Hey Siri, Leeloo".';
    return cfg;
  });
}

// ── 2. Xcode project — Intents.framework + Swift sources ──────────────────
function withSiriXcode(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const nativeTargets = project.pbxNativeTargetSection();

    // Filter out _comment entries — keys ending in _comment are metadata, not targets
    const targetEntry = Object.entries(nativeTargets).find(([key, t]) => {
      if (key.endsWith('_comment') || !t || typeof t !== 'object') return false;
      return t.productType === '"com.apple.product-type.application"';
    });

    if (!targetEntry) {
      console.warn('[withLeelooSiri] Main app target not found — skipping Xcode modifications');
      return cfg;
    }

    const [targetKey] = targetEntry;

    // Link Intents.framework (safe — errors mean it's already there)
    try {
      project.addFramework('Intents.framework', { target: targetKey });
    } catch (_) {}

    // Copy Swift source files into ios/ and register in Xcode
    const iosDir = path.join(cfg.modRequest.projectRoot, 'ios');
    const swiftFiles = ['LeelooSiriModule.swift', 'LeelooSiriModule.m'];

    for (const fileName of swiftFiles) {
      const src = path.join(MODULE_DIR, fileName);
      const dst = path.join(iosDir, fileName);

      try {
        if (fs.existsSync(src) && !fs.existsSync(dst)) {
          fs.copyFileSync(src, dst);
        }
        if (fs.existsSync(dst)) {
          project.addSourceFile(fileName, { target: targetKey });
        }
      } catch (e) {
        console.warn(`[withLeelooSiri] Skipped ${fileName}: ${e.message}`);
      }
    }

    return cfg;
  });
}

module.exports = function withLeelooSiri(config) {
  config = withSiriInfoPlist(config);
  config = withSiriXcode(config);
  return config;
};
