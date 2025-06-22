export default {
  async up(api, db) {
    // Create posts table
    await db.execute(`
      CREATE TABLE posts (
        id INTEGER PRIMARY KEY AUTO_INCREMENT,
        title VARCHAR(255) NOT NULL,
        content TEXT,
        authorId INTEGER NOT NULL,
        published BOOLEAN DEFAULT FALSE,
        publishedAt TIMESTAMP NULL,
        tags JSON,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (authorId) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_authorId (authorId),
        INDEX idx_published (published),
        INDEX idx_publishedAt (publishedAt)
      )
    `)
  },
  
  async down(api, db) {
    // Drop posts table
    await db.dropTable('posts')
  }
}