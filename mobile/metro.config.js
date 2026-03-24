const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Required for Expo Router web support
config.transformer.unstable_allowRequireContext = true;

// Force Zustand (and any package whose .mjs ESM files use `import.meta`) to
// resolve to their CJS counterparts. Metro outputs classic scripts, not ES
// modules, so `import.meta` causes a browser SyntaxError at runtime.
const ZUSTAND_CJS = {
  'zustand':             path.resolve(__dirname, 'node_modules/zustand/index.js'),
  'zustand/middleware':  path.resolve(__dirname, 'node_modules/zustand/middleware.js'),
  'zustand/shallow':     path.resolve(__dirname, 'node_modules/zustand/shallow.js'),
  'zustand/traditional': path.resolve(__dirname, 'node_modules/zustand/traditional.js'),
  'zustand/vanilla':     path.resolve(__dirname, 'node_modules/zustand/vanilla.js'),
};

// Web stub for react-native-maps (native-only)
const originalResolver = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && moduleName === 'react-native-maps') {
    return {
      filePath: path.resolve(__dirname, 'stubs/react-native-maps-stub.js'),
      type: 'sourceFile',
    };
  }
  if (ZUSTAND_CJS[moduleName]) {
    return { filePath: ZUSTAND_CJS[moduleName], type: 'sourceFile' };
  }
  if (originalResolver) {
    return originalResolver(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
