const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

const projectRoot = __dirname
const config = getDefaultConfig(projectRoot)
/** Monorepo: scan workspace node_modules for deps */
config.watchFolders = [projectRoot, path.resolve(projectRoot, '../..')]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(projectRoot, '../../node_modules'),
]

module.exports = config
