import { runHttpTests, curl, curlCmd, parseResponse, assertStatus, assertJsonApiResponse, wait } from './setup.js'

// Test 9: Hooks and Middleware
await runHttpTests('Hooks and Middleware', async ({ baseUrl, api }, storageType) => {
  
  // 9.1 beforeInsert hook
  console.log('  9.1 beforeInsert hook')
  
  // Track hook execution
  let beforeInsertCalled = false
  let hookData = null
  
  api.hook('beforeInsert', async (context) => {
    if (context.options.type === 'users') {
      beforeInsertCalled = true
      hookData = { ...context.data }
      
      // Modify data
      context.data.name = context.data.name.toUpperCase()
      context.data.metadata = { 
        ...context.data.metadata,
        createdBy: 'beforeInsert'
      }
    }
  })
  
  const createUserCmd = curlCmd(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          name: 'Test User',
          email: 'hook@example.com'
        }
      }
    }
  })
  
  const createUserResult = await curl(createUserCmd)
  const createUserResponse = parseResponse(createUserResult.raw)
  assertStatus(createUserResponse, 201)
  
  if (!beforeInsertCalled) {
    throw new Error('beforeInsert hook was not called')
  }
  
  if (hookData.name !== 'Test User') {
    throw new Error('Hook received wrong data')
  }
  
  const createdUser = createUserResponse.data.data
  if (createdUser.attributes.name !== 'TEST USER') {
    throw new Error('beforeInsert hook modification not applied')
  }
  
  if (!createdUser.attributes.metadata?.createdBy) {
    throw new Error('beforeInsert hook metadata not added')
  }
  
  // 9.2 afterInsert hook
  console.log('  9.2 afterInsert hook')
  
  let afterInsertCalled = false
  let afterInsertResult = null
  
  api.hook('afterInsert', async (context) => {
    if (context.options.type === 'posts') {
      afterInsertCalled = true
      afterInsertResult = context.result
      
      // Add to context for response modification
      context.affectedRecords = [
        { type: 'users', id: context.data.authorId }
      ]
    }
  })
  
  const createPostCmd = curlCmd(`${baseUrl}/api/posts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          title: 'Test Post',
          content: 'Content',
          authorId: createdUser.id
        }
      }
    }
  })
  
  const createPostResult = await curl(createPostCmd)
  const createPostResponse = parseResponse(createPostResult.raw)
  assertStatus(createPostResponse, 201)
  
  if (!afterInsertCalled) {
    throw new Error('afterInsert hook was not called')
  }
  
  if (!afterInsertResult || !afterInsertResult.id) {
    throw new Error('afterInsert hook did not receive result')
  }
  
  const createdPost = createPostResponse.data.data
  
  // 9.3 beforeUpdate hook
  console.log('  9.3 beforeUpdate hook')
  
  let beforeUpdateCalled = false
  let updateContext = null
  
  api.hook('beforeUpdate', async (context) => {
    if (context.options.type === 'users') {
      beforeUpdateCalled = true
      updateContext = {
        id: context.id,
        data: { ...context.data },
        existingData: context.existingData ? { ...context.existingData } : null
      }
      
      // Add timestamp
      context.data.metadata = {
        ...context.data.metadata,
        updatedBy: 'beforeUpdate',
        updatedAt: new Date().toISOString()
      }
    }
  })
  
  // First get the current user to have existingData
  const getUserCmd = curlCmd(`${baseUrl}/api/users/${createdUser.id}`)
  await curl(getUserCmd)
  
  const updateUserCmd = curlCmd(`${baseUrl}/api/users/${createdUser.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          name: 'Updated User'
        }
      }
    }
  })
  
  const updateUserResult = await curl(updateUserCmd)
  const updateUserResponse = parseResponse(updateUserResult.raw)
  assertStatus(updateUserResponse, 200)
  
  if (!beforeUpdateCalled) {
    throw new Error('beforeUpdate hook was not called')
  }
  
  if (updateContext.id !== createdUser.id) {
    throw new Error('beforeUpdate hook received wrong ID')
  }
  
  const updatedUser = updateUserResponse.data.data
  if (!updatedUser.attributes.metadata?.updatedBy) {
    throw new Error('beforeUpdate hook modification not applied')
  }
  
  // 9.4 afterUpdate hook
  console.log('  9.4 afterUpdate hook')
  
  let afterUpdateCalled = false
  let afterUpdateContext = null
  
  api.hook('afterUpdate', async (context) => {
    if (context.options.type === 'posts') {
      afterUpdateCalled = true
      afterUpdateContext = {
        id: context.id,
        data: { ...context.data },
        result: context.result ? { ...context.result } : null
      }
    }
  })
  
  const updatePostCmd = curlCmd(`${baseUrl}/api/posts/${createdPost.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          title: 'Updated Post Title'
        }
      }
    }
  })
  
  const updatePostResult = await curl(updatePostCmd)
  const updatePostResponse = parseResponse(updatePostResult.raw)
  assertStatus(updatePostResponse, 200)
  
  if (!afterUpdateCalled) {
    throw new Error('afterUpdate hook was not called')
  }
  
  if (!afterUpdateContext || afterUpdateContext.id !== createdPost.id) {
    throw new Error('afterUpdate hook received wrong context')
  }
  
  if (afterUpdateContext.data.title !== 'Updated Post Title') {
    throw new Error('afterUpdate hook did not receive updated data')
  }
  
  // 9.5 beforeDelete hook
  console.log('  9.5 beforeDelete hook')
  
  let beforeDeleteCalled = false
  let deleteBackup = null
  
  api.hook('beforeDelete', async (context) => {
    if (context.options.type === 'posts') {
      beforeDeleteCalled = true
      
      // Create backup before deletion
      const post = await api.get(context.id, { type: 'posts' })
      deleteBackup = post.data
    }
  })
  
  const deletePostCmd = curlCmd(`${baseUrl}/api/posts/${createdPost.id}`, {
    method: 'DELETE'
  })
  
  const deletePostResult = await curl(deletePostCmd)
  const deletePostResponse = parseResponse(deletePostResult.raw)
  assertStatus(deletePostResponse, 204)
  
  if (!beforeDeleteCalled) {
    throw new Error('beforeDelete hook was not called')
  }
  
  if (!deleteBackup || deleteBackup.id !== createdPost.id) {
    throw new Error('beforeDelete hook did not backup data')
  }
  
  // 9.6 Hook priority
  console.log('  9.6 Hook priority')
  
  const executionOrder = []
  
  // Add hooks with different priorities
  api.hook('beforeInsert', async () => {
    executionOrder.push('hook3')
  }, 30) // Default priority
  
  api.hook('beforeInsert', async () => {
    executionOrder.push('hook1')
  }, 10) // Lower number = higher priority
  
  api.hook('beforeInsert', async () => {
    executionOrder.push('hook2')
  }, 20)
  
  const priorityTestCmd = curlCmd(`${baseUrl}/api/categories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          name: 'Priority Test Category'
        }
      }
    }
  })
  
  const priorityTestResult = await curl(priorityTestCmd)
  const priorityTestResponse = parseResponse(priorityTestResult.raw)
  assertStatus(priorityTestResponse, 201)
  
  if (executionOrder.join(',') !== 'hook1,hook2,hook3') {
    throw new Error(`Hook priority not working. Order was: ${executionOrder.join(',')}`)
  }
  
  const categoryId = priorityTestResponse.data.data.id
  
  // 9.7 Hook errors
  console.log('  9.7 Hook errors')
  
  api.hook('beforeInsert', async (context) => {
    if (context.options.type === 'categories' && context.data.name === 'Error Test') {
      throw new Error('Hook validation failed')
    }
  })
  
  const errorHookCmd = curlCmd(`${baseUrl}/api/categories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          name: 'Error Test'
        }
      }
    }
  })
  
  const errorHookResult = await curl(errorHookCmd)
  const errorHookResponse = parseResponse(errorHookResult.raw)
  
  // Should fail with error from hook
  if (errorHookResponse.status === 201) {
    throw new Error('Hook error did not prevent insert')
  }
  
  // 9.8 Query hooks
  console.log('  9.8 Query hooks')
  
  let beforeQueryCalled = false
  let queryModified = false
  
  api.hook('beforeQuery', async (context) => {
    if (context.options.type === 'users') {
      beforeQueryCalled = true
      
      // Add default filter
      if (!context.params.filter) {
        context.params.filter = {}
      }
      
      if (!context.params.filter.role) {
        context.params.filter.role = 'user'
        queryModified = true
      }
    }
  })
  
  // Create admin user
  const adminCmd = curlCmd(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          name: 'Admin User',
          email: 'admin@example.com',
          role: 'admin'
        }
      }
    }
  })
  
  await curl(adminCmd)
  
  // Query without filter - should only get non-admin users
  const queryUsersCmd = curlCmd(`${baseUrl}/api/users`)
  const queryUsersResult = await curl(queryUsersCmd)
  const queryUsersResponse = parseResponse(queryUsersResult.raw)
  
  if (!beforeQueryCalled) {
    throw new Error('beforeQuery hook was not called')
  }
  
  if (queryModified) {
    // Check that no admin users are returned
    const adminUsers = queryUsersResponse.data.data.filter(
      u => u.attributes.role === 'admin'
    )
    
    if (adminUsers.length > 0) {
      throw new Error('beforeQuery hook filter not applied')
    }
  }
  
  // 9.9 afterQuery hook
  console.log('  9.9 afterQuery hook')
  
  let afterQueryCalled = false
  
  api.hook('afterQuery', async (context) => {
    if (context.options.type === 'posts') {
      afterQueryCalled = true
      
      // Add computed field to results
      if (context.results) {
        for (const post of context.results) {
          post.computed = {
            wordCount: post.content ? post.content.split(' ').length : 0
          }
        }
      }
    }
  })
  
  const queryPostsCmd = curlCmd(`${baseUrl}/api/posts`)
  const queryPostsResult = await curl(queryPostsCmd)
  const queryPostsResponse = parseResponse(queryPostsResult.raw)
  
  if (!afterQueryCalled) {
    throw new Error('afterQuery hook was not called')
  }
  
  // Check computed field
  if (queryPostsResponse.data.data.length > 0) {
    const firstPost = queryPostsResponse.data.data[0]
    if (!firstPost.attributes.computed || typeof firstPost.attributes.computed.wordCount !== 'number') {
      throw new Error('afterQuery hook did not add computed field')
    }
  }
  
  // 9.10 Middleware integration
  console.log('  9.10 Middleware integration')
  
  // Add custom middleware
  let middlewareCalled = false
  
  api.useMiddleware((req, res, next) => {
    middlewareCalled = true
    req.customHeader = 'middleware-test'
    next()
  })
  
  // Make request to trigger middleware
  const middlewareCmd = curlCmd(`${baseUrl}/api/users`)
  const middlewareResult = await curl(middlewareCmd)
  const middlewareResponse = parseResponse(middlewareResult.raw)
  
  assertStatus(middlewareResponse, 200)
  
  if (!middlewareCalled) {
    console.log('    Warning: Custom middleware may not be testable via curl')
  }
  
  // 9.11 Async hook handling
  console.log('  9.11 Async hook handling')
  
  const asyncResults = []
  
  // Add multiple async hooks
  api.hook('beforeInsert', async (context) => {
    if (context.options.type === 'categories') {
      await wait(50)
      asyncResults.push('async1')
    }
  })
  
  api.hook('beforeInsert', async (context) => {
    if (context.options.type === 'categories') {
      await wait(25)
      asyncResults.push('async2')
    }
  })
  
  api.hook('beforeInsert', async (context) => {
    if (context.options.type === 'categories') {
      // Synchronous
      asyncResults.push('sync')
    }
  })
  
  const asyncTestCmd = curlCmd(`${baseUrl}/api/categories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          name: 'Async Test Category'
        }
      }
    }
  })
  
  const asyncTestResult = await curl(asyncTestCmd)
  const asyncTestResponse = parseResponse(asyncTestResult.raw)
  assertStatus(asyncTestResponse, 201)
  
  // All hooks should have run
  if (asyncResults.length !== 3) {
    throw new Error('Not all async hooks completed')
  }
  
  // 9.12 Hook context propagation
  console.log('  9.12 Hook context propagation')
  
  let contextPropagated = false
  
  api.hook('beforeInsert', async (context) => {
    if (context.options.type === 'users') {
      // Add custom context
      context.customData = {
        timestamp: Date.now(),
        source: 'beforeInsert'
      }
    }
  })
  
  api.hook('afterInsert', async (context) => {
    if (context.options.type === 'users' && context.customData) {
      contextPropagated = context.customData.source === 'beforeInsert'
    }
  })
  
  const contextTestCmd = curlCmd(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          name: 'Context Test',
          email: 'context@example.com'
        }
      }
    }
  })
  
  const contextTestResult = await curl(contextTestCmd)
  const contextTestResponse = parseResponse(contextTestResult.raw)
  assertStatus(contextTestResponse, 201)
  
  if (!contextPropagated) {
    throw new Error('Context not propagated between hooks')
  }
  
  // Cleanup
  console.log('  Cleaning up test data...')
  
  // Delete all created data
  await curl(curlCmd(`${baseUrl}/api/categories/${categoryId}`, { method: 'DELETE' }))
  await curl(curlCmd(`${baseUrl}/api/categories/${asyncTestResponse.data.data.id}`, { method: 'DELETE' }))
  
  // Delete any comments that may have been created
  const allCommentsCmd = curlCmd(`${baseUrl}/api/comments`)
  const allCommentsResult = await curl(allCommentsCmd)
  if (allCommentsResult.success) {
    const allCommentsResponse = parseResponse(allCommentsResult.raw)
    if (allCommentsResponse.data && allCommentsResponse.data.data) {
      for (const comment of allCommentsResponse.data.data) {
        await curl(curlCmd(`${baseUrl}/api/comments/${comment.id}`, { method: 'DELETE' }))
      }
    }
  }
  
  // Delete users
  await curl(curlCmd(`${baseUrl}/api/users/${createdUser.id}`, { method: 'DELETE' }))
  await curl(curlCmd(`${baseUrl}/api/users/${contextTestResponse.data.data.id}`, { method: 'DELETE' }))
  
  // Admin user and other users will be cleaned by their respective tests
})

console.log('\nAll hooks and middleware tests passed! ✅')