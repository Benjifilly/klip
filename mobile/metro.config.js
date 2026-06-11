// Monorepo resolution: the desktop client pins a different React than this
// app, and npm hoists it to the workspace root. Hoisted RN packages resolving
// `react` hierarchically would find the ROOT copy → two Reacts in one bundle
// → hook crash at runtime. Redirect every `react` specifier to resolve from
// THIS app instead (everything else keeps default resolution).
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'react' || moduleName.startsWith('react/')) {
    return context.resolveRequest(
      { ...context, originModulePath: path.join(__dirname, 'package.json') },
      moduleName,
      platform,
    );
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
