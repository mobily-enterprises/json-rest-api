const RETURN_RECORD_METHODS = ['post', 'put', 'patch']
const RETURN_RECORD_MODES = ['no', 'minimal', 'full']

export function normalizeReturnRecordMode (value, defaultValue = 'no') {
  if (value === true) return 'full'
  if (value === false) return 'no'
  if (RETURN_RECORD_MODES.includes(value)) return value

  if (defaultValue === true) return 'full'
  if (defaultValue === false) return 'no'
  if (RETURN_RECORD_MODES.includes(defaultValue)) return defaultValue

  return 'no'
}

function defaultModeForMethod (defaultValue, method) {
  if (defaultValue && typeof defaultValue === 'object' && !Array.isArray(defaultValue)) {
    return normalizeReturnRecordMode(defaultValue[method], 'no')
  }

  return normalizeReturnRecordMode(defaultValue, 'no')
}

export function normalizeReturnRecordSetting (value, defaultValue = 'no') {
  if (value === undefined) {
    return Object.fromEntries(
      RETURN_RECORD_METHODS.map(method => [
        method,
        defaultModeForMethod(defaultValue, method)
      ])
    )
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(
      RETURN_RECORD_METHODS.map(method => [
        method,
        normalizeReturnRecordMode(value[method], defaultModeForMethod(defaultValue, method))
      ])
    )
  }

  const normalized = normalizeReturnRecordMode(value, defaultModeForMethod(defaultValue, 'post'))
  return Object.fromEntries(
    RETURN_RECORD_METHODS.map(method => [method, normalized])
  )
}
