import { createApi, Schema } from '../index.js';

// Create API with memory storage
const api = createApi({ 
  storage: 'memory',
  debug: false 
});

// Define schemas with to-many relationships

// Blog has many posts
api.addResource('blogs', new Schema({
  name: { type: 'string', required: true },
  url: { type: 'string' },
  posts: {
    type: 'list',
    virtual: true,  // Not stored in the blogs table
    foreignResource: 'posts',
    foreignKey: 'blogId',
    // Optional: default filters and sorting
    defaultFilter: { published: true },
    defaultSort: '-publishedAt'
  }
}));

// Post belongs to a blog and has many comments
api.addResource('posts', new Schema({
  title: { type: 'string', required: true },
  content: { type: 'string' },
  published: { type: 'boolean', default: false, searchable: true },
  publishedAt: { type: 'timestamp', searchable: true },
  blogId: { 
    type: 'id', 
    refs: { resource: 'blogs' },
    searchable: true  // Required for to-many queries
  },
  comments: {
    type: 'list',
    virtual: true,
    foreignResource: 'comments',
    foreignKey: 'postId'
  }
}));

// Comment belongs to a post
api.addResource('comments', new Schema({
  author: { type: 'string', required: true },
  content: { type: 'string', required: true },
  createdAt: { type: 'timestamp', default: () => Date.now() },
  postId: { 
    type: 'id', 
    refs: { resource: 'posts' },
    searchable: true
  }
}));

await api.connect();

console.log('=== To-Many Relationships Example ===\n');

// Create test data
console.log('Creating test data...\n');

const techBlog = await api.insert({
  name: 'Tech Insights',
  url: 'https://tech-insights.example.com'
}, { type: 'blogs' });

const personalBlog = await api.insert({
  name: 'My Personal Blog',
  url: 'https://personal.example.com'
}, { type: 'blogs' });

// Create posts for tech blog
const post1 = await api.insert({
  title: 'Understanding Microservices',
  content: 'Microservices are a software architecture pattern...',
  published: true,
  publishedAt: Date.now() - 86400000, // Yesterday
  blogId: techBlog.data.id
}, { type: 'posts' });

const post2 = await api.insert({
  title: 'Docker Best Practices',
  content: 'When working with Docker, consider these practices...',
  published: true,
  publishedAt: Date.now(),
  blogId: techBlog.data.id
}, { type: 'posts' });

const draftPost = await api.insert({
  title: 'Kubernetes Deep Dive (DRAFT)',
  content: 'Work in progress...',
  published: false,
  blogId: techBlog.data.id
}, { type: 'posts' });

// Create comments for post1
await api.insert({
  author: 'Alice',
  content: 'Great article! Very informative.',
  postId: post1.data.id
}, { type: 'comments' });

await api.insert({
  author: 'Bob',
  content: 'I have a question about service discovery...',
  postId: post1.data.id
}, { type: 'comments' });

console.log('1. Basic to-many relationship:');
console.log('   Getting blog with all its posts...\n');

// Get blog with posts included
const blogWithPosts = await api.get(techBlog.data.id, {
  type: 'blogs',
  include: 'posts'
});

console.log(`Blog: ${blogWithPosts.data.attributes.name}`);
console.log(`Number of posts: ${blogWithPosts.data.relationships.posts.data.length}`);
console.log('\nIncluded posts:');
blogWithPosts.included?.forEach(post => {
  console.log(`- ${post.attributes.title} (published: ${post.attributes.published})`);
});

console.log('\n2. Default filters in action:');
console.log('   Note: Only published posts are included due to defaultFilter\n');

console.log('3. Getting a post with comments:');
const postWithComments = await api.get(post1.data.id, {
  type: 'posts',
  include: 'comments'
});

console.log(`\nPost: ${postWithComments.data.attributes.title}`);
console.log(`Number of comments: ${postWithComments.data.relationships.comments.data.length}`);
console.log('\nComments:');
postWithComments.included?.forEach(comment => {
  console.log(`- ${comment.attributes.author}: "${comment.attributes.content}"`);
});

console.log('\n4. Empty to-many relationships:');
const emptyBlog = await api.get(personalBlog.data.id, {
  type: 'blogs',
  include: 'posts'
});

console.log(`\nBlog: ${emptyBlog.data.attributes.name}`);
console.log(`Number of posts: ${emptyBlog.data.relationships.posts.data.length}`);
console.log('(Empty array is properly handled)');

console.log('\n5. Multiple includes:');
const blogComplete = await api.get(techBlog.data.id, {
  type: 'blogs',
  include: 'posts,posts.comments'  // Include posts and their comments
});

console.log(`\nBlog: ${blogComplete.data.attributes.name}`);
console.log('Posts and their comments:');
const posts = blogComplete.included?.filter(i => i.type === 'posts') || [];
posts.forEach(post => {
  console.log(`\n- ${post.attributes.title}`);
  // Note: Nested to-many includes not fully implemented yet
  // In a full implementation, comments would also be included
});

console.log('\n6. Querying with to-many relationships:');
// You can also query the child resources directly
const techBlogPosts = await api.query({
  filter: { blogId: techBlog.data.id, published: true },
  sort: '-publishedAt'
}, { type: 'posts' });

console.log(`\nPublished posts from ${techBlog.data.attributes.name}:`);
techBlogPosts.data.forEach(post => {
  console.log(`- ${post.attributes.title} (published at: ${new Date(post.attributes.publishedAt).toLocaleDateString()})`);
});

console.log('\n✅ To-Many Relationships Example Complete!');
console.log('\nKey takeaways:');
console.log('- Define to-many relationships with type: "list" and foreignResource/foreignKey');
console.log('- Foreign keys must be marked as searchable: true');
console.log('- Use defaultFilter and defaultSort for automatic filtering/sorting');
console.log('- Include to-many relationships with the include parameter');
console.log('- Relationships data follows JSON:API format');
console.log('- Empty relationships return empty arrays');
console.log('- Child resources are queried using QueryBuilder with proper hooks');