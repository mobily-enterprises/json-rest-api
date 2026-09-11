/** @param {string} packageName @param {string} pluginName @param {string} [description] */
export function throwMissingPackage (packageName, pluginName, description = '') {
  throw new Error(`Plugin '${pluginName}' requires '${packageName}'. Install it with npm install ${packageName}. ${description}`)
}
