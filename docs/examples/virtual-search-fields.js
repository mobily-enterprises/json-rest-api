/**
 * Virtual Search Fields Example
 * 
 * Shows how to implement flexible search fields that don't map to database columns
 */

import { createApi, Schema } from '../../index.js';

// Create API
const api = createApi({
  storage: 'memory', // Using memory for demo
  http: { basePath: '/api' }
});

// Define schemas
const productSchema = new Schema({
  id: { type: 'id' },
  name: { type: 'string', required: true, searchable: true },
  description: { type: 'string' },
  category: { type: 'string', searchable: true },
  tags: { type: 'array' },
  price: { type: 'number', searchable: true },
  sku: { type: 'string', searchable: true },
  inStock: { type: 'boolean', searchable: true }
});

const messageSchema = new Schema({
  id: { type: 'id' },
  subject: { type: 'string', required: true, searchable: true },
  body: { type: 'string' },
  from: { type: 'string', searchable: true },
  to: { type: 'array' },
  folder: { type: 'string', searchable: true },
  hasAttachment: { type: 'boolean' },
  createdAt: { type: 'timestamp', default: () => Date.now() }
});

// Register resources with virtual search fields
api.addResource('products', productSchema, {
  searchableFields: {
    // Regular searchable fields (already in schema)
    name: 'name',
    category: 'category',
    
    // Virtual search fields
    search: '*',        // Simple multi-field search
    q: '*',            // Alias for search
    barcode: '*'       // Custom barcode search logic
  }
});

api.addResource('messages', messageSchema, {
  searchableFields: {
    // Regular fields
    from: 'from',
    folder: 'folder',
    
    // Virtual fields for advanced search
    search: '*',       // Multi-field search
    smart: '*',        // Advanced syntax (in:inbox, from:john, etc)
    conversation: '*'  // Thread-based search
  }
});

// ============================================================
// PATTERN 1: Simple Multi-Field Search
// ============================================================

api.hook('modifyQuery', async (context) => {
  const { filter } = context.params || {};
  if (!filter) return;
  
  // Product search
  if (context.options.type === 'products') {
    // Handle 'search' or 'q' parameter
    const searchValue = filter.search || filter.q;
    if (searchValue) {
      context.query.where(
        '(products.name LIKE ? OR products.description LIKE ? OR products.sku LIKE ?)',
        `%${searchValue}%`, `%${searchValue}%`, `%${searchValue}%`
      );
      
      delete filter.search;
      delete filter.q;
    }
    
    // Handle barcode search (exact match on SKU or special barcode field)
    if (filter.barcode) {
      context.query.where(
        '(products.sku = ? OR products.barcode = ?)',
        filter.barcode, filter.barcode
      );
      delete filter.barcode;
    }
  }
  
  // Message search
  if (context.options.type === 'messages') {
    if (filter.search) {
      context.query.where(
        '(messages.subject LIKE ? OR messages.body LIKE ? OR messages.from LIKE ?)',
        `%${filter.search}%`, `%${filter.search}%`, `%${filter.search}%`
      );
      delete filter.search;
    }
  }
}, 15); // Priority 15 - runs after validation but before standard filters

// ============================================================
// PATTERN 2: Advanced Search Syntax
// ============================================================

api.hook('modifyQuery', async (context) => {
  if (context.options.type !== 'messages') return;
  
  const { filter } = context.params || {};
  if (!filter?.smart) return;
  
  const smartSearch = filter.smart;
  
  // Parse advanced search syntax
  // Examples:
  // - "in:inbox meeting" - messages in inbox containing "meeting"
  // - "from:john@example.com project" - from john about project
  // - "has:attachment report" - messages with attachments containing "report"
  
  // Try to parse structured search
  const structuredMatch = smartSearch.match(/^(\w+):(\S+)(?:\s+(.+))?$/);
  
  if (structuredMatch) {
    const [_, operator, value, additionalTerms] = structuredMatch;
    
    switch (operator) {
      case 'in':
        context.query.where('messages.folder = ?', value);
        if (additionalTerms) {
          context.query.where(
            '(messages.subject LIKE ? OR messages.body LIKE ?)',
            `%${additionalTerms}%`, `%${additionalTerms}%`
          );
        }
        break;
        
      case 'from':
        context.query.where('messages.from LIKE ?', `%${value}%`);
        if (additionalTerms) {
          context.query.where(
            '(messages.subject LIKE ? OR messages.body LIKE ?)',
            `%${additionalTerms}%`, `%${additionalTerms}%`
          );
        }
        break;
        
      case 'to':
        // For array fields, you might need database-specific JSON functions
        context.query.where('messages.to LIKE ?', `%${value}%`);
        break;
        
      case 'has':
        if (value === 'attachment') {
          context.query.where('messages.hasAttachment = ?', true);
        }
        if (additionalTerms) {
          context.query.where('messages.body LIKE ?', `%${additionalTerms}%`);
        }
        break;
        
      case 'before':
        // Parse date and filter
        const beforeDate = new Date(value).getTime();
        context.query.where('messages.createdAt < ?', beforeDate);
        break;
        
      case 'after':
        const afterDate = new Date(value).getTime();
        context.query.where('messages.createdAt > ?', afterDate);
        break;
    }
  } else {
    // Fallback to simple search if no operator found
    context.query.where(
      '(messages.subject LIKE ? OR messages.body LIKE ?)',
      `%${smartSearch}%`, `%${smartSearch}%`
    );
  }
  
  delete filter.smart;
}, 15);

// ============================================================
// PATTERN 3: Complex Search with Multiple Operators
// ============================================================

api.hook('modifyQuery', async (context) => {
  if (context.options.type !== 'messages') return;
  
  const { filter } = context.params || {};
  if (!filter?.conversation) return;
  
  // Conversation search - find all messages in a thread
  const threadId = filter.conversation;
  
  // This could be more complex, searching by:
  // - Same subject (minus Re:/Fwd: prefixes)
  // - Messages between same participants
  // - In-Reply-To headers (if storing email data)
  
  context.query.where(
    '(messages.threadId = ? OR messages.subject LIKE ?)',
    threadId,
    `%${threadId}%`
  );
  
  delete filter.conversation;
}, 15);

// ============================================================
// Usage Examples
// ============================================================

async function demoSearches() {
  // Seed some data
  await api.resources.products.create({
    name: 'JavaScript Book',
    description: 'Learn modern JavaScript and Node.js',
    category: 'Books',
    tags: ['programming', 'javascript', 'nodejs'],
    price: 29.99,
    sku: 'BOOK-JS-001',
    inStock: true
  });
  
  await api.resources.products.create({
    name: 'TypeScript Course',
    description: 'Master TypeScript for large applications',
    category: 'Courses',
    tags: ['programming', 'typescript', 'javascript'],
    price: 79.99,
    sku: 'COURSE-TS-001',
    inStock: true
  });
  
  await api.resources.messages.create({
    subject: 'Project Meeting Tomorrow',
    body: 'Let\'s discuss the new JavaScript features',
    from: 'john@example.com',
    to: ['team@example.com'],
    folder: 'inbox',
    hasAttachment: false
  });
  
  await api.resources.messages.create({
    subject: 'Re: Project Meeting Tomorrow',
    body: 'I\'ll bring the TypeScript migration plan',
    from: 'jane@example.com',
    to: ['john@example.com', 'team@example.com'],
    folder: 'inbox',
    hasAttachment: true
  });
  
  // Example searches
  console.log('\n=== Simple Product Search ===');
  const productResults = await api.resources.products.query({
    filter: { search: 'javascript' }
  });
  console.log('Found:', productResults.data.length, 'products');
  
  console.log('\n=== Barcode Search ===');
  const barcodeResults = await api.resources.products.query({
    filter: { barcode: 'BOOK-JS-001' }
  });
  console.log('Found:', barcodeResults.data.length, 'products');
  
  console.log('\n=== Message Search ===');
  const messageResults = await api.resources.messages.query({
    filter: { search: 'project' }
  });
  console.log('Found:', messageResults.data.length, 'messages');
  
  console.log('\n=== Smart Search - Inbox ===');
  const inboxResults = await api.resources.messages.query({
    filter: { smart: 'in:inbox meeting' }
  });
  console.log('Found:', inboxResults.data.length, 'messages in inbox about meeting');
  
  console.log('\n=== Smart Search - From ===');
  const fromResults = await api.resources.messages.query({
    filter: { smart: 'from:jane typescript' }
  });
  console.log('Found:', fromResults.data.length, 'messages from jane about typescript');
  
  console.log('\n=== Smart Search - Attachments ===');
  const attachmentResults = await api.resources.messages.query({
    filter: { smart: 'has:attachment' }
  });
  console.log('Found:', attachmentResults.data.length, 'messages with attachments');
}

// Run the demo
if (import.meta.url === `file://${process.argv[1]}`) {
  demoSearches().catch(console.error);
}

export { api };