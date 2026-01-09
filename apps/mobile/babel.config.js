module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          root: ['./'],
          alias: {
            '@': './',
            '@/components': './components',
            '@/hooks': './hooks',
            '@/lib': './lib',
            '@/store': './store',
            '@/types': './types',
          },
        },
      ],
      'react-native-reanimated/plugin',
    ],
  };
};
