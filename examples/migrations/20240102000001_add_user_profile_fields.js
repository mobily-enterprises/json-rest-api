export default {
  async up(api, db) {
    // Add profile fields to users
    await db.addColumn('users', 'bio', 'TEXT', { 
      default: null 
    })
    
    await db.addColumn('users', 'avatar', 'VARCHAR(255)', { 
      default: null 
    })
    
    await db.addColumn('users', 'lastLoginAt', 'TIMESTAMP', { 
      default: null 
    })
    
    // Add index for lastLoginAt
    await db.addIndex('users', ['lastLoginAt'], { 
      name: 'idx_lastLoginAt' 
    })
  },
  
  async down(api, db) {
    // Remove the index first
    await db.dropIndex('users', 'idx_lastLoginAt')
    
    // Remove columns
    await db.dropColumn('users', 'lastLoginAt')
    await db.dropColumn('users', 'avatar')
    await db.dropColumn('users', 'bio')
  }
}