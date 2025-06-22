import { Api, Schema } from '../../index.js';
import { MemoryPlugin } from '../../plugins/core/memory.js';
import { AuthorizationPlugin } from '../../plugins/authorization.js';

console.log('🔒 Authorization Example\n');

// Create API with memory storage
const api = new Api({ name: 'auth-example', version: '1.0.0' });
api.use(MemoryPlugin);

// Configure authorization
api.use(AuthorizationPlugin, {
  // Define roles and permissions
  roles: {
    admin: {
      permissions: '*',
      description: 'Full system access'
    },
    editor: {
      permissions: ['posts.*', 'media.*', 'users.read'],
      description: 'Can manage content'
    },
    author: {
      permissions: [
        'posts.create',
        'posts.read',
        'posts.update.own',
        'posts.delete.own',
        'users.read'
      ],
      description: 'Can manage own posts'
    },
    user: {
      permissions: ['posts.read', 'users.read'],
      description: 'Read-only access'
    }
  },
  
  // Simulate loading roles from database
  enhanceUser: async (user) => {
    // In real app, load from database/JWT/session
    const roleMap = {
      1: ['admin'],
      2: ['editor'],
      3: ['author'],
      4: ['user']
    };
    
    return {
      ...user,
      roles: roleMap[user.id] || ['user']
    };
  },
  
  // Resource-specific rules
  resources: {
    posts: {
      ownerField: 'authorId',
      public: ['read'],           // Anyone can read
      authenticated: ['create'],  // Logged-in users can create
      owner: ['update', 'delete'] // Only owner can update/delete
    },
    users: {
      public: ['read'],           // Anyone can read users
      authenticated: ['create', 'update', 'delete'] // Auth required for modifications
    }
  },
  
  // For this example, don't require auth by default
  requireAuth: false
});

// Define schemas
const userSchema = new Schema({
  id: { type: 'id' },
  name: { type: 'string', required: true },
  email: { type: 'string', required: true }
});

const postSchema = new Schema({
  id: { type: 'id' },
  title: { type: 'string', required: true },
  content: { type: 'string' },
  authorId: { type: 'id', refs: { resource: 'users' } },
  status: { type: 'string', enum: ['draft', 'published'], default: 'draft' },
  
  // Field-level permissions
  internalNotes: { 
    type: 'string',
    permission: 'posts.moderate'  // Only users with this permission
  }
});

// Add resources
api.addResource('users', userSchema);
api.addResource('posts', postSchema);

// Helper to run operations and show results
async function tryOperation(description, fn, user) {
  console.log(`\n${description}`);
  console.log(`User: ${user.name} (roles: ${user.roles?.join(', ') || 'none'})`);
  try {
    const result = await fn();
    console.log('✅ Success:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.log('❌ Failed:', error.message);
  }
}

// Run examples
async function runExamples() {
  // Create test users
  const users = [
    { id: 1, name: 'Admin Alice', email: 'admin@example.com' },
    { id: 2, name: 'Editor Ed', email: 'editor@example.com' },
    { id: 3, name: 'Author Amy', email: 'author@example.com' },
    { id: 4, name: 'User Uma', email: 'user@example.com' }
  ];
  
  // Create users with system context (bypassing auth)
  const systemUser = { id: 0, name: 'System', roles: ['admin'] };
  for (const user of users) {
    await api.resources.users.create(user, { user: systemUser });
  }
  
  console.log('=== AUTHORIZATION EXAMPLES ===\n');
  
  // 1. Anonymous access
  await tryOperation(
    '1. Anonymous user reading posts',
    () => api.resources.posts.query(),
    { name: 'Anonymous' }
  );
  
  // 2. User creating a post
  await tryOperation(
    '2. Regular user trying to create a post',
    () => api.resources.posts.create({
      title: 'My Post',
      content: 'Hello world',
      authorId: 4
    }, { user: users[3] }),
    users[3]
  );
  
  // 3. Author creating a post
  await tryOperation(
    '3. Author creating a post',
    () => api.resources.posts.create({
      title: 'Author Post',
      content: 'Great content',
      authorId: 3,
      internalNotes: 'Draft version'
    }, { user: users[2] }),
    users[2]
  );
  
  // 4. Author updating own post
  const post = await api.resources.posts.create({
    title: 'My Article',
    content: 'Original content',
    authorId: 3
  }, { user: users[2] });
  
  await tryOperation(
    '4. Author updating own post',
    () => api.resources.posts.update(post.data.id, {
      content: 'Updated content'
    }, { user: users[2] }),
    users[2]
  );
  
  // 5. Author trying to update someone else's post
  await tryOperation(
    '5. Author trying to update another author\'s post',
    () => api.resources.posts.update(post.data.id, {
      content: 'Hacked!'
    }, { user: { id: 5, name: 'Another Author', roles: ['author'] } }),
    { id: 5, name: 'Another Author', roles: ['author'] }
  );
  
  // 6. Editor updating any post
  await tryOperation(
    '6. Editor updating any post',
    () => api.resources.posts.update(post.data.id, {
      content: 'Editor revision',
      internalNotes: 'Needs review'
    }, { user: users[1] }),
    users[1]
  );
  
  // 7. Admin doing anything
  await tryOperation(
    '7. Admin creating and updating with all fields',
    async () => {
      const adminPost = await api.resources.posts.create({
        title: 'Admin Post',
        content: 'Important announcement',
        authorId: 1,
        internalNotes: 'Confidential notes'
      }, { user: users[0] });
      
      return api.resources.posts.update(adminPost.data.id, {
        status: 'published',
        internalNotes: 'Published by admin'
      }, { user: users[0] });
    },
    users[0]
  );
  
  // 8. Field-level permissions
  console.log('\n=== FIELD-LEVEL PERMISSIONS ===\n');
  
  // Create post with internal notes
  const notePost = await api.resources.posts.create({
    title: 'Post with Notes',
    content: 'Public content',
    authorId: 1,
    internalNotes: 'Secret admin notes'
  }, { user: users[0] });
  
  // Different users reading the same post
  for (const user of users) {
    await tryOperation(
      `User ${user.name} reading post with internal notes`,
      () => api.resources.posts.get(notePost.data.id, { user }),
      user
    );
  }
  
  // 9. Permission checks in code
  console.log('\n=== PERMISSION CHECKS IN CODE ===\n');
  
  const enhancedUser = await api.enhanceUserForAuth(users[2]);
  console.log(`Author Amy permissions:`);
  console.log(`- Can create posts: ${enhancedUser.can('posts.create')}`);
  console.log(`- Can delete own posts: ${enhancedUser.can('posts.delete.own')}`);
  console.log(`- Can delete any posts: ${enhancedUser.can('posts.delete')}`);
  console.log(`- Can moderate posts: ${enhancedUser.can('posts.moderate')}`);
  console.log(`- Has author role: ${enhancedUser.hasRole('author')}`);
  console.log(`- Has admin role: ${enhancedUser.hasRole('admin')}`);
  
  console.log('\n=== SUMMARY ===\n');
  console.log('✅ Anonymous users can read public resources');
  console.log('✅ Authenticated users get permissions based on roles');
  console.log('✅ Ownership-based permissions work with .own suffix');
  console.log('✅ Field-level permissions filter sensitive data');
  console.log('✅ Admins bypass all permission checks');
  console.log('✅ Permission checks can be done programmatically');
}

// Run the examples
runExamples().catch(console.error);