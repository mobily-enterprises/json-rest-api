export default {
  async up(api, db) {
    // Create posts table
    await db.execute(`
      CREATE TABLE posts (
        id INTEGER PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        content TEXT,
        authorId INTEGER NOT NULL,
        published BOOLEAN DEFAULT FALSE,
        publishedAt TIMESTAMP NULL,
        tags TEXT,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)
    
    // Add indexes separately
    try {
      await db.addIndex('posts', ['authorId'], { name: 'idx_authorId' })
      await db.addIndex('posts', ['published'], { name: 'idx_published' })
      await db.addIndex('posts', ['publishedAt'], { name: 'idx_publishedAt' })
    } catch (e) {
      // Ignore if not supported
    }
  },
  
  async down(api, db) {
    // Drop posts table
    await db.dropTable('posts')
  }
}