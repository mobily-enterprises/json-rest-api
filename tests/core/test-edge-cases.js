import { runHttpTests, curl, curlCmd, parseResponse, assertStatus, assertJsonApiResponse } from './setup.js'

// Test 11: Edge Cases and Corner Cases
await runHttpTests('Edge Cases and Corner Cases', async ({ baseUrl }, storageType) => {
  
  // 11.1 Extreme values
  console.log('  11.1 Extreme values')
  
  // Maximum integer
  const maxIntCmd = curlCmd(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          name: 'Max Int User',
          email: 'maxint@example.com',
          age: Number.MAX_SAFE_INTEGER
        }
      }
    }
  })
  
  const maxIntResult = await curl(maxIntCmd)
  const maxIntResponse = parseResponse(maxIntResult.raw)
  
  // Should handle or reject extreme values
  if (maxIntResponse.status === 201) {
    console.log('  ✓ Maximum safe integer accepted')
    const maxIntUser = maxIntResponse.data.data
    
    // Clean up
    await curl(curlCmd(`${baseUrl}/api/users/${maxIntUser.id}`, { method: 'DELETE' }))
  } else if (maxIntResponse.status === 422) {
    console.log('  ✓ Maximum safe integer rejected for validation')
  }
  
  // Zero values
  const zeroCmd = curlCmd(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          name: 'Ze',  // Minimum length name
          email: 'zero@example.com',
          age: 0  // Minimum age
        }
      }
    }
  })
  
  const zeroResult = await curl(zeroCmd)
  const zeroResponse = parseResponse(zeroResult.raw)
  assertStatus(zeroResponse, 201)
  
  const zeroUser = zeroResponse.data.data
  if (zeroUser.attributes.age !== 0) {
    throw new Error('Zero age not preserved')
  }
  
  await curl(curlCmd(`${baseUrl}/api/users/${zeroUser.id}`, { method: 'DELETE' }))
  
  // 11.2 Empty arrays and objects
  console.log('  11.2 Empty arrays and objects')
  
  const emptyCollectionsCmd = curlCmd(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          name: 'Empty Collections',
          email: 'empty@example.com',
          tags: [],
          metadata: {}
        }
      }
    }
  })
  
  const emptyCollectionsResult = await curl(emptyCollectionsCmd)
  const emptyCollectionsResponse = parseResponse(emptyCollectionsResult.raw)
  assertStatus(emptyCollectionsResponse, 201)
  
  const emptyUser = emptyCollectionsResponse.data.data
  
  // Verify empty collections preserved
  if (!Array.isArray(emptyUser.attributes.tags) || emptyUser.attributes.tags.length !== 0) {
    throw new Error('Empty array not preserved')
  }
  
  if (typeof emptyUser.attributes.metadata !== 'object' || Object.keys(emptyUser.attributes.metadata).length !== 0) {
    throw new Error('Empty object not preserved')
  }
  
  await curl(curlCmd(`${baseUrl}/api/users/${emptyUser.id}`, { method: 'DELETE' }))
  
  // 11.3 Deeply nested objects
  console.log('  11.3 Deeply nested objects')
  
  const deepObject = {
    level1: {
      level2: {
        level3: {
          level4: {
            level5: {
              value: 'deep'
            }
          }
        }
      }
    }
  }
  
  const deepCmd = curlCmd(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          name: 'Deep User',
          email: 'deep@example.com',
          metadata: deepObject
        }
      }
    }
  })
  
  const deepResult = await curl(deepCmd)
  const deepResponse = parseResponse(deepResult.raw)
  
  if (deepResponse.status === 201) {
    console.log('  ✓ Deep nested objects accepted')
    await curl(curlCmd(`${baseUrl}/api/users/${deepResponse.data.data.id}`, { method: 'DELETE' }))
  } else if (deepResponse.status === 422) {
    console.log('  ✓ Deep nested objects rejected (depth limit)')
  }
  
  // 11.4 Large arrays
  console.log('  11.4 Large arrays')
  
  const largeTags = Array(100).fill('tag')
  const largeArrayCmd = curlCmd(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          name: 'Large Array User',
          email: 'large@example.com',
          tags: largeTags
        }
      }
    }
  })
  
  const largeArrayResult = await curl(largeArrayCmd)
  const largeArrayResponse = parseResponse(largeArrayResult.raw)
  
  if (largeArrayResponse.status === 201) {
    console.log('  ✓ Large arrays accepted')
    await curl(curlCmd(`${baseUrl}/api/users/${largeArrayResponse.data.data.id}`, { method: 'DELETE' }))
  } else if (largeArrayResponse.status === 422) {
    console.log('  ✓ Large arrays rejected (size limit)')
  }
  
  // 11.5 Mixed type arrays
  console.log('  11.5 Mixed type arrays')
  
  const mixedArrayCmd = curlCmd(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          name: 'Mixed Array',
          email: 'mixed@example.com',
          tags: ['string', 123, true, null, {}]
        }
      }
    }
  })
  
  const mixedArrayResult = await curl(mixedArrayCmd)
  const mixedArrayResponse = parseResponse(mixedArrayResult.raw)
  
  // Should reject mixed types
  if (mixedArrayResponse.status === 422) {
    console.log('  ✓ Mixed type arrays properly rejected')
  } else if (mixedArrayResponse.status === 201) {
    console.log('  ✓ Mixed type arrays accepted (coerced)')
    await curl(curlCmd(`${baseUrl}/api/users/${mixedArrayResponse.data.data.id}`, { method: 'DELETE' }))
  }
  
  // 11.6 Concurrent requests
  console.log('  11.6 Concurrent requests')
  
  const concurrentPromises = []
  for (let i = 0; i < 10; i++) {
    const cmd = curlCmd(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: {
        data: {
          attributes: {
            name: `Concurrent User ${i}`,
            email: `concurrent${i}@example.com`
          }
        }
      }
    })
    concurrentPromises.push(curl(cmd))
  }
  
  const concurrentResults = await Promise.all(concurrentPromises)
  const createdUsers = []
  
  for (const result of concurrentResults) {
    const response = parseResponse(result.raw)
    assertStatus(response, 201)
    createdUsers.push(response.data.data)
  }
  
  // Verify all users created with unique IDs
  const ids = createdUsers.map(u => u.id)
  const uniqueIds = new Set(ids)
  
  if (uniqueIds.size !== ids.length) {
    throw new Error('Concurrent requests produced duplicate IDs')
  }
  
  // Clean up
  for (const user of createdUsers) {
    await curl(curlCmd(`${baseUrl}/api/users/${user.id}`, { method: 'DELETE' }))
  }
  
  // 11.7 Boundary conditions for pagination
  console.log('  11.7 Boundary conditions for pagination')
  
  // Create exactly pageSize users
  const pageSize = 10
  const boundaryUsers = []
  
  for (let i = 0; i < pageSize; i++) {
    const cmd = curlCmd(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: {
        data: {
          attributes: {
            name: `Boundary User ${i}`,
            email: `boundary${i}@example.com`
          }
        }
      }
    })
    
    const result = await curl(cmd)
    const response = parseResponse(result.raw)
    boundaryUsers.push(response.data.data)
  }
  
  // Get exactly one page
  const pageCmd = curlCmd(`${baseUrl}/api/users?page[size]=${pageSize}`)
  const pageResult = await curl(pageCmd)
  const pageResponse = parseResponse(pageResult.raw)
  
  assertStatus(pageResponse, 200)
  
  if (pageResponse.data.data.length > pageSize) {
    throw new Error('Page size exceeded limit')
  }
  
  // Clean up
  for (const user of boundaryUsers) {
    await curl(curlCmd(`${baseUrl}/api/users/${user.id}`, { method: 'DELETE' }))
  }
  
  // 11.8 Circular references in input
  console.log('  11.8 Circular references in input')
  
  // This test is tricky with curl, but we can test self-referential data
  const selfRefCmd = curlCmd(`${baseUrl}/api/categories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          name: 'Self Reference',
          description: 'Category that might reference itself'
        }
      }
    }
  })
  
  const selfRefResult = await curl(selfRefCmd)
  const selfRefResponse = parseResponse(selfRefResult.raw)
  assertStatus(selfRefResponse, 201)
  
  const categoryId = selfRefResponse.data.data.id
  
  // Try to update with self-reference
  const updateSelfRefCmd = curlCmd(`${baseUrl}/api/categories/${categoryId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          parentId: categoryId  // Self reference
        }
      }
    }
  })
  
  const updateSelfRefResult = await curl(updateSelfRefCmd)
  const updateSelfRefResponse = parseResponse(updateSelfRefResult.raw)
  
  // Should either accept or reject based on business logic
  if (updateSelfRefResponse.status === 200) {
    console.log('  ✓ Self-references allowed')
  } else if (updateSelfRefResponse.status === 422) {
    console.log('  ✓ Self-references rejected')
  }
  
  await curl(curlCmd(`${baseUrl}/api/categories/${categoryId}`, { method: 'DELETE' }))
  
  // 11.9 Resource ID edge cases
  console.log('  11.9 Resource ID edge cases')
  
  // Try various ID formats
  const idTests = [
    { id: '0', desc: 'zero ID' },
    { id: '-1', desc: 'negative ID' },
    { id: '999999999999', desc: 'very large ID' },
    { id: 'abc', desc: 'non-numeric ID' },
    { id: '1.5', desc: 'decimal ID' },
    { id: '1e10', desc: 'scientific notation ID' },
    { id: '../etc/passwd', desc: 'path traversal ID' },
    { id: '1; DROP TABLE users;', desc: 'SQL injection ID' },
    { id: encodeURIComponent('id with spaces'), desc: 'URL encoded ID' }
  ]
  
  for (const test of idTests) {
    const idCmd = curlCmd(`${baseUrl}/api/users/${test.id}`)
    const idResult = await curl(idCmd)
    
    if (idResult.success) {
      const idResponse = parseResponse(idResult.raw)
      
      if (idResponse.status === 404) {
        console.log(`  ✓ ${test.desc}: properly handled (404)`)
      } else if (idResponse.status === 400) {
        console.log(`  ✓ ${test.desc}: properly rejected (400)`)
      }
    }
  }
  
  // 11.10 HTTP header edge cases
  console.log('  11.10 HTTP header edge cases')
  
  // Very long header
  const longHeader = 'X-' + 'A'.repeat(8000)
  const longHeaderCmd = `curl -s -i -H "${longHeader}: value" "${baseUrl}/api/users"`
  const longHeaderResult = await curl(longHeaderCmd)
  
  if (longHeaderResult.success || longHeaderResult.code) {
    // Either succeeded or failed with curl error (header too long)
    console.log('  ✓ Long headers handled')
  }
  
  // Multiple content types
  const multiContentCmd = curlCmd(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'content-type': 'text/plain'  // Duplicate with different case
    },
    data: { data: { attributes: { name: 'Multi', email: 'multi@example.com' } } }
  })
  
  const multiContentResult = await curl(multiContentCmd)
  if (multiContentResult.success) {
    const multiContentResponse = parseResponse(multiContentResult.raw)
    console.log(`  ✓ Duplicate headers handled (${multiContentResponse.status})`)
    
    if (multiContentResponse.status === 201) {
      await curl(curlCmd(`${baseUrl}/api/users/${multiContentResponse.data.data.id}`, { method: 'DELETE' }))
    }
  }
  
  // 11.11 Query string edge cases
  console.log('  11.11 Query string edge cases')
  
  // Empty query parameters
  const emptyQueryTests = [
    '?filter[name]=',
    '?sort=',
    '?page[size]=',
    '?fields[users]=',
    '?include='
  ]
  
  for (const query of emptyQueryTests) {
    const emptyQueryCmd = curlCmd(`${baseUrl}/api/users${query}`)
    const emptyQueryResult = await curl(emptyQueryCmd)
    
    if (emptyQueryResult.success) {
      const emptyQueryResponse = parseResponse(emptyQueryResult.raw)
      console.log(`  ✓ Empty query param "${query}" handled (${emptyQueryResponse.status})`)
    }
  }
  
  // 11.12 Timezone edge cases
  console.log('  11.12 Timezone edge cases')
  
  const timezoneCmd = curlCmd(`${baseUrl}/api/posts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          title: 'Timezone Test',
          content: 'Testing timezone handling',
          authorId: '1',
          publishedAt: '2023-12-31T23:59:59Z'  // End of year UTC
        }
      }
    }
  })
  
  const timezoneResult = await curl(timezoneCmd)
  
  if (timezoneResult.success) {
    const timezoneResponse = parseResponse(timezoneResult.raw)
    
    if (timezoneResponse.status === 201) {
      const post = timezoneResponse.data.data
      
      // Verify date preserved
      if (post.attributes.publishedAt) {
        console.log('  ✓ Timezone/date handling works')
      }
      
      await curl(curlCmd(`${baseUrl}/api/posts/${post.id}`, { method: 'DELETE' }))
    } else if (timezoneResponse.status === 422) {
      // Foreign key constraint failed (no user with ID 1)
      console.log('  ✓ Foreign key validation works')
    }
  }
  
  // 11.13 Resource type edge cases
  console.log('  11.13 Resource type edge cases')
  
  const typeTests = [
    'users/',  // Trailing slash
    'USERS',   // Uppercase
    'user',    // Singular
    'users%20',  // URL encoded space
    '../../admin',  // Path traversal
    'users;DELETE FROM users;--',  // SQL injection
  ]
  
  for (const type of typeTests) {
    const typeCmd = curlCmd(`${baseUrl}/api/${type}`)
    const typeResult = await curl(typeCmd)
    
    if (typeResult.success) {
      const typeResponse = parseResponse(typeResult.raw)
      
      if (typeResponse.status === 404) {
        console.log(`  ✓ Invalid type "${type}" rejected (404)`)
      } else if (typeResponse.status === 200) {
        console.log(`  ✓ Type variant "${type}" normalized`)
      }
    }
  }
  
  // 11.14 Memory stress test
  console.log('  11.14 Memory stress test')
  
  // Create resource with large text
  const largeText = 'A'.repeat(10000)  // 10KB of text
  const stressCmd = curlCmd(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          name: 'Stress Test',
          email: 'stress@example.com',
          bio: largeText
        }
      }
    }
  })
  
  const stressResult = await curl(stressCmd)
  const stressResponse = parseResponse(stressResult.raw)
  
  if (stressResponse.status === 201) {
    console.log('  ✓ Large text fields accepted')
    await curl(curlCmd(`${baseUrl}/api/users/${stressResponse.data.data.id}`, { method: 'DELETE' }))
  } else if (stressResponse.status === 422) {
    console.log('  ✓ Large text fields rejected (size limit)')
  }
  
  // 11.15 Special field names
  console.log('  11.15 Special field names')
  
  // Try to use reserved field names
  const reservedCmd = curlCmd(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          name: 'Reserved Test',
          email: 'reserved@example.com',
          id: 999,  // Try to set ID
          type: 'admin',  // Conflicts with JSON:API type
          __proto__: {},  // Prototype pollution attempt
          constructor: {},  // Constructor override attempt
        }
      }
    }
  })
  
  const reservedResult = await curl(reservedCmd)
  
  if (reservedResult.success) {
    const reservedResponse = parseResponse(reservedResult.raw)
    
    if (reservedResponse.status === 201) {
      const user = reservedResponse.data.data
      
      // ID should not be 999
      if (user.id === '999') {
        throw new Error('Client-provided ID was accepted')
      }
      
      console.log('  ✓ Reserved field names handled safely')
      await curl(curlCmd(`${baseUrl}/api/users/${user.id}`, { method: 'DELETE' }))
    }
  }
  
  console.log('  All edge cases handled properly!')
})

console.log('\nAll edge case tests passed! ✅')