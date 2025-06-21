import { runHttpTests, curl, curlCmd, parseResponse, assertStatus, assertJsonApiResponse, assertHasHeader } from './setup.js'

// Test 1: Basic CRUD Operations
await runHttpTests('Basic CRUD Operations', async ({ baseUrl }, storageType) => {
  let userId, postId
  
  // 1.1 POST - Create user
  console.log('  1.1 POST - Create user')
  const createUserCmd = curlCmd(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          name: 'John Doe',
          email: 'john@example.com',
          age: 30,
          password: 'secret123',
          tags: ['developer', 'tester'],
          metadata: { location: 'NYC' }
        }
      }
    }
  })
  
  const createUserResult = await curl(createUserCmd)
  const createUserResponse = parseResponse(createUserResult.raw)
  
  assertStatus(createUserResponse, 201)
  assertJsonApiResponse(createUserResponse)
  assertHasHeader(createUserResponse, 'location')
  assertHasHeader(createUserResponse, 'content-type', 'application/json; charset=utf-8')
  
  if (!createUserResponse.data.data.id) {
    throw new Error('Created user has no ID')
  }
  
  userId = createUserResponse.data.data.id
  
  // Verify password is not returned (silent field)
  if (createUserResponse.data.data.attributes.password !== undefined) {
    throw new Error('Silent field (password) was returned')
  }
  
  // 1.2 GET - Retrieve single user
  console.log('  1.2 GET - Retrieve single user')
  const getUserCmd = curlCmd(`${baseUrl}/api/users/${userId}`)
  const getUserResult = await curl(getUserCmd)
  const getUserResponse = parseResponse(getUserResult.raw)
  
  assertStatus(getUserResponse, 200)
  assertJsonApiResponse(getUserResponse)
  
  if (getUserResponse.data.data.id !== String(userId)) {
    throw new Error(`Expected user ID ${userId}, got ${getUserResponse.data.data.id}`)
  }
  
  // 1.3 GET - List all users
  console.log('  1.3 GET - List all users')
  const listUsersCmd = curlCmd(`${baseUrl}/api/users`)
  const listUsersResult = await curl(listUsersCmd)
  const listUsersResponse = parseResponse(listUsersResult.raw)
  
  assertStatus(listUsersResponse, 200)
  assertJsonApiResponse(listUsersResponse)
  
  if (!Array.isArray(listUsersResponse.data.data)) {
    throw new Error('List response data is not an array')
  }
  
  if (!listUsersResponse.data.meta || typeof listUsersResponse.data.meta.total !== 'number') {
    throw new Error('List response missing meta.total')
  }
  
  // 1.4 PATCH - Update user
  console.log('  1.4 PATCH - Update user')
  const patchUserCmd = curlCmd(`${baseUrl}/api/users/${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          age: 31,
          bio: 'Software engineer'
        }
      }
    }
  })
  
  const patchUserResult = await curl(patchUserCmd)
  const patchUserResponse = parseResponse(patchUserResult.raw)
  
  assertStatus(patchUserResponse, 200)
  assertJsonApiResponse(patchUserResponse)
  
  if (patchUserResponse.data.data.attributes.age !== 31) {
    throw new Error('User age was not updated')
  }
  
  // Other fields should remain unchanged
  if (patchUserResponse.data.data.attributes.name !== 'John Doe') {
    throw new Error('Unchanged field was modified')
  }
  
  // 1.5 PUT - Replace user
  console.log('  1.5 PUT - Replace user')
  const putUserCmd = curlCmd(`${baseUrl}/api/users/${userId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          name: 'Jane Smith',
          email: 'jane@example.com',
          age: 25,
          password: 'newpass456'
        }
      }
    }
  })
  
  const putUserResult = await curl(putUserCmd)
  const putUserResponse = parseResponse(putUserResult.raw)
  
  assertStatus(putUserResponse, 200)
  assertJsonApiResponse(putUserResponse)
  
  // Verify complete replacement - bio should be null since it wasn't in the PUT request
  if (putUserResponse.data.data.attributes.bio !== null) {
    throw new Error(`PUT should set missing fields to null, but bio is: ${putUserResponse.data.data.attributes.bio}`)
  }
  
  // 1.6 POST - Create post with relationship
  console.log('  1.6 POST - Create post with relationship')
  const createPostCmd = curlCmd(`${baseUrl}/api/posts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          title: 'My First Post',
          content: 'This is the content of my first post',
          authorId: userId,
          status: 'published',
          tags: ['tech', 'javascript']
        }
      }
    }
  })
  
  const createPostResult = await curl(createPostCmd)
  const createPostResponse = parseResponse(createPostResult.raw)
  
  assertStatus(createPostResponse, 201)
  assertJsonApiResponse(createPostResponse)
  
  postId = createPostResponse.data.data.id
  
  // Check eager join worked - in JSON:API format, joined data is in included section
  console.log('  Post response:', JSON.stringify(createPostResponse.data.data.attributes, null, 2))
  
  // Check relationships section exists
  if (!createPostResponse.data.data.relationships || 
      !createPostResponse.data.data.relationships.author) {
    throw new Error('Author relationship missing in response')
  }
  
  // Check included section exists
  if (!createPostResponse.data.included || 
      !Array.isArray(createPostResponse.data.included) || 
      createPostResponse.data.included.length === 0) {
    throw new Error('Eager join failed - no included data')
  }
  
  // Find the author in included section
  const includedAuthor = createPostResponse.data.included.find(
    item => item.type === 'users' && item.id === String(userId)
  )
  
  if (!includedAuthor) {
    throw new Error('Author not found in included section')
  }
  
  if (!includedAuthor.attributes || 
      !includedAuthor.attributes.name || 
      !includedAuthor.attributes.email) {
    throw new Error('Author data incomplete in included section')
  }
  
  // With preserveId: true, authorId should still be the ID in attributes
  if (createPostResponse.data.data.attributes.authorId !== String(userId)) {
    throw new Error('authorId should be preserved as string ID')
  }
  
  // 1.7 DELETE - Delete post
  console.log('  1.7 DELETE - Delete post')
  const deletePostCmd = curlCmd(`${baseUrl}/api/posts/${postId}`, {
    method: 'DELETE'
  })
  
  const deletePostResult = await curl(deletePostCmd)
  const deletePostResponse = parseResponse(deletePostResult.raw)
  
  assertStatus(deletePostResponse, 204)
  
  if (deletePostResponse.body) {
    throw new Error('DELETE should return no content')
  }
  
  // Verify deletion
  const getDeletedCmd = curlCmd(`${baseUrl}/api/posts/${postId}`)
  const getDeletedResult = await curl(getDeletedCmd)
  const getDeletedResponse = parseResponse(getDeletedResult.raw)
  
  assertStatus(getDeletedResponse, 404)
  
  // 1.8 DELETE - Delete user
  console.log('  1.8 DELETE - Delete user')
  const deleteUserCmd = curlCmd(`${baseUrl}/api/users/${userId}`, {
    method: 'DELETE'
  })
  
  const deleteUserResult = await curl(deleteUserCmd)
  const deleteUserResponse = parseResponse(deleteUserResult.raw)
  
  assertStatus(deleteUserResponse, 204)
})

// Test 2: HTTP Methods and Headers
await runHttpTests('HTTP Methods and Headers', async ({ baseUrl }) => {
  
  // 2.1 OPTIONS - Check allowed methods
  console.log('  2.1 OPTIONS - Check allowed methods')
  const optionsCmd = curlCmd(`${baseUrl}/api/users`, {
    method: 'OPTIONS'
  })
  
  const optionsResult = await curl(optionsCmd)
  const optionsResponse = parseResponse(optionsResult.raw)
  
  assertStatus(optionsResponse, 204)
  assertHasHeader(optionsResponse, 'access-control-allow-methods')
  
  const allowedMethods = optionsResponse.headers['access-control-allow-methods']
  const expectedMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
  for (const method of expectedMethods) {
    if (!allowedMethods.includes(method)) {
      throw new Error(`Expected method ${method} not in allowed methods`)
    }
  }
  
  // 2.2 HEAD - Check resource exists
  console.log('  2.2 HEAD - Check resource exists')
  const headCmd = curlCmd(`${baseUrl}/api/users`, {
    method: 'HEAD'
  })
  
  const headResult = await curl(headCmd)
  
  if (!headResult.success || !headResult.raw) {
    throw new Error(`HEAD request failed: ${headResult.error || 'No response'}`)
  }
  
  const headResponse = parseResponse(headResult.raw)
  
  // HEAD should return 200 for existing collection
  assertStatus(headResponse, 200)
  
  if (headResponse.body) {
    throw new Error('HEAD request should not return body')
  }
  
  // 2.3 Unsupported method
  console.log('  2.3 Unsupported method')
  const traceCmd = curlCmd(`${baseUrl}/api/users`, {
    method: 'TRACE'
  })
  
  const traceResult = await curl(traceCmd)
  if (traceResult.success) {
    const traceResponse = parseResponse(traceResult.raw)
    assertStatus(traceResponse, 404) // Express returns 404 for undefined routes
  }
  
  // 2.4 Content-Type validation
  console.log('  2.4 Content-Type validation')
  const wrongContentTypeCmd = curlCmd(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    data: 'not json'
  })
  
  const wrongContentTypeResult = await curl(wrongContentTypeCmd)
  const wrongContentTypeResponse = parseResponse(wrongContentTypeResult.raw)
  
  // Should reject non-JSON content type for POST
  if (wrongContentTypeResponse.status === 201) {
    throw new Error('Should not accept non-JSON content type')
  }
  
  // 2.5 Accept header
  console.log('  2.5 Accept header')
  const acceptCmd = curlCmd(`${baseUrl}/api/users`, {
    headers: { 'Accept': 'application/json' }
  })
  
  const acceptResult = await curl(acceptCmd)
  const acceptResponse = parseResponse(acceptResult.raw)
  
  assertStatus(acceptResponse, 200)
  assertHasHeader(acceptResponse, 'content-type', 'application/json; charset=utf-8')
})

// Test 3: Edge Cases and Boundaries
await runHttpTests('Edge Cases and Boundaries', async ({ baseUrl }) => {
  
  // 3.1 Empty POST
  console.log('  3.1 Empty POST')
  const emptyPostCmd = curlCmd(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {}
  })
  
  const emptyPostResult = await curl(emptyPostCmd)
  const emptyPostResponse = parseResponse(emptyPostResult.raw)
  
  // Should handle gracefully (likely validation error)
  if (emptyPostResponse.status === 201) {
    throw new Error('Should not create user with empty data')
  }
  
  // 3.2 Null values - test that null is rejected for non-nullable fields
  console.log('  3.2 Null values for non-nullable fields')
  const nullCmd = curlCmd(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          name: 'Test User',
          email: 'test@example.com',
          age: null,  // This should fail validation
          bio: null   // This should fail validation
        }
      }
    }
  })
  
  const nullResult = await curl(nullCmd)
  const nullResponse = parseResponse(nullResult.raw)
  
  // Should reject null for non-nullable fields
  assertStatus(nullResponse, 422)
  
  // 3.2b Null values for optional fields (omitted is ok)
  console.log('  3.2b Omitted optional fields')
  const omittedCmd = curlCmd(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          name: 'Test User',
          email: 'test@example.com'
          // age and bio omitted - should be fine
        }
      }
    }
  })
  
  const omittedResult = await curl(omittedCmd)
  const omittedResponse = parseResponse(omittedResult.raw)
  
  assertStatus(omittedResponse, 201)
  const nullTestId = omittedResponse.data.data.id
  
  // Cleanup
  await curl(curlCmd(`${baseUrl}/api/users/${nullTestId}`, { method: 'DELETE' }))
  
  // 3.3 Unicode and special characters
  console.log('  3.3 Unicode and special characters')
  const unicodeCmd = curlCmd(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          name: '测试用户 🎉',
          email: 'unicode@example.com',
          bio: 'Hello "world" with \'quotes\' and \nnewlines'
        }
      }
    }
  })
  
  const unicodeResult = await curl(unicodeCmd)
  const unicodeResponse = parseResponse(unicodeResult.raw)
  
  assertStatus(unicodeResponse, 201)
  
  const unicodeId = unicodeResponse.data.data.id
  
  // Verify unicode preserved
  const getUnicodeCmd = curlCmd(`${baseUrl}/api/users/${unicodeId}`)
  const getUnicodeResult = await curl(getUnicodeCmd)
  const getUnicodeResponse = parseResponse(getUnicodeResult.raw)
  
  if (getUnicodeResponse.data.data.attributes.name !== '测试用户 🎉') {
    throw new Error('Unicode not preserved')
  }
  
  // Cleanup
  await curl(curlCmd(`${baseUrl}/api/users/${unicodeId}`, { method: 'DELETE' }))
  
  // 3.4 Very long strings
  console.log('  3.4 Very long strings')
  const longString = 'a'.repeat(1000)
  const longCmd = curlCmd(`${baseUrl}/api/users`, {
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          name: 'Long Bio User',
          email: 'long@example.com',
          bio: longString
        }
      }
    }
  })
  
  const longResult = await curl(longCmd)
  const longResponse = parseResponse(longResult.raw)
  
  // Should fail validation (bio max is 500)
  if (longResponse.status === 201) {
    throw new Error('Should not accept bio longer than 500 chars')
  }
  
  // 3.5 Invalid JSON
  console.log('  3.5 Invalid JSON')
  const invalidJsonCmd = `curl -s -i -X POST -H "Content-Type: application/json" -d '{"invalid": json}' "${baseUrl}/api/users"`
  
  const invalidJsonResult = await curl(invalidJsonCmd)
  const invalidJsonResponse = parseResponse(invalidJsonResult.raw)
  
  if (invalidJsonResponse.status === 201) {
    throw new Error('Should not accept invalid JSON')
  }
  
  // 3.6 Non-existent resource
  console.log('  3.6 Non-existent resource')
  const notFoundCmd = curlCmd(`${baseUrl}/api/users/999999`)
  const notFoundResult = await curl(notFoundCmd)
  const notFoundResponse = parseResponse(notFoundResult.raw)
  
  assertStatus(notFoundResponse, 404)
  
  // 3.7 Non-existent endpoint
  console.log('  3.7 Non-existent endpoint')
  const noEndpointCmd = curlCmd(`${baseUrl}/api/nonexistent`)
  const noEndpointResult = await curl(noEndpointCmd)
  const noEndpointResponse = parseResponse(noEndpointResult.raw)
  
  assertStatus(noEndpointResponse, 404)
})

console.log('\nAll CRUD tests passed! ✅')