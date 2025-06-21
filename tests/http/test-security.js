import { runHttpTests, curl, curlCmd, parseResponse, assertStatus, wait } from './setup.js'

// Test 10: Security Features
await runHttpTests('Security Features', async ({ baseUrl, api }, storageType) => {
  
  // 10.1 SQL Injection Prevention
  console.log('  10.1 SQL Injection Prevention')
  
  // Try various SQL injection attempts
  const sqlInjectionTests = [
    { name: "Robert'; DROP TABLE users; --", email: 'bobby@tables.com' },
    { name: "Test' OR '1'='1", email: 'test@hack.com' },
    { name: "Test\"; DELETE FROM users WHERE \"1\"=\"1", email: 'test2@hack.com' },
    { name: "Test') UNION SELECT * FROM users --", email: 'test3@hack.com' }
  ]
  
  const createdUsers = []
  
  for (const userData of sqlInjectionTests) {
    const cmd = curlCmd(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: {
        data: {
          attributes: userData
        }
      }
    })
    
    const result = await curl(cmd)
    if (!result.success || !result.raw) {
      console.log(`    SQL injection test failed to execute: ${userData.name}`)
      continue
    }
    const response = parseResponse(result.raw)
    
    // Should either succeed (data properly escaped) or fail validation
    if (response.status === 201) {
      createdUsers.push(response.data.data)
      
      // Verify the data was stored correctly
      const getCmd = curlCmd(`${baseUrl}/api/users/${response.data.data.id}`)
      const getResult = await curl(getCmd)
      const getResponse = parseResponse(getResult.raw)
      
      if (getResponse.data.data.attributes.name !== userData.name) {
        throw new Error('SQL injection attempt corrupted data')
      }
    } else if (response.status !== 422) {
      throw new Error(`Unexpected status for SQL injection test: ${response.status}`)
    }
  }
  
  // Verify database is still intact
  const checkCmd = curlCmd(`${baseUrl}/api/users`)
  const checkResult = await curl(checkCmd)
  const checkResponse = parseResponse(checkResult.raw)
  assertStatus(checkResponse, 200)
  
  // 10.2 XSS Prevention
  console.log('  10.2 XSS Prevention')
  
  const xssTests = [
    '<script>alert("XSS")</script>',
    '<img src=x onerror=alert("XSS")>',
    'javascript:alert("XSS")',
    '<iframe src="javascript:alert(\'XSS\')"></iframe>',
    '"><script>alert(String.fromCharCode(88,83,83))</script>'
  ]
  
  for (const xssPayload of xssTests) {
    const cmd = curlCmd(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: {
        data: {
          attributes: {
            name: xssPayload,
            email: `xss${Date.now()}@test.com`
          }
        }
      }
    })
    
    const result = await curl(cmd)
    const response = parseResponse(result.raw)
    
    if (response.status === 201) {
      createdUsers.push(response.data.data)
      
      // Verify data is stored as-is (not executed)
      const user = response.data.data
      if (user.attributes.name !== xssPayload) {
        console.log(`    Warning: XSS payload was modified: ${xssPayload} -> ${user.attributes.name}`)
      }
    }
  }
  
  // 10.3 NoSQL Injection Prevention (for JSON fields)
  console.log('  10.3 NoSQL Injection Prevention')
  
  const noSqlTests = [
    { $where: 'this.password == null' },
    { $ne: null },
    { $gt: '' },
    { $regex: '.*' }
  ]
  
  for (const payload of noSqlTests) {
    const cmd = curlCmd(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: {
        data: {
          attributes: {
            name: 'NoSQL Test',
            email: `nosql${Date.now()}@test.com`,
            metadata: payload
          }
        }
      }
    })
    
    const result = await curl(cmd)
    const response = parseResponse(result.raw)
    
    if (response.status === 201) {
      createdUsers.push(response.data.data)
      
      // Verify payload was stored as data, not executed
      const user = response.data.data
      if (!user.attributes.metadata || typeof user.attributes.metadata !== 'object') {
        throw new Error('NoSQL injection payload was not stored correctly')
      }
    }
  }
  
  // 10.4 Password Field Protection
  console.log('  10.4 Password Field Protection')
  
  // Create user with password
  const passwordCmd = curlCmd(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          name: 'Password Test',
          email: 'password@test.com',
          password: 'supersecret123'
        }
      }
    }
  })
  
  const passwordResult = await curl(passwordCmd)
  const passwordResponse = parseResponse(passwordResult.raw)
  assertStatus(passwordResponse, 201)
  
  const passwordUser = passwordResponse.data.data
  createdUsers.push(passwordUser)
  
  // Password should not be in response
  if (passwordUser.attributes.password) {
    throw new Error('Password field exposed in create response')
  }
  
  // Get user - password should still not be exposed
  const getPasswordCmd = curlCmd(`${baseUrl}/api/users/${passwordUser.id}`)
  const getPasswordResult = await curl(getPasswordCmd)
  const getPasswordResponse = parseResponse(getPasswordResult.raw)
  
  if (getPasswordResponse.data.data.attributes.password) {
    throw new Error('Password field exposed in GET response')
  }
  
  // Query users - passwords should not be exposed
  const queryPasswordCmd = curlCmd(`${baseUrl}/api/users`)
  const queryPasswordResult = await curl(queryPasswordCmd)
  const queryPasswordResponse = parseResponse(queryPasswordResult.raw)
  
  const usersWithPasswords = queryPasswordResponse.data.data.filter(
    u => u.attributes.password !== undefined
  )
  
  if (usersWithPasswords.length > 0) {
    throw new Error('Password fields exposed in query response')
  }
  
  // 10.5 Input Size Limits
  console.log('  10.5 Input Size Limits')
  
  // Test very large string
  const largeString = 'x'.repeat(10000)
  const largeCmd = curlCmd(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          name: 'Large Test',
          email: 'large@test.com',
          bio: largeString // bio has max: 500
        }
      }
    }
  })
  
  const largeResult = await curl(largeCmd)
  const largeResponse = parseResponse(largeResult.raw)
  
  // Should fail validation
  if (largeResponse.status === 201) {
    throw new Error('Large input was not rejected')
  }
  
  assertStatus(largeResponse, 422)
  
  // 10.6 Request Rate Limiting (if implemented)
  console.log('  10.6 Request Rate Limiting')
  
  // Make many rapid requests
  const rapidRequests = []
  let rateLimited = false
  
  for (let i = 0; i < 20; i++) {
    rapidRequests.push(curl(curlCmd(`${baseUrl}/api/users`)))
  }
  
  const rapidResults = await Promise.all(rapidRequests)
  
  for (const result of rapidResults) {
    if (result.success) {
      const response = parseResponse(result.raw)
      if (response.status === 429) {
        rateLimited = true
        console.log('    Rate limiting is implemented')
        break
      }
    }
  }
  
  if (!rateLimited) {
    console.log('    Rate limiting not implemented (optional)')
  }
  
  // 10.7 HTTP Method Restrictions
  console.log('  10.7 HTTP Method Restrictions')
  
  // Try dangerous methods
  const dangerousMethods = ['TRACE', 'TRACK', 'CONNECT']
  
  for (const method of dangerousMethods) {
    const cmd = curlCmd(`${baseUrl}/api/users`, { method })
    const result = await curl(cmd)
    
    if (result.success) {
      const response = parseResponse(result.raw)
      if (response.status === 200 || response.status === 204) {
        console.log(`    Warning: ${method} method is allowed`)
      }
    }
  }
  
  // 10.8 Content Type Validation
  console.log('  10.8 Content Type Validation')
  
  // Try to POST with wrong content type
  const wrongTypeCmd = curlCmd(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    data: 'name=Test&email=test@test.com'
  })
  
  const wrongTypeResult = await curl(wrongTypeCmd)
  const wrongTypeResponse = parseResponse(wrongTypeResult.raw)
  
  // Should reject non-JSON content type
  if (wrongTypeResponse.status === 201) {
    throw new Error('Non-JSON content type was accepted')
  }
  
  // 10.9 ID Parameter Validation
  console.log('  10.9 ID Parameter Validation')
  
  // Try various invalid IDs
  const invalidIds = [
    '../../../etc/passwd',
    '"; DROP TABLE users; --',
    '<script>alert("XSS")</script>',
    '${7*7}',
    '{{7*7}}',
    'constructor.prototype.polluted=true'
  ]
  
  for (const id of invalidIds) {
    const cmd = curlCmd(`${baseUrl}/api/users/${encodeURIComponent(id)}`)
    const result = await curl(cmd)
    
    if (result.success) {
      const response = parseResponse(result.raw)
      // Should return 404 or 400, not 500
      if (response.status >= 500) {
        throw new Error(`Server error for invalid ID: ${id}`)
      }
    }
  }
  
  // 10.10 Query Parameter Pollution
  console.log('  10.10 Query Parameter Pollution')
  
  // Try parameter pollution
  const pollutionCmd = `curl -s -i "${baseUrl}/api/users?filter[role]=admin&filter[role]=user&filter[role][$ne]=null"`
  const pollutionResult = await curl(pollutionCmd)
  
  if (pollutionResult.success) {
    const pollutionResponse = parseResponse(pollutionResult.raw)
    // Should handle gracefully, not error
    if (pollutionResponse.status >= 500) {
      throw new Error('Parameter pollution caused server error')
    }
  }
  
  // 10.11 JSON Depth Limits
  console.log('  10.11 JSON Depth Limits')
  
  // Create deeply nested object
  let deepObject = {}
  let current = deepObject
  for (let i = 0; i < 100; i++) {
    current.nested = {}
    current = current.nested
  }
  current.value = 'deep'
  
  const deepCmd = curlCmd(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      data: {
        attributes: {
          name: 'Deep Test',
          email: 'deep@test.com',
          metadata: deepObject
        }
      }
    }
  })
  
  const deepResult = await curl(deepCmd)
  
  // Should either handle or reject gracefully
  if (deepResult.success) {
    const deepResponse = parseResponse(deepResult.raw)
    if (deepResponse.status >= 500) {
      throw new Error('Deep nesting caused server error')
    }
  }
  
  // 10.12 Authorization Header Injection
  console.log('  10.12 Authorization Header Injection')
  
  // Try header injection
  const headerInjectionCmd = curlCmd(`${baseUrl}/api/users`, {
    headers: {
      'Authorization': 'Bearer token\r\nX-Injected: true'
    }
  })
  
  const headerInjectionResult = await curl(headerInjectionCmd)
  
  if (headerInjectionResult.success) {
    const headerInjectionResponse = parseResponse(headerInjectionResult.raw)
    // Should handle gracefully
    if (headerInjectionResponse.status >= 500) {
      throw new Error('Header injection caused server error')
    }
  }
  
  // Cleanup
  console.log('  Cleaning up test data...')
  
  for (const user of createdUsers) {
    await curl(curlCmd(`${baseUrl}/api/users/${user.id}`, { method: 'DELETE' }))
  }
})

console.log('\nAll security tests passed! ✅')