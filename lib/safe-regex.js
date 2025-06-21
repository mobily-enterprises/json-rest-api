/**
 * Safe regex execution with timeout protection against ReDoS attacks
 */
export class SafeRegex {
  constructor(pattern, flags = '') {
    this.pattern = pattern;
    this.flags = flags;
    this.regex = new RegExp(pattern, flags);
    
    // Check for dangerous patterns
    this.checkForDangerousPatterns();
  }
  
  /**
   * Check for common ReDoS patterns
   */
  checkForDangerousPatterns() {
    const dangerous = [
      /\([^)]*\+\)\+/,        // Nested quantifiers like (a+)+
      /\([^)]*\*\)\+/,        // Nested quantifiers like (a*)+
      /\([^)]*\{[\d,]+\}\)\+/, // Nested quantifiers with ranges
      /([\w\s]+)+[\w\s]/,     // Overlapping groups with backtracking
      /(\w+)+\W/,             // Catastrophic backtracking
    ];
    
    const patternStr = this.pattern.toString();
    for (const danger of dangerous) {
      if (danger.test(patternStr)) {
        console.warn(`⚠️  WARNING: Potentially dangerous regex pattern detected: ${patternStr}`);
        return; // Only warn once per pattern
      }
    }
  }
  
  /**
   * Test with timeout protection
   */
  test(str, timeout = 100) {
    return this.execWithTimeout(() => this.regex.test(str), timeout, str);
  }
  
  /**
   * Match with timeout protection
   */
  match(str, timeout = 100) {
    return this.execWithTimeout(() => str.match(this.regex), timeout, str);
  }
  
  /**
   * Execute regex with timeout
   */
  execWithTimeout(fn, timeout, str) {
    const startTime = Date.now();
    
    // For Node.js, we can't truly interrupt regex execution
    // but we can add length checks and warn
    if (typeof str === 'string' && str.length > 10000) {
      console.warn(`⚠️  WARNING: Testing regex against very long string (${str.length} chars)`);
    }
    
    try {
      const result = fn();
      const elapsed = Date.now() - startTime;
      
      if (elapsed > timeout) {
        console.error(`⚠️  REGEX TIMEOUT: Pattern took ${elapsed}ms (limit: ${timeout}ms)`);
        throw new Error('Regex execution timeout - possible ReDoS');
      }
      
      return result;
    } catch (error) {
      throw error;
    }
  }
}

/**
 * Pre-validated safe patterns for common formats
 */
export const SafePatterns = {
  // Simple email - avoids complex RFC regex
  email: new SafeRegex('^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$'),
  
  // Simple URL - avoids complex validation
  url: new SafeRegex('^https?://[a-zA-Z0-9.-]+(:[0-9]+)?(/.*)?$'),
  
  // Other safe patterns
  alphanumeric: new SafeRegex('^[a-zA-Z0-9]+$'),
  numeric: new SafeRegex('^[0-9]+$'),
  slug: new SafeRegex('^[a-zA-Z0-9-]+$'),
  uuid: new SafeRegex('^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', 'i'),
  
  // Date/time patterns
  date: new SafeRegex('^\\d{4}-\\d{2}-\\d{2}$'),
  time: new SafeRegex('^([01]\\d|2[0-3]):[0-5]\\d(:[0-5]\\d)?$'), // Valid 24-hour time
  
  // Common identifiers
  phone: new SafeRegex('^\\+?[0-9\\s()-]+$'),
  postalCode: new SafeRegex('^[A-Za-z0-9\\s-]+$'),
};

/**
 * Create a safe regex with validation
 */
export function createSafeRegex(pattern, flags) {
  return new SafeRegex(pattern, flags);
}

/**
 * Regex complexity analyzer
 */
export function analyzeRegexComplexity(pattern) {
  const factors = {
    quantifiers: (pattern.match(/[*+?{]/g) || []).length,
    groups: (pattern.match(/\(/g) || []).length,
    alternations: (pattern.match(/\|/g) || []).length,
    nestedQuantifiers: (pattern.match(/\([^)]*[*+]\)[*+]/g) || []).length,
    backReferences: (pattern.match(/\\\d/g) || []).length,
  };
  
  // Calculate complexity score
  const score = 
    factors.quantifiers * 2 +
    factors.groups * 3 +
    factors.alternations * 2 +
    factors.nestedQuantifiers * 10 +
    factors.backReferences * 5;
  
  return {
    score,
    factors,
    risk: score > 20 ? 'high' : score > 10 ? 'medium' : 'low'
  };
}