export default {
  async up(api, db) {
    // Create users table
    await db.execute(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        role VARCHAR(50) DEFAULT 'user',
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)
    
    // Add indexes separately (for databases that support them)
    try {
      await db.addIndex('users', ['email'], { name: 'idx_email' })
      await db.addIndex('users', ['role'], { name: 'idx_role' })
    } catch (e) {
      // Ignore if not supported
    }
  },
  
  async down(api, db) {
    // Drop users table
    await db.dropTable('users')
  }
}