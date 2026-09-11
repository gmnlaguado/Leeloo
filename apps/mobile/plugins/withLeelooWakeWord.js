// Expo config plugin — registers LeelooWakeWordService in AndroidManifest.xml
// and adds the FOREGROUND_SERVICE_MICROPHONE permission (Android 14+).
const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withLeelooWakeWord(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    const app = manifest.manifest.application[0];

    // Avoid duplicate registration
    const services = app.service ?? [];
    const alreadyAdded = services.some(
      (s) => s.$?.['android:name'] === 'com.leeloo.wakewword.LeelooWakeWordService',
    );

    if (!alreadyAdded) {
      app.service = [
        ...services,
        {
          $: {
            'android:name': 'com.leeloo.wakewword.LeelooWakeWordService',
            'android:foregroundServiceType': 'microphone',
            'android:exported': 'false',
          },
        },
      ];
    }

    // Android 14+ requires explicit FOREGROUND_SERVICE_MICROPHONE permission
    const perms = manifest.manifest['uses-permission'] ?? [];
    const fsMicPerm = 'android.permission.FOREGROUND_SERVICE_MICROPHONE';
    if (!perms.some((p) => p.$?.['android:name'] === fsMicPerm)) {
      manifest.manifest['uses-permission'] = [
        ...perms,
        { $: { 'android:name': fsMicPerm } },
      ];
    }

    return cfg;
  });
};
