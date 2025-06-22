import { EventEmitter } from 'events';

export class CircuitBreaker extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.name = options.name || 'circuit-breaker';
    this.threshold = options.threshold || 5;
    this.timeout = options.timeout || 60000; // 1 minute
    this.bucketSize = options.bucketSize || 10000; // 10 seconds
    this.bucketCount = options.bucketCount || 6; // 1 minute of data
    this.volumeThreshold = options.volumeThreshold || 10; // Min requests to trip
    this.errorThresholdPercent = options.errorThresholdPercent || 50;
    
    // State
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = null;
    this.lastStateChange = new Date();
    this.nextAttempt = null;
    
    // Rolling window for error rate calculation
    this.buckets = [];
    this.currentBucket = this.createBucket();
    
    // Start bucket rotation
    this.bucketInterval = setInterval(() => {
      this.rotateBuckets();
    }, this.bucketSize);
  }

  async execute(fn) {
    // Check if we should attempt the request
    if (!this.isAvailable()) {
      const error = new Error(`Circuit breaker is ${this.state}`);
      error.code = 'CIRCUIT_BREAKER_OPEN';
      error.state = this.state;
      throw error;
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  isAvailable() {
    if (this.state === 'CLOSED') {
      return true;
    }

    if (this.state === 'OPEN') {
      // Check if we should transition to half-open
      if (Date.now() >= this.nextAttempt) {
        this.transitionTo('HALF_OPEN');
        return true;
      }
      return false;
    }

    // HALF_OPEN - allow one request
    return true;
  }

  recordSuccess() {
    this.currentBucket.successes++;
    
    if (this.state === 'HALF_OPEN') {
      // Successful request in half-open state, close the circuit
      this.transitionTo('CLOSED');
    }
    
    this.emit('success', {
      state: this.state,
      stats: this.getStats()
    });
  }

  recordFailure() {
    this.currentBucket.failures++;
    this.lastFailureTime = new Date();
    
    if (this.state === 'HALF_OPEN') {
      // Failed request in half-open state, reopen the circuit
      this.transitionTo('OPEN');
    } else if (this.state === 'CLOSED') {
      // Check if we should open the circuit
      const stats = this.getWindowStats();
      
      if (stats.totalRequests >= this.volumeThreshold &&
          stats.errorRate >= this.errorThresholdPercent) {
        this.transitionTo('OPEN');
      }
    }
    
    this.emit('failure', {
      state: this.state,
      stats: this.getStats()
    });
  }

  transitionTo(newState) {
    const oldState = this.state;
    this.state = newState;
    this.lastStateChange = new Date();
    
    switch (newState) {
      case 'OPEN':
        this.nextAttempt = Date.now() + this.timeout;
        break;
      case 'CLOSED':
        this.failures = 0;
        this.nextAttempt = null;
        break;
      case 'HALF_OPEN':
        // Ready to test
        break;
    }
    
    this.emit('stateChange', {
      from: oldState,
      to: newState,
      timestamp: this.lastStateChange
    });
  }

  getState() {
    return this.state;
  }

  getStats() {
    const windowStats = this.getWindowStats();
    
    return {
      state: this.state,
      lastStateChange: this.lastStateChange,
      lastFailureTime: this.lastFailureTime,
      nextAttempt: this.nextAttempt,
      ...windowStats
    };
  }

  getWindowStats() {
    let totalRequests = 0;
    let totalFailures = 0;
    let totalSuccesses = 0;
    
    // Add current bucket
    totalRequests += this.currentBucket.requests;
    totalFailures += this.currentBucket.failures;
    totalSuccesses += this.currentBucket.successes;
    
    // Add historical buckets
    for (const bucket of this.buckets) {
      totalRequests += bucket.requests;
      totalFailures += bucket.failures;
      totalSuccesses += bucket.successes;
    }
    
    const errorRate = totalRequests > 0 
      ? (totalFailures / totalRequests) * 100 
      : 0;
    
    return {
      totalRequests,
      totalFailures,
      totalSuccesses,
      errorRate: Math.round(errorRate * 100) / 100,
      windowSize: (this.buckets.length + 1) * this.bucketSize
    };
  }

  createBucket() {
    return {
      timestamp: Date.now(),
      requests: 0,
      failures: 0,
      successes: 0,
      get requests() {
        return this.failures + this.successes;
      }
    };
  }

  rotateBuckets() {
    // Add current bucket to history
    this.buckets.push(this.currentBucket);
    
    // Remove old buckets
    while (this.buckets.length > this.bucketCount) {
      this.buckets.shift();
    }
    
    // Create new current bucket
    this.currentBucket = this.createBucket();
  }

  reset() {
    this.transitionTo('CLOSED');
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = null;
    this.buckets = [];
    this.currentBucket = this.createBucket();
  }

  destroy() {
    if (this.bucketInterval) {
      clearInterval(this.bucketInterval);
      this.bucketInterval = null;
    }
    this.removeAllListeners();
  }

  // Advanced features
  
  // Force open the circuit
  forceOpen() {
    this.transitionTo('OPEN');
  }

  // Force close the circuit
  forceClose() {
    this.transitionTo('CLOSED');
  }

  // Test if circuit would trip with given error rate
  wouldTrip(errorRate) {
    const stats = this.getWindowStats();
    return stats.totalRequests >= this.volumeThreshold &&
           errorRate >= this.errorThresholdPercent;
  }

  // Get health status
  getHealth() {
    const stats = this.getStats();
    
    if (this.state === 'OPEN') {
      return {
        status: 'unhealthy',
        reason: 'Circuit breaker open',
        ...stats
      };
    }
    
    if (this.state === 'HALF_OPEN') {
      return {
        status: 'degraded',
        reason: 'Circuit breaker testing',
        ...stats
      };
    }
    
    if (stats.errorRate > this.errorThresholdPercent * 0.8) {
      return {
        status: 'degraded',
        reason: 'High error rate',
        ...stats
      };
    }
    
    return {
      status: 'healthy',
      ...stats
    };
  }
}