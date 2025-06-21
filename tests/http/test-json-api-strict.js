import { startTestServer, curl, curlCmd, parseResponse, assertStatus, assertJsonApiResponse } from './setup.js';

export async function runJsonApiStrictTests(storageType) {
  console.log(`
==================================================
HTTP Tests: JSON:API Strict Mode (${storageType})
==================================================
`);
  
  // Setup test server with JSONAPIStrictPlugin
  const server = await startTestServer(storageType, {
    apiOptions: {
      plugins: [
        { plugin: 'JSONAPIStrictPlugin' }
      ]
    }
  });
  
  const { baseUrl, cleanup } = server;
  
  try {
    // Setup test data
    console.log('  Setting up test data...');
    
    // Create users
    const createUser1Cmd = curlCmd(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: {
        data: {
          attributes: {
            name: 'John Doe',
            email: 'john@example.com',
            age: 30,
            role: 'admin'
          }
        }
      }
    });
    
    const user1Result = await curl(createUser1Cmd);
    const user1Response = parseResponse(user1Result.raw);
    assertStatus(user1Response, 201);
    const user1Id = user1Response.data.data.id;
    
    const createUser2Cmd = curlCmd(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: {
        data: {
          attributes: {
            name: 'Jane Smith',
            email: 'jane@example.com',
            age: 25,
            role: 'user'
          }
        }
      }
    });
    
    const user2Result = await curl(createUser2Cmd);
    const user2Response = parseResponse(user2Result.raw);
    const user2Id = user2Response.data.data.id;
    
    // Create category
    const createCategoryCmd = curlCmd(`${baseUrl}/api/categories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: {
        data: {
          attributes: {
            name: 'Technology',
            description: 'Tech posts'
          }
        }
      }
    });
    
    const categoryResult = await curl(createCategoryCmd);
    const categoryResponse = parseResponse(categoryResult.raw);
    const categoryId = categoryResponse.data.data.id;
    
    // Create post with relationships
    const createPostCmd = curlCmd(`${baseUrl}/api/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: {
        data: {
          attributes: {
            title: 'JSON:API Guide',
            content: 'Understanding JSON:API specification',
            authorId: user1Id,
            categoryId: categoryId,
            status: 'published',
            tags: ['api', 'json', 'tutorial']
          }
        }
      }
    });
    
    const postResult = await curl(createPostCmd);
    const postResponse = parseResponse(postResult.raw);
    const postId = postResponse.data.data.id;
    
    // Test 9.1: Single resource with relationships
    console.log('  9.1 Single resource relationship structure');
    
    const getPostCmd = curlCmd(`${baseUrl}/api/posts/${postId}`);
    const getPostResult = await curl(getPostCmd);
    const getPostResponse = parseResponse(getPostResult.raw);
    
    assertStatus(getPostResponse, 200);
    const postData = getPostResponse.data.data;
    
    // Verify structure
    if (!postData.relationships) {
      throw new Error('Missing relationships object');
    }
    
    if (!postData.relationships.author) {
      throw new Error('Missing author relationship');
    }
    
    if (!postData.relationships.author.data) {
      throw new Error('Missing relationship data');
    }
    
    if (postData.relationships.author.data.type !== 'users') {
      throw new Error('Wrong relationship type');
    }
    
    if (!postData.relationships.author.links) {
      throw new Error('Missing relationship links');
    }
    
    // Verify foreign keys not in attributes
    if (postData.attributes.authorId !== undefined) {
      throw new Error('authorId should not be in attributes');
    }
    
    if (postData.attributes.categoryId !== undefined) {
      throw new Error('categoryId should not be in attributes');
    }
    
    console.log('  ✓ Relationships structured correctly');
    console.log('  ✓ Foreign keys removed from attributes');
    
    // Test 9.2: Compound documents with included
    console.log('  9.2 Compound documents with included array');
    
    const getPostWithIncludeCmd = curlCmd(`${baseUrl}/api/posts/${postId}?include=author,category`);
    const includeResult = await curl(getPostWithIncludeCmd);
    const includeResponse = parseResponse(includeResult.raw);
    
    assertStatus(includeResponse, 200);
    
    if (!includeResponse.data.included) {
      throw new Error('Missing included array');
    }
    
    if (!Array.isArray(includeResponse.data.included)) {
      throw new Error('Included should be an array');
    }
    
    // Find author in included
    const includedAuthor = includeResponse.data.included.find(
      item => item.type === 'users' && item.id === user1Id
    );
    
    if (!includedAuthor) {
      throw new Error('Author not found in included');
    }
    
    if (includedAuthor.attributes.name !== 'John Doe') {
      throw new Error('Author data incorrect in included');
    }
    
    // Find category in included
    const includedCategory = includeResponse.data.included.find(
      item => item.type === 'categories' && item.id === categoryId
    );
    
    if (!includedCategory) {
      throw new Error('Category not found in included');
    }
    
    console.log('  ✓ Included array contains related resources');
    
    // Test 9.3: Collection with relationships
    console.log('  9.3 Collection response with relationships');
    
    const getPostsCmd = curlCmd(`${baseUrl}/api/posts`);
    const postsResult = await curl(getPostsCmd);
    const postsResponse = parseResponse(postsResult.raw);
    
    assertStatus(postsResponse, 200);
    
    for (const post of postsResponse.data.data) {
      if (!post.relationships) {
        throw new Error('Post missing relationships');
      }
      
      if (post.attributes.authorId !== undefined) {
        throw new Error('Post has authorId in attributes');
      }
    }
    
    console.log('  ✓ Collections have proper relationships');
    
    // Test 9.4: Relationship links
    console.log('  9.4 Relationship links');
    
    const authorRelLinks = postData.relationships.author.links;
    
    if (!authorRelLinks.self || !authorRelLinks.self.includes(`/posts/${postId}/relationships/author`)) {
      throw new Error('Invalid relationship self link');
    }
    
    if (!authorRelLinks.related || !authorRelLinks.related.includes(`/posts/${postId}/author`)) {
      throw new Error('Invalid relationship related link');
    }
    
    console.log('  ✓ Relationship links correctly formatted');
    
    // Test 9.5: Meta information format
    console.log('  9.5 Meta information in collections');
    
    const pagedCmd = curlCmd(`${baseUrl}/api/posts?page[size]=1`);
    const pagedResult = await curl(pagedCmd);
    const pagedResponse = parseResponse(pagedResult.raw);
    
    assertStatus(pagedResponse, 200);
    
    if (!pagedResponse.data.meta) {
      throw new Error('Missing meta object');
    }
    
    if (typeof pagedResponse.data.meta.totalCount !== 'number') {
      throw new Error('Missing or invalid totalCount in meta');
    }
    
    if (typeof pagedResponse.data.meta.currentPage !== 'number') {
      throw new Error('Missing or invalid currentPage in meta');
    }
    
    if (typeof pagedResponse.data.meta.pageSize !== 'number') {
      throw new Error('Missing or invalid pageSize in meta');
    }
    
    console.log('  ✓ Meta follows JSON:API format');
    
    // Test 9.6: Error response format
    console.log('  9.6 Error response format');
    
    const errorCmd = curlCmd(`${baseUrl}/api/posts/99999`);
    const errorResult = await curl(errorCmd);
    const errorResponse = parseResponse(errorResult.raw);
    
    assertStatus(errorResponse, 404);
    
    if (!errorResponse.data.errors) {
      throw new Error('Missing errors array');
    }
    
    if (!Array.isArray(errorResponse.data.errors)) {
      throw new Error('Errors should be an array');
    }
    
    const error = errorResponse.data.errors[0];
    if (!error.status || !error.code || !error.title || !error.detail) {
      throw new Error('Error missing required fields');
    }
    
    console.log('  ✓ Errors follow JSON:API format');
    
    // Test 9.7: Sparse fieldsets with relationships
    console.log('  9.7 Sparse fieldsets preserve relationships');
    
    const sparseCmd = curlCmd(`${baseUrl}/api/posts/${postId}?fields[posts]=title`);
    const sparseResult = await curl(sparseCmd);
    const sparseResponse = parseResponse(sparseResult.raw);
    
    assertStatus(sparseResponse, 200);
    
    const sparseData = sparseResponse.data.data;
    const attrKeys = Object.keys(sparseData.attributes);
    
    if (attrKeys.length !== 1 || attrKeys[0] !== 'title') {
      throw new Error('Sparse fieldsets not working correctly');
    }
    
    if (!sparseData.relationships) {
      throw new Error('Relationships missing with sparse fieldsets');
    }
    
    console.log('  ✓ Sparse fieldsets work with relationships');
    
    // Test 9.8: Create with relationships (JSON:API style)
    console.log('  9.8 Create with JSON:API relationship format');
    
    // Note: This test shows that you can still use the simple format for creation
    // The plugin transforms the response, not the request
    const createCommentCmd = curlCmd(`${baseUrl}/api/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: {
        data: {
          attributes: {
            content: 'Great post!',
            postId: postId,
            authorId: user2Id
          }
        }
      }
    });
    
    const commentResult = await curl(createCommentCmd);
    const commentResponse = parseResponse(commentResult.raw);
    
    assertStatus(commentResponse, 201);
    
    const commentData = commentResponse.data.data;
    if (!commentData.relationships || !commentData.relationships.post || !commentData.relationships.author) {
      throw new Error('Comment missing relationships');
    }
    
    console.log('  ✓ Create operations return proper relationships');
    
    // Test 9.9: No duplicate resources in included
    console.log('  9.9 No duplicates in included array');
    
    // Create another post by same author
    const createPost2Cmd = curlCmd(`${baseUrl}/api/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: {
        data: {
          attributes: {
            title: 'Another Post',
            content: 'More content',
            authorId: user1Id,
            status: 'published'
          }
        }
      }
    });
    
    await curl(createPost2Cmd);
    
    // Get all posts with author included
    const allPostsCmd = curlCmd(`${baseUrl}/api/posts?include=author`);
    const allPostsResult = await curl(allPostsCmd);
    const allPostsResponse = parseResponse(allPostsResult.raw);
    
    assertStatus(allPostsResponse, 200);
    
    if (allPostsResponse.data.included) {
      const authorIds = allPostsResponse.data.included
        .filter(item => item.type === 'users')
        .map(item => item.id);
      
      const uniqueAuthorIds = [...new Set(authorIds)];
      
      if (authorIds.length !== uniqueAuthorIds.length) {
        throw new Error('Duplicate resources in included array');
      }
    }
    
    console.log('  ✓ No duplicate resources in included');
    
    // Cleanup test data
    console.log('  Cleaning up test data...');
    
  } finally {
    await cleanup();
  }
}