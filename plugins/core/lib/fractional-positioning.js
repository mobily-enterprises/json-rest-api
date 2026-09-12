import { throwMissingPackage } from '../../../lib/missing-package.js'

let generateKeyBetween
try {
  ({ generateKeyBetween } = await import('fractional-indexing'))
} catch (e) {
  throwMissingPackage('fractional-indexing', 'positioning',
    'Fractional indexing is required for the positioning plugin to generate sortable position keys. This is a peer dependency.')
}

/**
 * Helper functions for fractional positioning
 * Uses the fractional-indexing library for generating position keys
 */

/**
 * Generate a key between already-selected neighboring position strings.
 * @param {string | null | undefined} previousPosition - Lower bound, or the beginning
 * @param {string | null | undefined} nextPosition - Upper bound, or the end
 * @returns {string} New position key
 */
export function calculatePosition (previousPosition, nextPosition) {
  return generateKeyBetween(previousPosition ?? null, nextPosition ?? null)
}

/**
 * Initialize position for first item in a group
 * @returns {string} Initial position key
 */
export function getInitialPosition () {
  return generateKeyBetween(null, null) // Returns 'a0'
}

/**
 * Rebalance positions if they get too long (optional maintenance)
 * @param {Array} items - Array of items to rebalance
 * @param {string} positionField - Name of the position field
 * @param {number} maxLength - Maximum position string length before rebalancing
 * @returns {Array} Items with new positions (or original if no rebalance needed)
 */
export function rebalancePositions (items, positionField, maxLength = 50) {
  // Check if rebalancing is needed
  const needsRebalance = items.some(item =>
    item[positionField] && item[positionField].length > maxLength
  )

  if (!needsRebalance) {
    return items
  }

  // Sort by current position
  const sorted = [...items].sort((a, b) => {
    const posA = a[positionField] || ''
    const posB = b[positionField] || ''
    return posA < posB ? -1 : posA > posB ? 1 : 0
  })

  // Generate evenly spaced positions
  const rebalanced = []
  let prevKey = null

  for (let i = 0; i < sorted.length; i++) {
    // For even spacing, we generate keys sequentially
    const newPosition = generateKeyBetween(prevKey, null)

    rebalanced.push({
      ...sorted[i],
      [positionField]: newPosition
    })

    prevKey = newPosition
  }

  return rebalanced
}

/**
 * Check if a position value is valid
 * @param {string} position - Position value to check
 * @returns {boolean} True if valid
 */
export function isValidPosition (position) {
  if (!position || typeof position !== 'string') {
    return false
  }

  if (!/^[a-z0-9]+$/i.test(position)) return false
  try {
    generateKeyBetween(position, null)
    return true
  } catch { return false }
}

/**
 * Get items that need position assignment (for migration)
 * @param {Array} items - Array of items
 * @param {string} positionField - Name of the position field
 * @returns {Array} Items without valid positions
 */
export function getUnpositionedItems (items, positionField) {
  return items.filter(item => !isValidPosition(item[positionField]))
}

/**
 * Assign initial positions to items that don't have them
 * @param {Array} items - Array of items
 * @param {string} positionField - Name of the position field
 * @param {string} orderByField - Optional field to order by initially
 * @returns {Array} Items with positions assigned
 */
export function assignInitialPositions (items, positionField, orderByField = null) {
  const positioned = items.filter(item => isValidPosition(item[positionField]))
  const unpositioned = items.filter(item => !isValidPosition(item[positionField]))

  if (unpositioned.length === 0) {
    return items
  }

  // Sort unpositioned items if orderBy field provided
  if (orderByField) {
    unpositioned.sort((a, b) => {
      const valA = a[orderByField]
      const valB = b[orderByField]
      if (valA < valB) return -1
      if (valA > valB) return 1
      return 0
    })
  }

  // Get the last positioned item
  const sortedPositioned = [...positioned].sort((a, b) => {
    const posA = a[positionField] || ''
    const posB = b[positionField] || ''
    return posA < posB ? -1 : posA > posB ? 1 : 0
  })
  const lastPositioned = sortedPositioned[sortedPositioned.length - 1]

  let lastKey = lastPositioned ? lastPositioned[positionField] : null

  // Assign positions to unpositioned items
  const newlyPositioned = unpositioned.map(item => {
    const newKey = generateKeyBetween(lastKey, null)
    lastKey = newKey

    return {
      ...item,
      [positionField]: newKey
    }
  })

  return [...positioned, ...newlyPositioned]
}
