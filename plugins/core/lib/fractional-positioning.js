import { requirePackage } from 'hooked-api';

let generateKeyBetween;
try {
  ({ generateKeyBetween } = await import('fractional-indexing'));
} catch (e) {
  requirePackage('fractional-indexing', 'positioning', 
    'Fractional indexing is required for the positioning plugin to generate sortable position keys. This is a peer dependency.');
}

/**
 * Helper functions for fractional positioning
 * Uses the fractional-indexing library for generating position keys
 */

/**
 * Calculate position for a new/moved item based on beforeId
 * @param {Array} items - Array of items with position field
 * @param {string} beforeId - ID to position before (null = last)
 * @param {string} idField - Name of the ID field
 * @param {string} positionField - Name of the position field
 * @returns {string} New position key
 */
export function calculatePosition(items, beforeId, idField, positionField) {
  // Sort items by position using simple string comparison
  // Important: fractional-indexing expects ASCII/Unicode ordering, not locale-specific
  const sorted = [...items].sort((a, b) => {
    const posA = a[positionField] || '';
    const posB = b[positionField] || '';
    return posA < posB ? -1 : posA > posB ? 1 : 0;
  });


  // If no items, start in the middle
  if (sorted.length === 0) {
    return generateKeyBetween(null, null); // Returns 'a0'
  }

  // Position at end
  if (beforeId === null || beforeId === undefined) {
    const lastItem = sorted[sorted.length - 1];
    return generateKeyBetween(lastItem[positionField], null);
  }

  // Find the item to position before
  const beforeIndex = sorted.findIndex(item => String(item[idField]) === String(beforeId));
  
  // If beforeId not found, position at end
  if (beforeIndex === -1) {
    const lastItem = sorted[sorted.length - 1];
    return generateKeyBetween(lastItem[positionField], null);
  }

  // Position before the found item
  const beforeItem = sorted[beforeIndex];
  const prevItem = beforeIndex > 0 ? sorted[beforeIndex - 1] : null;
  
  const result = generateKeyBetween(
    prevItem ? prevItem[positionField] : null,
    beforeItem[positionField]
  );

  
  return result;
}

/**
 * Initialize position for first item in a group
 * @returns {string} Initial position key
 */
export function getInitialPosition() {
  return generateKeyBetween(null, null); // Returns 'a0'
}

/**
 * Rebalance positions if they get too long (optional maintenance)
 * @param {Array} items - Array of items to rebalance
 * @param {string} positionField - Name of the position field
 * @param {number} maxLength - Maximum position string length before rebalancing
 * @returns {Array} Items with new positions (or original if no rebalance needed)
 */
export function rebalancePositions(items, positionField, maxLength = 50) {
  // Check if rebalancing is needed
  const needsRebalance = items.some(item => 
    item[positionField] && item[positionField].length > maxLength
  );
  
  if (!needsRebalance) {
    return items;
  }

  // Sort by current position
  const sorted = [...items].sort((a, b) => {
    const posA = a[positionField] || '';
    const posB = b[positionField] || '';
    return posA < posB ? -1 : posA > posB ? 1 : 0;
  });

  // Generate evenly spaced positions
  const rebalanced = [];
  let prevKey = null;
  
  for (let i = 0; i < sorted.length; i++) {
    // For even spacing, we generate keys sequentially
    const newPosition = generateKeyBetween(prevKey, null);
    
    rebalanced.push({
      ...sorted[i],
      [positionField]: newPosition
    });
    
    prevKey = newPosition;
  }

  return rebalanced;
}

/**
 * Check if a position value is valid
 * @param {string} position - Position value to check
 * @returns {boolean} True if valid
 */
export function isValidPosition(position) {
  if (!position || typeof position !== 'string') {
    return false;
  }
  
  // Fractional keys should match pattern: lowercase letters and digits
  return /^[a-z0-9]+$/i.test(position);
}

/**
 * Get items that need position assignment (for migration)
 * @param {Array} items - Array of items
 * @param {string} positionField - Name of the position field
 * @returns {Array} Items without valid positions
 */
export function getUnpositionedItems(items, positionField) {
  return items.filter(item => !isValidPosition(item[positionField]));
}

/**
 * Assign initial positions to items that don't have them
 * @param {Array} items - Array of items
 * @param {string} positionField - Name of the position field
 * @param {string} orderByField - Optional field to order by initially
 * @returns {Array} Items with positions assigned
 */
export function assignInitialPositions(items, positionField, orderByField = null) {
  const positioned = items.filter(item => isValidPosition(item[positionField]));
  const unpositioned = items.filter(item => !isValidPosition(item[positionField]));
  
  if (unpositioned.length === 0) {
    return items;
  }

  // Sort unpositioned items if orderBy field provided
  if (orderByField) {
    unpositioned.sort((a, b) => {
      const valA = a[orderByField];
      const valB = b[orderByField];
      if (valA < valB) return -1;
      if (valA > valB) return 1;
      return 0;
    });
  }

  // Get the last positioned item
  const sortedPositioned = [...positioned].sort((a, b) => {
    const posA = a[positionField] || '';
    const posB = b[positionField] || '';
    return posA < posB ? -1 : posA > posB ? 1 : 0;
  });
  const lastPositioned = sortedPositioned[sortedPositioned.length - 1];
  
  let lastKey = lastPositioned ? lastPositioned[positionField] : null;
  
  // Assign positions to unpositioned items
  const newlyPositioned = unpositioned.map(item => {
    const newKey = generateKeyBetween(lastKey, null);
    lastKey = newKey;
    
    return {
      ...item,
      [positionField]: newKey
    };
  });

  return [...positioned, ...newlyPositioned];
}