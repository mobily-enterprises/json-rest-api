import { Api, Schema } from '../index.js';
import { MemoryPlugin } from '../plugins/memory.js';
import { AuthorizationPlugin } from '../plugins/authorization.js';
import { ValidationPlugin } from '../plugins/validation.js';

// Create API instance
const api = new Api({ 
  name: 'blog',
  version: '1.0.0'
});

// Add storage
api.use(MemoryPlugin);

// Add validation
api.use(ValidationPlugin);

// Configure authorization
api.use(AuthorizationPlugin, {
  // Define roles and permissions
  roles: {
    admin: {
      permissions: '*',
      description: 'Full system administrator'
    },
    moderator: {
      permissions: [
        'posts.*',
        'comments.*',
        'users.read',
        'users.update'
      ],
      description: 'Content moderator'
    },
    author: {
      permissions: [
        'posts.create',
        'posts.read',
        'posts.update.own',
        'posts.delete.own',
        'comments.create',
        'comments.read',
        'comments.update.own',
        'users.read',
        'users.update.own'
      ],
      description: 'Content author'
    },
    user: {
      permissions: [
        'posts.read',
        'comments.create',
        'comments.read',
        'comments.update.own',
        'users.read.own',
        'users.update.own'
      ],
      description: 'Regular user'
    }
  },
  
  // Simulate loading user roles from a database
  enhanceUser: async (user) => {
    // In real app, this would query your database
    const userRoles = {
      1: ['admin'],
      2: ['moderator'],
      3: ['author'],
      4: ['user'],
      5: ['author', 'moderator'] // Multiple roles
    };
    
    return {
      ...user,
      roles: userRoles[user.id] || ['user']
    };
  },
  
  // Resource-specific configuration
  resources: {
    posts: {
      ownerField: 'authorId',
      public: ['read'],              // Anyone can read posts
      authenticated: ['create'],     // Any logged-in user can create
      owner: ['update', 'delete']    // Only owner can update/delete
    },
    comments: {
      ownerField: 'userId',
      public: ['read'],
      authenticated: ['create'],
      owner: ['update', 'delete']
    },
    users: {
      ownerField: 'id',              // User owns their own record
      authenticated: ['read'],       // Must be logged in to see users
      owner: ['update']              // Can only update own profile
    }
  }
});

// Define schemas
const postSchema = new Schema({
  title: { type: 'string', required: true },
  content: { type: 'string', required: true },
  authorId: { type: 'integer', required: true },
  status: { type: 'string', enum: ['draft', 'published'], default: 'draft' },
  featured: { type: 'boolean', default: false },
  tags: { type: 'array' },
  
  // Field with special permission
  internalNotes: { 
    type: 'string',
    permission: 'posts.moderate' // Only moderators/admins see this
  }
});

const commentSchema = new Schema({
  postId: { type: 'integer', required: true },
  userId: { type: 'integer', required: true },
  content: { type: 'string', required: true },
  approved: { type: 'boolean', default: false }
});

const userSchema = new Schema({
  name: { type: 'string', required: true },
  email: { type: 'string', required: true },
  bio: { type: 'string' },
  
  // Sensitive fields
  password: { type: 'string', silent: true }, // Never returned
  lastLoginAt: { 
    type: 'datetime',
    permission: 'users.admin' // Only admins see this
  }
});

// Add resources
api.addResource('posts', postSchema);
api.addResource('comments', commentSchema);
api.addResource('users', userSchema);

// Add custom permission checks
api.hook('beforeUpdate', async (context) => {
  if (context.options.type !== 'posts') return;
  
  const user = context.options.user;
  const { status, featured } = context.data;
  
  // Only moderators can publish posts
  if (status === 'published' && !user?.can('posts.moderate')) {
    throw new Error('Only moderators can publish posts');
  }
  
  // Only admins can feature posts
  if (featured === true && !user?.hasRole('admin')) {
    throw new Error('Only admins can feature posts');
  }
});

// Demo different user scenarios
async function demonstrateAuthorization() {
  console.log('=== Authorization Demo ===\n');
  
  // Create some test data
  const admin = { id: 1, name: 'Admin User' };
  const moderator = { id: 2, name: 'Moderator User' };
  const author = { id: 3, name: 'Author User' };
  const regularUser = { id: 4, name: 'Regular User' };
  
  // Admin creates users
  console.log('1. Admin creating users...');
  for (const userData of [admin, moderator, author, regularUser]) {
    const { id, ...userWithoutId } = userData;
    const created = await api.resources.users.create(
      { ...userWithoutId, email: `${userData.name.toLowerCase().replace(' ', '.')}@example.com` },
      { user: admin }
    );
    // Update the userData object with the created ID for later use
    userData.id = created.data.id;
  }
  
  // Author creates a draft post
  console.log('\n2. Author creating a draft post...');
  const post = await api.resources.posts.create({
    title: 'My First Post',
    content: 'This is my content',
    authorId: author.id,
    status: 'draft',
    internalNotes: 'Needs review'
  }, { user: author });
  
  console.log(`   Created post ${post.data.id}`);
  
  // Author tries to publish (should fail)
  console.log('\n3. Author trying to publish post (should fail)...');
  try {
    await api.resources.posts.update(post.data.id, {
      status: 'published'
    }, { user: author });
  } catch (error) {
    console.log(`   ❌ Failed as expected: ${error.message}`);
  }
  
  // Moderator publishes the post
  console.log('\n4. Moderator publishing the post...');
  await api.resources.posts.update(post.data.id, {
    status: 'published'
  }, { user: moderator });
  console.log('   ✓ Post published');
  
  // Regular user reads the post (public access)
  console.log('\n5. Anonymous user reading the post...');
  const publicPost = await api.resources.posts.get(post.data.id);
  console.log(`   ✓ Can read: "${publicPost.data.attributes.title}"`);
  console.log(`   Internal notes visible: ${publicPost.data.attributes.internalNotes ? 'Yes' : 'No'}`);
  
  // Moderator reads the post (sees internal notes)
  console.log('\n6. Moderator reading the post...');
  const modPost = await api.resources.posts.get(post.data.id, { user: moderator });
  console.log(`   Internal notes visible: ${modPost.data.attributes.internalNotes ? 'Yes' : 'No'}`);
  
  // Regular user creates a comment
  console.log('\n7. Regular user adding a comment...');
  const comment = await api.resources.comments.create({
    postId: post.data.id,
    userId: regularUser.id,
    content: 'Great post!'
  }, { user: regularUser });
  console.log('   ✓ Comment created');
  
  // User tries to update another user's comment (should fail)
  console.log('\n8. User trying to edit another user\'s comment (should fail)...');
  try {
    await api.resources.comments.update(comment.data.id, {
      content: 'Hacked!'
    }, { user: author });
  } catch (error) {
    console.log(`   ❌ Failed as expected: ${error.message}`);
  }
  
  // User updates their own comment
  console.log('\n9. User updating their own comment...');
  await api.resources.comments.update(comment.data.id, {
    content: 'Really great post!'
  }, { user: regularUser });
  console.log('   ✓ Comment updated');
  
  // Show permission checks
  console.log('\n10. Permission checks for different users:');
  
  const users = [
    { user: admin, label: 'Admin' },
    { user: moderator, label: 'Moderator' },
    { user: author, label: 'Author' },
    { user: regularUser, label: 'Regular User' }
  ];
  
  for (const { user, label } of users) {
    const enhanced = await api.enhanceUserForAuth(user);
    console.log(`\n   ${label} (roles: ${enhanced.roles.join(', ')})`);
    console.log(`   - Can create posts: ${enhanced.can('posts.create')}`);
    console.log(`   - Can publish posts: ${enhanced.can('posts.moderate')}`);
    console.log(`   - Can delete any post: ${enhanced.can('posts.delete')}`);
    console.log(`   - Can update own posts: ${enhanced.can('posts.update.own')}`);
  }
  
  // Demonstrate field-level permissions
  console.log('\n11. Field-level permissions:');
  
  // Create user with sensitive data
  await api.resources.users.update(admin.id, {
    lastLoginAt: new Date()
  }, { user: admin });
  
  // Different users see different fields
  console.log('\n   Regular user viewing admin profile:');
  const adminProfile1 = await api.resources.users.get(admin.id, { user: regularUser });
  console.log(`   - Name: ${adminProfile1.data.attributes.name}`);
  console.log(`   - Last login visible: ${adminProfile1.data.attributes.lastLoginAt ? 'Yes' : 'No'}`);
  
  console.log('\n   Admin viewing own profile:');
  const adminProfile2 = await api.resources.users.get(admin.id, { user: admin });
  console.log(`   - Name: ${adminProfile2.data.attributes.name}`);
  console.log(`   - Last login visible: ${adminProfile2.data.attributes.lastLoginAt ? 'Yes' : 'No'}`);
}

// Run the demo
demonstrateAuthorization().catch(console.error);