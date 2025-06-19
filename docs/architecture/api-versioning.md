
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
  const api = Api.find('users', 'latest');

  // Get specific version
  const apiV1 = Api.find('users', '1.0.0');

  // Get minimum version (2.0.0 or higher)
  const apiV2Plus = Api.find('users', '2.0.0');

  // Use it with the resource proxy
  const user = await api.resources.users.create({
    name: 'John',
    email: 'john@example.com'
  });

  3. Cross-API Communication

  APIs can access each other automatically with version compatibility:

  const ordersApi = createApi({
    name: 'orders',
    version: '1.0.0'
  });

  // Inside orders API, access users API from registry
  ordersApi.hook('afterInsert', async (context) => {
    // Get a compatible users API from the registry
    const usersApi = Api.find('users', '>=1.0.0');
    if (usersApi) {
      const user = await usersApi.resources.users.get(context.data.userId);
      // Use the user data...
    }
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

    const api = Api.find('products', minVersion);
    return api.resources.products.create(data);
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
  
  7. Registry Access
  
  The Api class provides a rich registry API:
  
  // Check if an API exists
  if (Api.registry.has('products', '2.0.0')) {
    const api = Api.registry.get('products', '2.0.0');
  }
  
  // Get all versions of an API
  const versions = Api.registry.versions('products');
  // ['2.0.0', '1.0.0']
  
  // List all registered APIs
  const allApis = Api.registry.list();
  // { products: ['2.0.0', '1.0.0'], users: ['1.0.0'] }