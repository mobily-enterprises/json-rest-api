import { runHttpTests, curl, curlCmd, parseResponse, assertStatus, assertJsonApiResponse } from './setup.js'

// Test 4: Field Validation and Schema Compliance
await runHttpTests('Field Validation and Schema Compliance', async ({ baseUrl }, storageType) => {
  
  // 4.1 Required fields
  console.log('  4.1 Required fields validation')
  
  // Missing required field 'name'
  const missingNameCmd = curlCmd(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          email: 'test@example.com'
        }
      }
    }
  })
  
  const missingNameResult = await curl(missingNameCmd)
  const missingNameResponse = parseResponse(missingNameResult.raw)
  
  assertStatus(missingNameResponse, 422)
  if (!missingNameResponse.data.errors || !missingNameResponse.data.errors.some(e => e.meta?.field === 'name')) {
    throw new Error('Expected validation error for missing name field')
  }
  
  // Missing required field 'email'
  const missingEmailCmd = curlCmd(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          name: 'Test User'
        }
      }
    }
  })
  
  const missingEmailResult = await curl(missingEmailCmd)
  const missingEmailResponse = parseResponse(missingEmailResult.raw)
  
  assertStatus(missingEmailResponse, 422)
  if (!missingEmailResponse.data.errors || !missingEmailResponse.data.errors.some(e => e.meta?.field === 'email')) {
    throw new Error('Expected validation error for missing email field')
  }
  
  // 4.2 Field type validation
  console.log('  4.2 Field type validation')
  
  // Invalid type for age (string instead of number)
  const invalidAgeCmd = curlCmd(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          name: 'Test User',
          email: 'test@example.com',
          age: 'twenty-five'
        }
      }
    }
  })
  
  const invalidAgeResult = await curl(invalidAgeCmd)
  const invalidAgeResponse = parseResponse(invalidAgeResult.raw)
  
  assertStatus(invalidAgeResponse, 422)
  if (!invalidAgeResponse.data.errors || !invalidAgeResponse.data.errors.some(e => e.meta?.field === 'age')) {
    throw new Error('Expected validation error for invalid age type')
  }
  
  // Invalid type for boolean
  const invalidBoolCmd = curlCmd(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          name: 'Test User',
          email: 'test@example.com',
          isActive: 'yes' // Should be boolean
        }
      }
    }
  })
  
  const invalidBoolResult = await curl(invalidBoolCmd)
  const invalidBoolResponse = parseResponse(invalidBoolResult.raw)
  
  assertStatus(invalidBoolResponse, 422)
  
  // 4.3 String length validation
  console.log('  4.3 String length validation')
  
  // Name too short (min: 2)
  const shortNameCmd = curlCmd(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          name: 'A',
          email: 'test@example.com'
        }
      }
    }
  })
  
  const shortNameResult = await curl(shortNameCmd)
  const shortNameResponse = parseResponse(shortNameResult.raw)
  
  assertStatus(shortNameResponse, 422)
  
  // Name too long (max: 50)
  const longNameCmd = curlCmd(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          name: 'A'.repeat(51),
          email: 'test@example.com'
        }
      }
    }
  })
  
  const longNameResult = await curl(longNameCmd)
  const longNameResponse = parseResponse(longNameResult.raw)
  
  assertStatus(longNameResponse, 422)
  
  // 4.4 Number range validation
  console.log('  4.4 Number range validation')
  
  // Age below minimum (min: 0)
  const negativeAgeCmd = curlCmd(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          name: 'Test User',
          email: 'test@example.com',
          age: -1
        }
      }
    }
  })
  
  const negativeAgeResult = await curl(negativeAgeCmd)
  const negativeAgeResponse = parseResponse(negativeAgeResult.raw)
  
  assertStatus(negativeAgeResponse, 422)
  
  // Age above maximum (max: 150)
  const oldAgeCmd = curlCmd(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          name: 'Test User',
          email: 'test@example.com',
          age: 151
        }
      }
    }
  })
  
  const oldAgeResult = await curl(oldAgeCmd)
  const oldAgeResponse = parseResponse(oldAgeResult.raw)
  
  assertStatus(oldAgeResponse, 422)
  
  // 4.5 Email format validation
  console.log('  4.5 Email format validation')
  
  // Invalid email formats
  const invalidEmails = [
    'notanemail',
    '@example.com',
    'user@',
    'user@.com',
    'user@example',
    'user @example.com',
    'user@exam ple.com'
  ]
  
  for (const email of invalidEmails) {
    const invalidEmailCmd = curlCmd(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: {
        data: {
          attributes: {
            name: 'Test User',
            email: email
          }
        }
      }
    })
    
    const result = await curl(invalidEmailCmd)
    const response = parseResponse(result.raw)
    
    if (response.status !== 422) {
      throw new Error(`Expected 422 for invalid email '${email}', got ${response.status}`)
    }
  }
  
  // Valid email should work
  const validEmailCmd = curlCmd(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          name: 'Valid Email User',
          email: 'valid.email+tag@example.co.uk'
        }
      }
    }
  })
  
  const validEmailResult = await curl(validEmailCmd)
  const validEmailResponse = parseResponse(validEmailResult.raw)
  
  assertStatus(validEmailResponse, 201)
  const validEmailId = validEmailResponse.data.data.id
  
  // Cleanup
  await curl(curlCmd(`${baseUrl}/api/users/${validEmailId}`, { method: 'DELETE' }))
  
  // 4.6 Enum validation
  console.log('  4.6 Enum validation')
  
  // Invalid role (not in enum)
  const invalidRoleCmd = curlCmd(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          name: 'Test User',
          email: 'test@example.com',
          role: 'superadmin' // Not in ['admin', 'user', 'guest']
        }
      }
    }
  })
  
  const invalidRoleResult = await curl(invalidRoleCmd)
  const invalidRoleResponse = parseResponse(invalidRoleResult.raw)
  
  assertStatus(invalidRoleResponse, 422)
  
  // Valid enum values
  const validRoles = ['admin', 'user', 'guest']
  for (const role of validRoles) {
    const validRoleCmd = curlCmd(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: {
        data: {
          attributes: {
            name: `${role} User`,
            email: `${role}@example.com`,
            role: role
          }
        }
      }
    })
    
    const result = await curl(validRoleCmd)
    const response = parseResponse(result.raw)
    
    assertStatus(response, 201)
    const id = response.data.data.id
    
    // Cleanup
    await curl(curlCmd(`${baseUrl}/api/users/${id}`, { method: 'DELETE' }))
  }
  
  // 4.7 Array validation
  console.log('  4.7 Array validation')
  
  // Invalid array (not an array)
  const notArrayCmd = curlCmd(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          name: 'Test User',
          email: 'test@example.com',
          tags: 'not-an-array'
        }
      }
    }
  })
  
  const notArrayResult = await curl(notArrayCmd)
  const notArrayResponse = parseResponse(notArrayResult.raw)
  
  assertStatus(notArrayResponse, 422)
  
  // Valid array
  const validArrayCmd = curlCmd(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          name: 'Array User',
          email: 'array@example.com',
          tags: ['tag1', 'tag2', 'tag3']
        }
      }
    }
  })
  
  const validArrayResult = await curl(validArrayCmd)
  const validArrayResponse = parseResponse(validArrayResult.raw)
  
  assertStatus(validArrayResponse, 201)
  const arrayUserId = validArrayResponse.data.data.id
  
  // Verify array was stored correctly
  const getArrayCmd = curlCmd(`${baseUrl}/api/users/${arrayUserId}`)
  const getArrayResult = await curl(getArrayCmd)
  const getArrayResponse = parseResponse(getArrayResult.raw)
  
  if (!Array.isArray(getArrayResponse.data.data.attributes.tags)) {
    throw new Error('Tags should be an array')
  }
  
  // Cleanup
  await curl(curlCmd(`${baseUrl}/api/users/${arrayUserId}`, { method: 'DELETE' }))
  
  // 4.8 Object validation
  console.log('  4.8 Object validation')
  
  // Invalid object (not an object)
  const notObjectCmd = curlCmd(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          name: 'Test User',
          email: 'test@example.com',
          metadata: 'not-an-object'
        }
      }
    }
  })
  
  const notObjectResult = await curl(notObjectCmd)
  const notObjectResponse = parseResponse(notObjectResult.raw)
  
  assertStatus(notObjectResponse, 422)
  
  // Valid object
  const validObjectCmd = curlCmd(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          name: 'Object User',
          email: 'object@example.com',
          metadata: {
            location: 'NYC',
            preferences: {
              theme: 'dark',
              language: 'en'
            }
          }
        }
      }
    }
  })
  
  const validObjectResult = await curl(validObjectCmd)
  const validObjectResponse = parseResponse(validObjectResult.raw)
  
  assertStatus(validObjectResponse, 201)
  const objectUserId = validObjectResponse.data.data.id
  
  // Verify object was stored correctly
  const getObjectCmd = curlCmd(`${baseUrl}/api/users/${objectUserId}`)
  const getObjectResult = await curl(getObjectCmd)
  const getObjectResponse = parseResponse(getObjectResult.raw)
  
  if (typeof getObjectResponse.data.data.attributes.metadata !== 'object') {
    throw new Error('Metadata should be an object')
  }
  
  // Cleanup
  await curl(curlCmd(`${baseUrl}/api/users/${objectUserId}`, { method: 'DELETE' }))
  
  // 4.9 Default values
  console.log('  4.9 Default values')
  
  // Create user without optional fields that have defaults
  const defaultsCmd = curlCmd(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          name: 'Default User',
          email: 'default@example.com'
          // isActive should default to true
          // role should default to 'user'
        }
      }
    }
  })
  
  const defaultsResult = await curl(defaultsCmd)
  const defaultsResponse = parseResponse(defaultsResult.raw)
  
  assertStatus(defaultsResponse, 201)
  const defaultUserId = defaultsResponse.data.data.id
  
  // Verify defaults were applied
  if (defaultsResponse.data.data.attributes.isActive !== true) {
    throw new Error('isActive should default to true')
  }
  
  if (defaultsResponse.data.data.attributes.role !== 'user') {
    throw new Error('role should default to "user"')
  }
  
  // Cleanup
  await curl(curlCmd(`${baseUrl}/api/users/${defaultUserId}`, { method: 'DELETE' }))
  
  // 4.10 Silent fields (password)
  console.log('  4.10 Silent fields')
  
  // Create user with password
  const passwordCmd = curlCmd(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          name: 'Password User',
          email: 'password@example.com',
          password: 'secret123'
        }
      }
    }
  })
  
  const passwordResult = await curl(passwordCmd)
  const passwordResponse = parseResponse(passwordResult.raw)
  
  assertStatus(passwordResponse, 201)
  const passwordUserId = passwordResponse.data.data.id
  
  // Password should not be returned
  if (passwordResponse.data.data.attributes.password !== undefined) {
    throw new Error('Password should not be returned (silent field)')
  }
  
  // Get user - password still shouldn't be returned
  const getPasswordCmd = curlCmd(`${baseUrl}/api/users/${passwordUserId}`)
  const getPasswordResult = await curl(getPasswordCmd)
  const getPasswordResponse = parseResponse(getPasswordResult.raw)
  
  if (getPasswordResponse.data.data.attributes.password !== undefined) {
    throw new Error('Password should not be returned on GET (silent field)')
  }
  
  // Cleanup
  await curl(curlCmd(`${baseUrl}/api/users/${passwordUserId}`, { method: 'DELETE' }))
  
  // 4.11 Datetime validation
  console.log('  4.11 Datetime validation')
  
  // Create post with invalid datetime
  const invalidDateCmd = curlCmd(`${baseUrl}/api/posts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          title: 'Test Post',
          content: 'Test content',
          authorId: '1', // Assuming user 1 exists from previous tests
          publishedAt: 'not-a-date'
        }
      }
    }
  })
  
  const invalidDateResult = await curl(invalidDateCmd)
  const invalidDateResponse = parseResponse(invalidDateResult.raw)
  
  assertStatus(invalidDateResponse, 422)
  
  // Valid datetime formats
  const validDateFormats = [
    '2024-01-01T12:00:00Z',
    '2024-01-01T12:00:00.000Z',
    '2024-01-01T12:00:00+00:00',
    new Date().toISOString()
  ]
  
  for (const dateFormat of validDateFormats) {
    const validDateCmd = curlCmd(`${baseUrl}/api/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: {
        data: {
          attributes: {
            title: 'Date Test Post',
            content: 'Testing date format',
            authorId: '1',
            publishedAt: dateFormat
          }
        }
      }
    })
    
    const result = await curl(validDateCmd)
    const response = parseResponse(result.raw)
    
    // If no user exists, create one first
    if (response.status === 422 && response.data.errors?.some(e => e.meta?.field === 'authorId')) {
      // Create a test user first
      const createUserCmd = curlCmd(`${baseUrl}/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        data: {
          data: {
            attributes: {
              name: 'Test Author',
              email: 'author@example.com'
            }
          }
        }
      })
      
      const userResult = await curl(createUserCmd)
      const userResponse = parseResponse(userResult.raw)
      const userId = userResponse.data.data.id
      
      // Retry with valid user ID
      const retryCmd = curlCmd(`${baseUrl}/api/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        data: {
          data: {
            attributes: {
              title: 'Date Test Post',
              content: 'Testing date format',
              authorId: userId,
              publishedAt: dateFormat
            }
          }
        }
      })
      
      const retryResult = await curl(retryCmd)
      const retryResponse = parseResponse(retryResult.raw)
      
      assertStatus(retryResponse, 201)
      
      // Cleanup
      await curl(curlCmd(`${baseUrl}/api/posts/${retryResponse.data.data.id}`, { method: 'DELETE' }))
      await curl(curlCmd(`${baseUrl}/api/users/${userId}`, { method: 'DELETE' }))
      break // Only need to test once with valid user
    } else if (response.status === 201) {
      // Cleanup
      await curl(curlCmd(`${baseUrl}/api/posts/${response.data.data.id}`, { method: 'DELETE' }))
    } else {
      throw new Error(`Unexpected response for valid date format ${dateFormat}: ${response.status}`)
    }
  }
})

console.log('\nAll validation tests passed! ✅')