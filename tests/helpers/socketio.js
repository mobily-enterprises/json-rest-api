export function waitForSocketEvent (socket, eventName, timeout = 2000, errorEvent) {
  return new Promise((resolve, reject) => {
    const finish = (error, data) => {
      clearTimeout(timer)
      socket.off(eventName, onEvent)
      if (errorEvent) socket.off(errorEvent, onError)
      if (error) reject(error)
      else resolve(data)
    }
    const onEvent = data => finish(null, data)
    const onError = error => finish(error)
    const timer = setTimeout(() => finish(new Error(`Timeout waiting for ${eventName}`)), timeout)
    socket.once(eventName, onEvent)
    if (errorEvent) socket.once(errorEvent, onError)
  })
}

export function installSocketBarrier (io) {
  io.on('connection', socket => {
    socket.on('test:barrier', callback => callback())
  })
}

// Acknowledgements follow earlier server packets on the same Socket.IO connection.
export async function drainSocketEvents (socket) {
  await socket.timeout(3000).emitWithAck('test:barrier')
}
