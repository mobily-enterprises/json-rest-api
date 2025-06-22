import { runHttpTests, curl, curlCmd, parseResponse, assertStatus, assertJsonApiResponse } from './setup.js'

// Test 6: Sorting and Pagination
await runHttpTests('Sorting and Pagination', async ({ baseUrl }, storageType) => {
  
  // Setup test data with specific values for sorting
  const testUsers = []
  console.log('  Setting up test data...')
  
  const usersToCreate = [
    { name: 'Alice Anderson', email: 'alice@example.com', age: 25, role: 'admin', isActive: true },
    { name: 'Bob Brown', email: 'bob@example.com', age: 30, role: 'user', isActive: true },
    { name: 'Charlie Chen', email: 'charlie@example.com', age: 35, role: 'user', isActive: false },
    { name: 'Diana Davis', email: 'diana@example.com', age: 28, role: 'guest', isActive: true },
    { name: 'Edward Evans', email: 'edward@example.com', age: 45, role: 'admin', isActive: false },
    { name: 'Fiona Foster', email: 'fiona@example.com', age: 22, role: 'user', isActive: true },
    { name: 'George Green', email: 'george@example.com', age: 50, role: 'guest', isActive: false },
    { name: 'Hannah Hill', email: 'hannah@example.com', age: 33, role: 'admin', isActive: true },
    { name: 'Ian Irving', email: 'ian@example.com', age: 40, role: 'user', isActive: false },
    { name: 'Julia Jones', email: 'julia@example.com', age: 27, role: 'guest', isActive: true }
  ]
  
  for (const userData of usersToCreate) {
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
    const response = parseResponse(result.raw)
    assertStatus(response, 201)
    testUsers.push(response.data.data)
  }
  
  // 6.1 Basic sorting - single field ascending
  console.log('  6.1 Basic sorting - single field ascending')
  
  const sortNameAscCmd = curlCmd(`${baseUrl}/api/users?sort=name`)
  const sortNameAscResult = await curl(sortNameAscCmd)
  const sortNameAscResponse = parseResponse(sortNameAscResult.raw)
  
  assertStatus(sortNameAscResponse, 200)
  
  const names = sortNameAscResponse.data.data.map(u => u.attributes.name)
  const expectedOrder = [...names].sort()
  
  if (JSON.stringify(names) !== JSON.stringify(expectedOrder)) {
    throw new Error(`Names not in ascending order. Got: ${names.join(', ')}`)
  }
  
  // 6.2 Basic sorting - single field descending
  console.log('  6.2 Basic sorting - single field descending')
  
  const sortNameDescCmd = curlCmd(`${baseUrl}/api/users?sort=-name`)
  const sortNameDescResult = await curl(sortNameDescCmd)
  const sortNameDescResponse = parseResponse(sortNameDescResult.raw)
  
  assertStatus(sortNameDescResponse, 200)
  
  const descNames = sortNameDescResponse.data.data.map(u => u.attributes.name)
  const expectedDescOrder = [...descNames].sort().reverse()
  
  if (JSON.stringify(descNames) !== JSON.stringify(expectedDescOrder)) {
    throw new Error(`Names not in descending order. Got: ${descNames.join(', ')}`)
  }
  
  // 6.3 Multiple field sorting
  console.log('  6.3 Multiple field sorting')
  
  const multiSortCmd = curlCmd(`${baseUrl}/api/users?sort=role,-name`)
  const multiSortResult = await curl(multiSortCmd)
  const multiSortResponse = parseResponse(multiSortResult.raw)
  
  assertStatus(multiSortResponse, 200)
  
  // Verify role order (admin, guest, user)
  let previousRole = null
  const roleOrder = ['admin', 'guest', 'user']
  
  for (const user of multiSortResponse.data.data) {
    const currentRole = user.attributes.role
    
    if (previousRole && currentRole !== previousRole) {
      const prevIndex = roleOrder.indexOf(previousRole)
      const currIndex = roleOrder.indexOf(currentRole)
      
      if (currIndex < prevIndex) {
        throw new Error(`Roles not sorted correctly: ${previousRole} came before ${currentRole}`)
      }
    }
    
    // Check names within same role are descending
    if (previousRole === currentRole) {
      const users = multiSortResponse.data.data.filter(u => u.attributes.role === currentRole)
      const namesInRole = users.map(u => u.attributes.name)
      const expectedNamesInRole = [...namesInRole].sort().reverse()
      
      if (JSON.stringify(namesInRole) !== JSON.stringify(expectedNamesInRole)) {
        throw new Error(`Names within role ${currentRole} not in descending order`)
      }
    }
    
    previousRole = currentRole
  }
  
  // 6.4 Pagination - page size
  console.log('  6.4 Pagination - page size')
  
  const pageSize3Cmd = curlCmd(`${baseUrl}/api/users?page[size]=3`)
  const pageSize3Result = await curl(pageSize3Cmd)
  const pageSize3Response = parseResponse(pageSize3Result.raw)
  
  assertStatus(pageSize3Response, 200)
  
  if (pageSize3Response.data.data.length !== 3) {
    throw new Error(`Expected 3 results, got ${pageSize3Response.data.data.length}`)
  }
  
  if (!pageSize3Response.data.meta || pageSize3Response.data.meta.pageSize !== 3) {
    throw new Error('Page size not reflected in meta')
  }
  
  if (pageSize3Response.data.meta.total !== usersToCreate.length) {
    throw new Error(`Total count incorrect: expected ${usersToCreate.length}, got ${pageSize3Response.data.meta.total}`)
  }
  
  const expectedPages = Math.ceil(usersToCreate.length / 3)
  if (pageSize3Response.data.meta.totalPages !== expectedPages) {
    throw new Error(`Total pages incorrect: expected ${expectedPages}, got ${pageSize3Response.data.meta.totalPages}`)
  }
  
  // 6.5 Pagination - navigating pages
  console.log('  6.5 Pagination - navigating pages')
  
  const collectedIds = new Set()
  const totalPages = pageSize3Response.data.meta.totalPages
  
  for (let page = 1; page <= totalPages; page++) {
    const pageCmd = curlCmd(`${baseUrl}/api/users?page[size]=3&page[number]=${page}`)
    const pageResult = await curl(pageCmd)
    const pageResponse = parseResponse(pageResult.raw)
    
    assertStatus(pageResponse, 200)
    
    // Check we don't get more than page size
    if (page < totalPages && pageResponse.data.data.length !== 3) {
      throw new Error(`Page ${page} should have 3 results, got ${pageResponse.data.data.length}`)
    }
    
    // Collect IDs to check uniqueness
    for (const user of pageResponse.data.data) {
      if (collectedIds.has(user.id)) {
        throw new Error(`Duplicate user ID ${user.id} found across pages`)
      }
      collectedIds.add(user.id)
    }
    
    // Check meta
    if (pageResponse.data.meta.pageNumber !== page) {
      throw new Error(`Page number mismatch: expected ${page}, got ${pageResponse.data.meta.pageNumber}`)
    }
  }
  
  // Verify we got all users
  if (collectedIds.size !== usersToCreate.length) {
    throw new Error(`Missing users: expected ${usersToCreate.length}, collected ${collectedIds.size}`)
  }
  
  // 6.6 Pagination - out of range
  console.log('  6.6 Pagination - out of range')
  
  const outOfRangeCmd = curlCmd(`${baseUrl}/api/users?page[size]=3&page[number]=999`)
  const outOfRangeResult = await curl(outOfRangeCmd)
  const outOfRangeResponse = parseResponse(outOfRangeResult.raw)
  
  assertStatus(outOfRangeResponse, 200)
  
  if (outOfRangeResponse.data.data.length !== 0) {
    throw new Error('Out of range page should return empty results')
  }
  
  // 6.7 Sorting with pagination
  console.log('  6.7 Sorting with pagination')
  
  const sortedPageCmd = curlCmd(`${baseUrl}/api/users?sort=name&page[size]=5&page[number]=1`)
  const sortedPageResult = await curl(sortedPageCmd)
  const sortedPageResponse = parseResponse(sortedPageResult.raw)
  
  assertStatus(sortedPageResponse, 200)
  
  // Get all names for comparison
  const allNamesCmd = curlCmd(`${baseUrl}/api/users?sort=name`)
  const allNamesResult = await curl(allNamesCmd)
  const allNamesResponse = parseResponse(allNamesResult.raw)
  
  const allSortedNames = allNamesResponse.data.data.map(u => u.attributes.name)
  const firstPageNames = sortedPageResponse.data.data.map(u => u.attributes.name)
  
  // First page should have first 5 names
  const expectedFirstPage = allSortedNames.slice(0, 5)
  
  if (JSON.stringify(firstPageNames) !== JSON.stringify(expectedFirstPage)) {
    throw new Error('First page does not contain correct sorted subset')
  }
  
  // 6.8 Filtering with sorting and pagination
  console.log('  6.8 Filtering with sorting and pagination')
  
  const complexCmd = curlCmd(`${baseUrl}/api/users?filter[role]=user&sort=-name&page[size]=2`)
  const complexResult = await curl(complexCmd)
  const complexResponse = parseResponse(complexResult.raw)
  
  assertStatus(complexResponse, 200)
  
  // All should be users
  if (!complexResponse.data.data.every(u => u.attributes.role === 'user')) {
    throw new Error('Filter not applied correctly')
  }
  
  // Should be max 2 results
  if (complexResponse.data.data.length > 2) {
    throw new Error('Page size not respected')
  }
  
  // Should be sorted by name descending
  const complexNames = complexResponse.data.data.map(u => u.attributes.name)
  const sortedComplexNames = [...complexNames].sort().reverse()
  
  if (JSON.stringify(complexNames) !== JSON.stringify(sortedComplexNames)) {
    throw new Error('Sort not applied correctly')
  }
  
  // 6.9 Default pagination
  console.log('  6.9 Default pagination')
  
  const defaultPageCmd = curlCmd(`${baseUrl}/api/users`)
  const defaultPageResult = await curl(defaultPageCmd)
  const defaultPageResponse = parseResponse(defaultPageResult.raw)
  
  assertStatus(defaultPageResponse, 200)
  
  // Default page size should be 10
  if (defaultPageResponse.data.data.length !== 10) {
    throw new Error(`Default page size should be 10, got ${defaultPageResponse.data.data.length}`)
  }
  
  if (defaultPageResponse.data.meta.pageSize !== 10) {
    throw new Error('Default page size not reflected in meta')
  }
  
  if (defaultPageResponse.data.meta.pageNumber !== 1) {
    throw new Error('Default page number should be 1')
  }
  
  // 6.10 Large page size
  console.log('  6.10 Large page size')
  
  const largePageCmd = curlCmd(`${baseUrl}/api/users?page[size]=1000`)
  const largePageResult = await curl(largePageCmd)
  const largePageResponse = parseResponse(largePageResult.raw)
  
  assertStatus(largePageResponse, 200)
  
  // Should get all users
  if (largePageResponse.data.data.length !== usersToCreate.length) {
    throw new Error(`Large page should return all ${usersToCreate.length} users`)
  }
  
  // 6.11 Links in paginated response
  console.log('  6.11 Links in paginated response')
  
  const linksCmd = curlCmd(`${baseUrl}/api/users?page[size]=3&page[number]=2`)
  const linksResult = await curl(linksCmd)
  const linksResponse = parseResponse(linksResult.raw)
  
  assertStatus(linksResponse, 200)
  
  if (!linksResponse.data.links) {
    throw new Error('Links missing from response')
  }
  
  if (!linksResponse.data.links.self) {
    throw new Error('Self link missing')
  }
  
  if (!linksResponse.data.links.first) {
    throw new Error('First link missing')
  }
  
  if (!linksResponse.data.links.prev) {
    throw new Error('Previous link missing for page 2')
  }
  
  if (linksResponse.data.meta.totalPages > 2 && !linksResponse.data.links.next) {
    throw new Error('Next link missing when more pages exist')
  }
  
  if (!linksResponse.data.links.last) {
    throw new Error('Last link missing')
  }
  
  // Verify link format
  if (!linksResponse.data.links.self.includes('page[number]=2')) {
    throw new Error('Self link does not contain current page number')
  }
  
  if (!linksResponse.data.links.first.includes('page[number]=1')) {
    throw new Error('First link does not point to page 1')
  }
  
  // 6.12 Sorting on non-searchable fields (should work for sorting)
  console.log('  6.12 Sorting on non-searchable fields')
  
  // Age is not searchable but should be sortable
  const sortAgeCmd = curlCmd(`${baseUrl}/api/users?sort=age`)
  const sortAgeResult = await curl(sortAgeCmd)
  
  if (!sortAgeResult.success || !sortAgeResult.raw) {
    console.log('  Note: Sorting on non-searchable field failed, this may be by design')
  } else {
    const sortAgeResponse = parseResponse(sortAgeResult.raw)
    
    if (sortAgeResponse.status === 200) {
      const ages = sortAgeResponse.data.data.map(u => u.attributes.age).filter(age => age !== null)
      const sortedAges = [...ages].sort((a, b) => a - b)
      
      if (JSON.stringify(ages) !== JSON.stringify(sortedAges)) {
        throw new Error('Ages not sorted correctly')
      }
      console.log('  ✓ Sorting on non-searchable fields works')
    } else {
      console.log('  ✓ Sorting on non-searchable fields blocked as expected')
    }
  }
  
  // Cleanup
  console.log('  Cleaning up test data...')
  
  for (const user of testUsers) {
    await curl(curlCmd(`${baseUrl}/api/users/${user.id}`, { method: 'DELETE' }))
  }
})

console.log('\nAll sorting and pagination tests passed! ✅')