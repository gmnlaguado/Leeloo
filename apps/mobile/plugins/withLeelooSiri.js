/**
 * withLeelooSiri — Expo config plugin
 *
 * iOS only:
 *  1. Adds NSUserActivityTypes to Info.plist so iOS recognises the
 *     Leeloo voice-mode activity and triggers the app via Siri.
 *  2. Adds Intents.framework to the main target (required for
 *     INUIAddVoiceShortcutViewController and INVoiceShortcutCenter).
 *  3. Adds the Swift source files (LeelooSiriModule.swift + .m) to
 *     the Xcode project so they compile into the app binary.
 */

const { withInfoPlist, withXcodeProject } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

const ACTIVITY_TYPE = 'com.hyperbyte.leeloo.openvoice';
const MODULE_DIR = path.join(__dirname, '..', 'modules', 'leeloo-siri', 'ios');

// ── 1. Info.plist — NSUserActivityTypes ────────────────────────────────────
function withSiriInfoPlist(config) {
  return withInfoPlist(config, (cfg) => {
    const plist = cfg.modResults;

    // NSUserActivityTypes: array of activity type strings
    const existing = Array.isArray(plist.NSUserActivityTypes) ? plist.NSUserActivityTypes : [];
    if (!existing.includes(ACTIVITY_TYPE)) {
      plist.NSUserActivityTypes = [...existing, ACTIVITY_TYPE];
    }

    // Required for Siri suggestions on lock screen
    plist.NSUserTrackingUsageDescription =
      plist.NSUserTrackingUsageDescription ||
      'Leeloo uses Siri to let you open voice mode with "Hey Siri, Leeloo".';

    return cfg;
  });
}

// ── 2. Xcode project — Intents.framework + Swift sources ───────────────────
function withSiriXcode(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const pbxProject = project.pbxProjectSection();
    const mainTarget = Object.values(project.pbxNativeTargetSection())
      .find((t) => t && t.productType === '"com.apple.product-type.application"');

    if (!mainTarget) {
      console.warn('[withLeelooSiri] Could not find main app target — skipping Xcode modifications');
      return cfg;
    }

    const targetKey = Object.keys(project.pbxNativeTargetSection())
      .find((k) => project.pbxNativeTargetSection()[k] === mainTarget);

    // Add Intents.framework if not already present
    const frameworks = project.pbxFrameworksBuildPhaseObj(targetKey);
    const alreadyLinked = (frameworks?.files || []).some((f) => {
      const ref = project.pbxFileReferenceSection()[f.value];
      return ref && String(ref.path).includes('Intents.framework');
    });

    if (!alreadyLinked) {
      try {
        project.addFramework('Intents.framework', { target: targetKey });
      } catch (e) {
        // May already be linked via another plugin
      }
    }

    // Copy Swift source files into ios/ and add to Xcode project
    const iosDir = path.join(cfg.modRequest.projectRoot, 'ios');
    const swiftFiles = ['LeelooSiriModule.swift', 'LeelooSiriModule.m'];

    for (const fileName of swiftFiles) {
      const src = path.join(MODULE_DIR, fileName);
      const dst = path.join(iosDir, fileName);

      if (fs.existsSync(src) && !fs.existsSync(dst)) {
        fs.copyFileSync(src, dst);
      }

      // Add to Xcode sources build phase if not already there
      const existingFiles = project.pbxSourcesBuildPhaseObj(targetKey)?.files || [];
      const alreadyAdded = existingFiles.some((f) => {
        const ref = project.pbxFileReferenceSection()[f.value];
        return ref && String(ref.path).includes(fileName);
      });

      if (!alreadyAdded && fs.existsSync(path.join(iosDir, fileName))) {
        project.addSourceFile(fileName, { target: targetKey });
      }
    }

    return cfg;
  });
}

// ── Compose ────────────────────────────────────────────────────────────────
module.exports = function withLeelooSiri(config) {
  config = withSiriInfoPlist(config);
  config = withSiriXcode(config);
  return config;
};
