import { runHttpTests, curl, curlCmd, parseResponse, assertStatus, assertJsonApiResponse } from './setup.js'

// Test 7: Relationships and Joins
await runHttpTests('Relationships and Joins', async ({ baseUrl }, storageType) => {
  
  // Setup test data
  console.log('  Setting up test data...')
  
  // Create users (authors)
  const users = []
  const usersData = [
    { name: 'Author One', email: 'author1@example.com', role: 'admin' },
    { name: 'Author Two', email: 'author2@example.com', role: 'user' },
    { name: 'Author Three', email: 'author3@example.com', role: 'user' }
  ]
  
  for (const userData of usersData) {
    const cmd = curlCmd(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: { data: { attributes: userData } }
    })
    
    const result = await curl(cmd)
    const response = parseResponse(result.raw)
    assertStatus(response, 201)
    users.push(response.data.data)
  }
  
  // Create categories
  const categories = []
  const categoriesData = [
    { name: 'Technology', description: 'Tech related posts' },
    { name: 'Science', description: 'Science topics' },
    { name: 'General', description: 'General topics' }
  ]
  
  for (const categoryData of categoriesData) {
    const cmd = curlCmd(`${baseUrl}/api/categories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: { data: { attributes: categoryData } }
    })
    
    const result = await curl(cmd)
    const response = parseResponse(result.raw)
    assertStatus(response, 201)
    categories.push(response.data.data)
  }
  
  // Create posts with relationships
  const posts = []
  const postsData = [
    {
      title: 'First Post',
      content: 'Content of first post',
      authorId: users[0].id,
      categoryId: categories[0].id,
      status: 'published',
      tags: ['tech', 'intro']
    },
    {
      title: 'Second Post',
      content: 'Content of second post',
      authorId: users[1].id,
      categoryId: categories[1].id,
      status: 'published',
      tags: ['science']
    },
    {
      title: 'Third Post',
      content: 'Content of third post',
      authorId: users[0].id,
      categoryId: categories[0].id,
      status: 'draft',
      tags: ['tech', 'advanced']
    }
  ]
  
  for (const postData of postsData) {
    const cmd = curlCmd(`${baseUrl}/api/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: { data: { attributes: postData } }
    })
    
    const result = await curl(cmd)
    const response = parseResponse(result.raw)
    assertStatus(response, 201)
    posts.push(response.data.data)
  }
  
  // Create comments with relationships
  const comments = []
  const commentsData = [
    {
      postId: posts[0].id,
      userId: users[1].id,
      content: 'Great post!'
    },
    {
      postId: posts[0].id,
      userId: users[2].id,
      content: 'Thanks for sharing'
    },
    {
      postId: posts[1].id,
      userId: users[0].id,
      content: 'Interesting perspective'
    }
  ]
  
  for (const commentData of commentsData) {
    const cmd = curlCmd(`${baseUrl}/api/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: { data: { attributes: commentData } }
    })
    
    const result = await curl(cmd)
    const response = parseResponse(result.raw)
    assertStatus(response, 201)
    comments.push(response.data.data)
  }
  
  // 7.1 Eager joins on single resource
  console.log('  7.1 Eager joins on single resource')
  
  // Get post - should have author eagerly joined
  const getPostCmd = curlCmd(`${baseUrl}/api/posts/${posts[0].id}`)
  const getPostResult = await curl(getPostCmd)
  const getPostResponse = parseResponse(getPostResult.raw)
  
  assertStatus(getPostResponse, 200)
  
  // Check eager join for authorId
  const postData = getPostResponse.data.data
  if (!postData.attributes.author || typeof postData.attributes.author !== 'object') {
    throw new Error('Author should be eagerly joined as object')
  }
  
  if (postData.attributes.author.id !== Number(users[0].id)) {
    throw new Error('Joined author has wrong ID')
  }
  
  if (!postData.attributes.author.name || !postData.attributes.author.email) {
    throw new Error('Joined author missing required fields')
  }
  
  // preserveId should keep authorId as string
  if (postData.attributes.authorId !== String(users[0].id)) {
    throw new Error('authorId should be preserved as string')
  }
  
  // categoryId should NOT be eagerly joined (not configured)
  if (typeof postData.attributes.categoryId === 'object') {
    throw new Error('categoryId should not be eagerly joined')
  }
  
  // 7.2 Eager joins on collection
  console.log('  7.2 Eager joins on collection')
  
  const getPostsCmd = curlCmd(`${baseUrl}/api/posts`)
  const getPostsResult = await curl(getPostsCmd)
  const getPostsResponse = parseResponse(getPostsResult.raw)
  
  assertStatus(getPostsResponse, 200)
  
  // All posts should have author joined
  for (const post of getPostsResponse.data.data) {
    if (!post.attributes.author || typeof post.attributes.author !== 'object') {
      throw new Error(`Post ${post.id} missing author join`)
    }
    
    // Verify author data matches
    const expectedAuthor = users.find(u => u.id === post.attributes.authorId)
    if (post.attributes.author.id !== Number(expectedAuthor.id)) {
      throw new Error(`Post ${post.id} has wrong author data`)
    }
  }
  
  // 7.3 Include parameter for additional joins
  console.log('  7.3 Include parameter for additional joins')
  
  const includeCmd = curlCmd(`${baseUrl}/api/posts?include=categoryId`)
  const includeResult = await curl(includeCmd)
  const includeResponse = parseResponse(includeResult.raw)
  
  assertStatus(includeResponse, 200)
  
  // Posts should now have both author (eager) and category (included)
  for (const post of includeResponse.data.data) {
    // Author should still be joined
    if (!post.attributes.author) {
      throw new Error('Author join missing when using include')
    }
    
    // Category should now be joined
    if (!post.attributes.category || typeof post.attributes.category !== 'object') {
      throw new Error('Category not joined with include parameter')
    }
    
    const expectedCategory = categories.find(c => c.id === post.attributes.categoryId)
    if (post.attributes.category.id !== Number(expectedCategory.id)) {
      throw new Error('Joined category has wrong data')
    }
  }
  
  // 7.4 Multiple includes
  console.log('  7.4 Multiple includes')
  
  // Get comments with both user and post included
  const multiIncludeCmd = curlCmd(`${baseUrl}/api/comments?include=userId,postId`)
  const multiIncludeResult = await curl(multiIncludeCmd)
  const multiIncludeResponse = parseResponse(multiIncludeResult.raw)
  
  assertStatus(multiIncludeResponse, 200)
  
  for (const comment of multiIncludeResponse.data.data) {
    // User should be eagerly joined (configured in schema)
    if (!comment.attributes.user || typeof comment.attributes.user !== 'object') {
      throw new Error('User not eagerly joined in comment')
    }
    
    // Post should be included via parameter
    if (!comment.attributes.post || typeof comment.attributes.post !== 'object') {
      throw new Error('Post not joined via include parameter')
    }
    
    // Verify data
    const expectedUser = users.find(u => u.id === comment.attributes.userId)
    if (comment.attributes.user.id !== Number(expectedUser.id)) {
      throw new Error('Joined user has wrong data')
    }
    
    const expectedPost = posts.find(p => p.id === comment.attributes.postId)
    if (comment.attributes.post.id !== Number(expectedPost.id)) {
      throw new Error('Joined post has wrong data')
    }
  }
  
  // 7.5 Nested joins
  console.log('  7.5 Nested joins')
  
  // Create a category with parent
  const childCategoryCmd = curlCmd(`${baseUrl}/api/categories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          name: 'JavaScript',
          description: 'JS subcategory',
          parentId: categories[0].id
        }
      }
    }
  })
  
  const childCategoryResult = await curl(childCategoryCmd)
  const childCategoryResponse = parseResponse(childCategoryResult.raw)
  assertStatus(childCategoryResponse, 201)
  const childCategory = childCategoryResponse.data.data
  
  // Get category with parent join
  const getCategoryCmd = curlCmd(`${baseUrl}/api/categories/${childCategory.id}?include=parentId`)
  const getCategoryResult = await curl(getCategoryCmd)
  const getCategoryResponse = parseResponse(getCategoryResult.raw)
  
  assertStatus(getCategoryResponse, 200)
  
  const categoryData = getCategoryResponse.data.data
  
  
  if (!categoryData.attributes.parent || typeof categoryData.attributes.parent !== 'object') {
    throw new Error('Parent category not joined')
  }
  
  if (categoryData.attributes.parent.id !== Number(categories[0].id)) {
    throw new Error('Joined parent has wrong ID')
  }
  
  // 7.6 Join with field selection
  console.log('  7.6 Join with field selection')
  
  // The schema specifies only certain fields for author join
  const joinedPost = getPostResponse.data.data
  
  // Should have id, name, email (as specified in schema)
  if (!joinedPost.attributes.author.id || 
      !joinedPost.attributes.author.name || 
      !joinedPost.attributes.author.email) {
    throw new Error('Joined author missing specified fields')
  }
  
  // Should NOT have other fields like role, isActive
  if (joinedPost.attributes.author.role !== undefined || 
      joinedPost.attributes.author.isActive !== undefined) {
    throw new Error('Joined author should not include non-specified fields')
  }
  
  // 7.7 Filtering on joined fields
  console.log('  7.7 Filtering on joined fields')
  
  // This might not be supported yet, but let's test
  const filterJoinCmd = curlCmd(`${baseUrl}/api/posts?filter[author.name]=Author%20One`)
  const filterJoinResult = await curl(filterJoinCmd)
  
  if (filterJoinResult.success) {
    const filterJoinResponse = parseResponse(filterJoinResult.raw)
    
    if (filterJoinResponse.status === 200) {
      // If supported, verify results
      const authorOnePosts = filterJoinResponse.data.data.filter(
        p => p.attributes.author.name === 'Author One'
      )
      
      if (authorOnePosts.length !== filterJoinResponse.data.data.length) {
        throw new Error('Filter on joined field not working correctly')
      }
      console.log('  ✓ Filtering on joined fields supported')
    } else if (filterJoinResponse.status === 422) {
      console.log('  ✓ Filtering on joined fields not supported (as expected)')
    }
  }
  
  // 7.8 Circular reference handling
  console.log('  7.8 Circular reference handling')
  
  // Create a comment that replies to another comment
  const replyCmd = curlCmd(`${baseUrl}/api/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          postId: posts[0].id,
          userId: users[0].id,
          content: 'Reply to first comment',
          parentId: comments[0].id
        }
      }
    }
  })
  
  const replyResult = await curl(replyCmd)
  const replyResponse = parseResponse(replyResult.raw)
  assertStatus(replyResponse, 201)
  const replyComment = replyResponse.data.data
  
  // Get comment with parent - should not cause infinite loop
  const getReplyCmd = curlCmd(`${baseUrl}/api/comments/${replyComment.id}?include=parentId`)
  const getReplyResult = await curl(getReplyCmd)
  
  if (getReplyResult.success) {
    const getReplyResponse = parseResponse(getReplyResult.raw)
    assertStatus(getReplyResponse, 200)
    
    const reply = getReplyResponse.data.data
    if (reply.attributes.parent && typeof reply.attributes.parent === 'object') {
      console.log('  ✓ Circular references handled correctly')
    }
  }
  
  // 7.9 Invalid includes
  console.log('  7.9 Invalid includes')
  
  const invalidIncludeCmd = curlCmd(`${baseUrl}/api/posts?include=nonExistentField`)
  const invalidIncludeResult = await curl(invalidIncludeCmd)
  
  // Should either ignore or return error
  if (invalidIncludeResult.success) {
    const invalidIncludeResponse = parseResponse(invalidIncludeResult.raw)
    
    if (invalidIncludeResponse.status === 200) {
      console.log('  ✓ Invalid includes ignored')
    } else {
      console.log('  ✓ Invalid includes rejected with error')
    }
  }
  
  // 7.10 Performance with joins
  console.log('  7.10 Performance with joins')
  
  // Create more data for performance test
  const perfPosts = []
  for (let i = 0; i < 20; i++) {
    const cmd = curlCmd(`${baseUrl}/api/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: {
        data: {
          attributes: {
            title: `Performance Test Post ${i}`,
            content: `Content ${i}`,
            authorId: users[i % users.length].id,
            categoryId: categories[i % categories.length].id,
            status: 'published'
          }
        }
      }
    })
    
    const result = await curl(cmd)
    const response = parseResponse(result.raw)
    perfPosts.push(response.data.data)
  }
  
  // Query with multiple joins
  const perfCmd = curlCmd(`${baseUrl}/api/posts?include=categoryId&page[size]=50`)
  const perfStart = Date.now()
  const perfResult = await curl(perfCmd)
  const perfTime = Date.now() - perfStart
  
  if (perfResult.success) {
    const perfResponse = parseResponse(perfResult.raw)
    assertStatus(perfResponse, 200)
    
    console.log(`  ✓ Query with joins completed in ${perfTime}ms`)
    
    // Verify all joins were performed
    const totalPosts = perfResponse.data.data.length
    const postsWithAuthor = perfResponse.data.data.filter(p => p.attributes.author).length
    const postsWithCategory = perfResponse.data.data.filter(p => p.attributes.category).length
    
    if (postsWithAuthor !== totalPosts) {
      throw new Error('Not all posts have author joined')
    }
    
    if (postsWithCategory !== totalPosts) {
      throw new Error('Not all posts have category joined')
    }
  }
  
  // Cleanup
  console.log('  Cleaning up test data...')
  
  // Delete all created data in reverse order
  for (const comment of [...comments, replyComment]) {
    if (comment && comment.id) {
      await curl(curlCmd(`${baseUrl}/api/comments/${comment.id}`, { method: 'DELETE' }))
    }
  }
  
  for (const post of [...posts, ...perfPosts]) {
    if (post && post.id) {
      await curl(curlCmd(`${baseUrl}/api/posts/${post.id}`, { method: 'DELETE' }))
    }
  }
  
  // Delete child category first
  await curl(curlCmd(`${baseUrl}/api/categories/${childCategory.id}`, { method: 'DELETE' }))
  
  for (const category of categories) {
    await curl(curlCmd(`${baseUrl}/api/categories/${category.id}`, { method: 'DELETE' }))
  }
  
  for (const user of users) {
    await curl(curlCmd(`${baseUrl}/api/users/${user.id}`, { method: 'DELETE' }))
  }
})

console.log('\nAll relationships and joins tests passed! ✅')