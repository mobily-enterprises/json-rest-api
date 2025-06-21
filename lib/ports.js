export class StoragePort {
  async get(resource, id, options = {}) {
    throw new Error('Storage adapter must implement get()')
  }

  async query(resource, options = {}) {
    throw new Error('Storage adapter must implement query()')
  }

  async insert(resource, data, options = {}) {
    throw new Error('Storage adapter must implement insert()')
  }

  async update(resource, id, data, options = {}) {
    throw new Error('Storage adapter must implement update()')
  }

  async delete(resource, id, options = {}) {
    throw new Error('Storage adapter must implement delete()')
  }

  async transaction(callback) {
    throw new Error('Storage adapter must implement transaction()')
  }
}

export class HttpPort {
  async handleRequest(method, path, body, headers) {
    throw new Error('HTTP adapter must implement handleRequest()')
  }
}

export class EventPort {
  async publish(event) {
    throw new Error('Event adapter must implement publish()')
  }

  async subscribe(eventType, handler) {
    throw new Error('Event adapter must implement subscribe()')
  }
}

export class AuthPort {
  async authenticate(credentials) {
    throw new Error('Auth adapter must implement authenticate()')
  }

  async authorize(user, resource, action) {
    throw new Error('Auth adapter must implement authorize()')
  }
}