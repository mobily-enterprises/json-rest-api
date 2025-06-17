
  1. Creating Versioned APIs

  // Just specify name and version - that's it!
  const userApi = createApi({
    name: 'users',
    version: '1.0.0',
    storage: 'memory'
  });

  // Create a new version
  const userApiV2 = createApi({
    name: 'users',
    version: '2.0.0',
    storage: 'memory'
  });

  2. Using APIs Programmatically

  // Get latest version automatically
  const api = Api.get('users', 'latest');

  // Get specific version
  const apiV1 = Api.get('users', '1.0.0');

  // Get minimum version (2.0.0 or higher)
  const apiV2Plus = Api.get('users', '2.0.0');

  // Use it
  const user = await api.insert({
    name: 'John',
    email: 'john@example.com'
  }, { type: 'users' });

  3. Cross-API Communication

  APIs can access each other automatically with version compatibility:

  const ordersApi = createApi({
    name: 'orders',
    version: '1.0.0'
  });

  // Inside orders API, access users API automatically
  ordersApi.hook('afterInsert', async (context) => {
    // This gets a compatible users API automatically!
    const usersApi = ordersApi.apis.users;
    const user = await usersApi.get(context.data.userId, { type: 'users'
  });
  });

  4. HTTP Version Negotiation

  The library handles all HTTP version routing automatically:

  // Mount APIs - versioning is automatic
  userApiV1.mount(app);   // Available at /api/1.0.0/users
  userApiV2.mount(app);   // Available at /api/2.0.0/users

  // Clients can request versions:
  // Via header
  fetch('/api/users', {
    headers: { 'API-Version': '2.0.0' }
  });

  // Via query
  fetch('/api/users?v=2.0.0');

  // Via path
  fetch('/api/2.0.0/users');

  5. Version Resolution Rules

  The library automatically finds the right version:

  - 'latest' → Newest version
  - '2.0.0' → Exactly 2.0.0 OR the newest version ≥ 2.0.0
  - '^2.0.0' → Any 2.x.x version (npm style)
  - '~2.1.0' → Any 2.1.x version (npm style)
  - '>=2.0.0' → Any version ≥ 2.0.0

  6. Complete Working Example

  // Define v1
  const apiV1 = createApi({
    name: 'products',
    version: '1.0.0',
    storage: 'memory'
  });

  apiV1.addResource('products', new Schema({
    id: { type: 'id' },
    name: { type: 'string', required: true },
    price: { type: 'number', required: true }
  }));

  // Define v2 with new field
  const apiV2 = createApi({
    name: 'products',
    version: '2.0.0',
    storage: 'memory'
  });

  apiV2.addResource('products', new Schema({
    id: { type: 'id' },
    name: { type: 'string', required: true },
    price: { type: 'number', required: true },
    category: { type: 'string', required: true }  // New!
  }));

  // Use programmatically - version selection is automatic
  async function createProduct(data) {
    // Automatically picks the right version based on data
    const hasCategory = 'category' in data;
    const minVersion = hasCategory ? '2.0.0' : '1.0.0';

    const api = Api.get('products', minVersion);
    return api.insert(data, { type: 'products' });
  }

  // Works with v1
  await createProduct({
    name: 'Widget',
    price: 9.99
  });

  // Automatically uses v2
  await createProduct({
    name: 'Gadget',
    price: 19.99,
    category: 'Electronics'
  });

  The library handles all the complexity - you just specify name and
  version when creating APIs, and the library does the rest!