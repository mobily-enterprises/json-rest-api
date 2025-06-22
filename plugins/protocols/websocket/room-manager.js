export class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.socketToRooms = new Map();
    this.filterCache = new Map();
  }

  addSocketToRoom(socketId, room) {
    // Add to room
    if (!this.rooms.has(room)) {
      this.rooms.set(room, new Set());
    }
    this.rooms.get(room).add(socketId);

    // Track socket's rooms
    if (!this.socketToRooms.has(socketId)) {
      this.socketToRooms.set(socketId, new Set());
    }
    this.socketToRooms.get(socketId).add(room);
  }

  removeSocketFromRoom(socketId, room) {
    // Remove from room
    const roomSockets = this.rooms.get(room);
    if (roomSockets) {
      roomSockets.delete(socketId);
      if (roomSockets.size === 0) {
        this.rooms.delete(room);
      }
    }

    // Remove from socket's rooms
    const socketRooms = this.socketToRooms.get(socketId);
    if (socketRooms) {
      socketRooms.delete(room);
      if (socketRooms.size === 0) {
        this.socketToRooms.delete(socketId);
      }
    }
  }

  removeSocket(socketId) {
    const rooms = this.socketToRooms.get(socketId);
    if (rooms) {
      rooms.forEach(room => {
        this.removeSocketFromRoom(socketId, room);
      });
    }
  }

  getSocketsInRoom(room) {
    return Array.from(this.rooms.get(room) || []);
  }

  getRoomsForSocket(socketId) {
    return Array.from(this.socketToRooms.get(socketId) || []);
  }

  getRoomCount() {
    return this.rooms.size;
  }

  // Get all rooms for a resource
  getResourceRooms(resource) {
    const resourceRooms = [];
    for (const room of this.rooms.keys()) {
      if (room.startsWith(`${resource}:`)) {
        resourceRooms.push(room);
      }
    }
    return resourceRooms;
  }

  // Get filtered rooms for a resource
  getFilteredRooms(resource) {
    const filteredRooms = [];
    for (const room of this.rooms.keys()) {
      if (room.startsWith(`${resource}:filter:`)) {
        filteredRooms.push(room);
      }
    }
    return filteredRooms;
  }

  // Parse filter from room name
  getFilterFromRoom(room) {
    if (!room.includes(':filter:')) {
      return null;
    }

    // Check cache first
    if (this.filterCache.has(room)) {
      return this.filterCache.get(room);
    }

    try {
      const filterJson = room.split(':filter:')[1];
      const filter = JSON.parse(filterJson);
      this.filterCache.set(room, filter);
      return filter;
    } catch (error) {
      return null;
    }
  }

  // Get room statistics
  getStats() {
    const stats = {
      totalRooms: this.rooms.size,
      roomSizes: {},
      resourceRooms: {},
      presenceRooms: 0,
      filterRooms: 0
    };

    for (const [room, sockets] of this.rooms) {
      stats.roomSizes[room] = sockets.size;

      if (room.startsWith('presence:')) {
        stats.presenceRooms++;
      } else if (room.includes(':filter:')) {
        stats.filterRooms++;
      }

      // Count by resource
      const resource = room.split(':')[0];
      if (resource && !room.startsWith('presence:') && !room.startsWith('user:')) {
        stats.resourceRooms[resource] = (stats.resourceRooms[resource] || 0) + 1;
      }
    }

    return stats;
  }

  // Clean up empty rooms
  cleanup() {
    const emptyRooms = [];
    
    for (const [room, sockets] of this.rooms) {
      if (sockets.size === 0) {
        emptyRooms.push(room);
      }
    }

    emptyRooms.forEach(room => {
      this.rooms.delete(room);
      this.filterCache.delete(room);
    });

    return emptyRooms.length;
  }

  // Check if a socket is in a specific room
  isSocketInRoom(socketId, room) {
    const roomSockets = this.rooms.get(room);
    return roomSockets ? roomSockets.has(socketId) : false;
  }

  // Get all presence rooms
  getPresenceRooms() {
    const presenceRooms = [];
    for (const room of this.rooms.keys()) {
      if (room.startsWith('presence:')) {
        presenceRooms.push({
          room,
          channel: room.substring(9), // Remove 'presence:' prefix
          users: this.getSocketsInRoom(room).length
        });
      }
    }
    return presenceRooms;
  }
}