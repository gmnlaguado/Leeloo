const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Register Picovoice model files as binary assets so Metro bundles them correctly.
// The .ppn files are wake-word model files — they exist as placeholders until the
// Picovoice integration is fully configured (API key + trained model).
config.resolver.assetExts.push('ppn');

module.exports = config;
