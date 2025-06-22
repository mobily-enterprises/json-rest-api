export class SocketManager {
  constructor() {
    this.sockets = new Map();
    this.userToSockets = new Map();
    this.rateLimits = new Map();
  }

  addSocket(socket) {
    this.sockets.set(socket.id, {
      id: socket.id,
      userId: socket.userId,
      connectedAt: new Date(),
      user: socket.user,
      rooms: new Set(),
      metadata: {}
    });

    // Track user's sockets
    if (socket.userId) {
      if (!this.userToSockets.has(socket.userId)) {
        this.userToSockets.set(socket.userId, new Set());
      }
      this.userToSockets.get(socket.userId).add(socket.id);
    }
  }

  removeSocket(socketId) {
    const socketInfo = this.sockets.get(socketId);
    if (socketInfo) {
      // Remove from user tracking
      if (socketInfo.userId) {
        const userSockets = this.userToSockets.get(socketInfo.userId);
        if (userSockets) {
          userSockets.delete(socketId);
          if (userSockets.size === 0) {
            this.userToSockets.delete(socketInfo.userId);
          }
        }
      }

      // Remove socket info
      this.sockets.delete(socketId);
    }

    // Clean up rate limits
    this.rateLimits.delete(socketId);
  }

  getSocket(socketId) {
    return this.sockets.get(socketId);
  }

  getUserSockets(userId) {
    return Array.from(this.userToSockets.get(userId) || []);
  }

  getAllSockets() {
    return Array.from(this.sockets.values());
  }

  getSocketCount() {
    return this.sockets.size;
  }

  getUserCount() {
    return this.userToSockets.size;
  }

  updateSocketMetadata(socketId, metadata) {
    const socket = this.sockets.get(socketId);
    if (socket) {
      socket.metadata = { ...socket.metadata, ...metadata };
    }
  }

  // Rate limiting
  isRateLimited(socketId, points = 1) {
    const now = Date.now();
    const limit = this.rateLimits.get(socketId) || { points: 0, reset: now + 60000 };

    if (now > limit.reset) {
      limit.points = 0;
      limit.reset = now + 60000;
    }

    limit.points += points;
    this.rateLimits.set(socketId, limit);

    return limit.points > 100; // Default 100 points per minute
  }

  // Get socket statistics
  getStats() {
    const stats = {
      totalSockets: this.sockets.size,
      totalUsers: this.userToSockets.size,
      connectionsPerUser: {},
      connectionDurations: []
    };

    const now = new Date();
    
    for (const [userId, socketIds] of this.userToSockets) {
      stats.connectionsPerUser[userId] = socketIds.size;
    }

    for (const socket of this.sockets.values()) {
      const duration = now - socket.connectedAt;
      stats.connectionDurations.push(duration);
    }

    stats.averageConnectionDuration = stats.connectionDurations.length > 0
      ? stats.connectionDurations.reduce((a, b) => a + b, 0) / stats.connectionDurations.length
      : 0;

    return stats;
  }

  // Clean up old connections
  cleanupStale(maxAge = 24 * 60 * 60 * 1000) {
    const now = new Date();
    const stale = [];

    for (const [socketId, socket] of this.sockets) {
      if (now - socket.connectedAt > maxAge) {
        stale.push(socketId);
      }
    }

    stale.forEach(socketId => this.removeSocket(socketId));
    return stale.length;
  }
}