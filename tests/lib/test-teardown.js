// File: tests/utils/test-teardown.js

/**
 * Performs a robust teardown for test suites that use a database,
 * ensuring the Node.js process does not hang due to resource leaks.
 *
 * This function will:
 * 1. Attempt a graceful shutdown of the provided API instance and its connection pool.
 * 2. Forcibly destroy the direct database connection used for test setup.
 * 3. Manually hunt down and destroy any lingering TCP sockets left open by the database driver.
 * 4. Set a final, un-referenced timeout to force an exit if the process still hangs.
 *
 * @param {object} [api] - The application API instance. Should have a .close() method.
 * @param {object} [connection] - The direct database connection instance. Should have a .destroy() method.
 */
export async function robustTeardown({ api, connection }) {
  console.log("Entering robust teardown process...");

  // 1. Attempt the graceful shutdown without awaiting.
  if (api && typeof api.close === 'function') {
    // We call close() but don't await, as it can hang on failure.
    // We catch any potential errors to prevent an unhandled rejection.
    api.close().catch(err => console.error("api.close() threw an error (ignored):", err.message));
  }
  if (connection && typeof connection.destroy === 'function') {
    connection.destroy();
  }

  // 2. Give the graceful shutdown commands one event loop cycle to process.
  await new Promise(resolve => setImmediate(resolve));

  // 3. Manually hunt down and kill any remaining TCP handles.
  console.log('Performing manual TCP handle cleanup...');
  const handles = process._getActiveHandles();
  let destroyedSockets = 0;

  for (const handle of handles) {
    // Target TCP sockets that are likely database connections.
    if (handle.constructor.name === 'Socket' && handle.remoteAddress) {
      console.log(`   > Found lingering socket to ${handle.remoteAddress}:${handle.remotePort}. Destroying it.`);
      handle.destroy();
      destroyedSockets++;
    }
  }

  if (destroyedSockets > 0) {
    console.log(`✓ Manually destroyed ${destroyedSockets} lingering TCP socket(s).`);
  } else {
    console.log('No lingering TCP sockets were found to destroy.');
  }
  
  // 4. Set a final safety-net timeout to guarantee the process exits.
  const finalTimeout = setTimeout(() => {
    console.error('\n❌ Process did not exit cleanly after manual handle destruction. Forcing exit.');
    process.exit(1);
  }, 1000);

  // Crucially, .unref() tells Node.js not to wait for this timer to complete.
  // If the process can exit cleanly before 1s, it will.
  finalTimeout.unref();
}
