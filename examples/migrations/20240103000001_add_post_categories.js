export default {
  async up(api, db) {
    // Create categories table
    await db.execute(`
      CREATE TABLE categories (
        id INTEGER PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(100) NOT NULL UNIQUE,
        slug VARCHAR(100) NOT NULL UNIQUE,
        description TEXT,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)
    
    // Add categoryId to posts
    await db.addColumn('posts', 'categoryId', 'INTEGER', {
      default: null
    })
    
    // Add foreign key index
    await db.addIndex('posts', ['categoryId'], {
      name: 'idx_categoryId'
    })
    
    // Insert some default categories
    await db.execute(`
      INSERT INTO categories (name, slug, description) VALUES
      ('Technology', 'technology', 'Posts about tech and programming'),
      ('Business', 'business', 'Business and entrepreneurship'),
      ('Lifestyle', 'lifestyle', 'Life, health and wellness')
    `)
  },
  
  async down(api, db) {
    // Remove foreign key index
    await db.dropIndex('posts', 'idx_categoryId')
    
    // Remove categoryId column
    await db.dropColumn('posts', 'categoryId')
    
    // Drop categories table
    await db.dropTable('categories')
  }
}