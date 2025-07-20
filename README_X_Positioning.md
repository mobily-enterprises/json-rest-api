# Positioning Plugin Guide

The Positioning Plugin adds sophisticated ordering capabilities to your REST API resources, enabling drag-and-drop interfaces, sortable lists, and maintaining custom order across different groupings. It uses fractional indexing for infinite precision without requiring batch updates.

## Table of Contents

1. [Overview](#overview)
2. [Installation](#installation)
3. [Basic Usage](#basic-usage)
4. [Configuration Options](#configuration-options)
5. [Position Grouping](#position-grouping)
6. [API Usage](#api-usage)
7. [Real-World Examples](#real-world-examples)
8. [How It Works](#how-it-works)
9. [Migration Guide](#migration-guide)
10. [Performance Considerations](#performance-considerations)
11. [Troubleshooting](#troubleshooting)

## Overview

The Positioning Plugin provides:

- **Fractional indexing**: Insert items between any two positions without updating other records
- **Position groups**: Maintain separate orderings for different categories/statuses/projects
- **BeforeId API**: Natural interface for drag-and-drop operations
- **Automatic positioning**: Items without explicit positions are placed appropriately
- **Zero conflicts**: Multiple users can reorder simultaneously without issues

### Why Fractional Indexing?

Traditional integer-based positioning requires updating multiple records when inserting:

```sql
-- Traditional approach - requires updating many records
UPDATE tasks SET position = position + 1 WHERE position >= 3;
INSERT INTO tasks (title, position) VALUES ('New Task', 3);
```

Fractional indexing only updates the moved item:

```sql
-- Fractional approach - single record update
INSERT INTO tasks (title, position) VALUES ('New Task', 'a0m');
```

## Installation

First, ensure you have the required dependency:

```bash
npm install fractional-indexing
```

Then, use the plugin in your API:

```javascript
import { Api } from 'hooked-api';
import { RestApiPlugin } from './plugins/core/rest-api-plugin.js';
import { RestApiKnexPlugin } from './plugins/core/rest-api-knex-plugin.js';
import { PositioningPlugin } from './plugins/core/rest-api-positioning-plugin.js';

const api = new Api({
  name: 'my-api',
  version: '1.0.0'
});

// Core plugins
await api.use(RestApiPlugin);
await api.use(RestApiKnexPlugin, { knex: knexInstance });

// Add positioning capabilities
await api.use(PositioningPlugin);
```

## Basic Usage

### Simple List Ordering

For a basic sortable list, just add the plugin:

```javascript
await api.use(PositioningPlugin);

// Define a resource
api.addResource('tasks', {
  schema: {
    title: { type: 'string', required: true },
    completed: { type: 'boolean', defaultTo: false }
    // 'position' field is automatically added
  }
});
```

Now you can create ordered tasks:

```javascript
// First task
POST /api/tasks
{
  "title": "First task"
}
// Response includes position: "a0"

// Add task at the end
POST /api/tasks
{
  "title": "Last task",
  "beforeId": null  // Explicit "place at end"
}
// Gets position: "a1"

// Insert between first and last
POST /api/tasks
{
  "title": "Middle task",
  "beforeId": 2  // Place before task with ID 2
}
// Gets position: "a0m" (between "a0" and "a1")
```

### Retrieving Ordered Lists

Lists are automatically sorted by position:

```javascript
GET /api/tasks

// Returns tasks in position order:
{
  "data": [
    { "id": 1, "attributes": { "title": "First task", "position": "a0" } },
    { "id": 3, "attributes": { "title": "Middle task", "position": "a0m" } },
    { "id": 2, "attributes": { "title": "Last task", "position": "a1" } }
  ]
}
```

## Configuration Options

Configure the plugin behavior:

```javascript
await api.use(PositioningPlugin, {
  // Position field name (default: 'position')
  field: 'sortOrder',
  
  // Grouping fields - create separate position sequences per group
  filters: ['status', 'projectId'],
  
  // Resources to exclude from positioning
  excludeResources: ['users', 'system_logs'],
  
  // Positioning strategy (currently only 'fractional' is supported)
  strategy: 'fractional',
  
  // Field name for beforeId in requests (default: 'beforeId')
  beforeIdField: 'insertBefore',
  
  // Default position for new items without beforeId (default: 'last')
  defaultPosition: 'last',  // or 'first'
  
  // Automatically create database index (default: true)
  autoIndex: true,
  
  // Maximum position string length before rebalancing (default: 50)
  rebalanceThreshold: 50
});
```

## Position Grouping

Position grouping is one of the most powerful features. It maintains separate position sequences for different combinations of field values.

### Understanding Position Groups

When you configure filters like `['status', 'projectId']`, the plugin creates independent position sequences for each unique combination:

- Project 1 + Status "todo" → positions: a0, a1, a2...
- Project 1 + Status "done" → positions: a0, a1, a2... (separate sequence!)
- Project 2 + Status "todo" → positions: a0, a1, a2... (another separate sequence!)

This means:
- The first item in each group gets position "a0"
- Items can have the same position value if they're in different groups
- Moving between groups requires explicit positioning with `beforeId`

### Kanban Board Example

```javascript
await api.use(PositioningPlugin, {
  filters: ['boardId', 'columnId']
});

api.addResource('cards', {
  schema: {
    title: { type: 'string', required: true },
    boardId: { type: 'id', required: true },
    columnId: { type: 'string', required: true },
    description: { type: 'string' }
  }
});
```

Each board/column combination maintains its own positions:

```javascript
// First card in "To Do" column
POST /api/cards
{
  "title": "Design mockups",
  "boardId": 1,
  "columnId": "todo"
}
// Position: "a0" in board 1, todo column

// Second card in "To Do" 
POST /api/cards
{
  "title": "Write tests",
  "boardId": 1,
  "columnId": "todo"
}
// Position: "a1" in board 1, todo column

// First card in "In Progress" - gets its own sequence!
POST /api/cards
{
  "title": "Implement feature",
  "boardId": 1,
  "columnId": "in-progress"
}
// Position: "a0" in board 1, in-progress column
```

### Moving Between Groups

**Important Behavior**: When you change a filter field value (like moving a card between columns), the item keeps its existing position value. The plugin does NOT automatically reassign positions when filter values change.

```javascript
// Move card from "todo" to "in-progress"
PATCH /api/cards/1
{
  "columnId": "in-progress"
}
// Result: Card moves to in-progress but KEEPS its existing position (e.g., "a0m")
// This might place it in an unexpected location in the new column!
```

To move an item to a specific position in the new group, you MUST provide a `beforeId`:

```javascript
// Move card and position it correctly
PATCH /api/cards/1
{
  "columnId": "in-progress",
  "beforeId": null  // Explicitly place at end of new column
}
// OR
PATCH /api/cards/1
{
  "columnId": "in-progress",
  "beforeId": 456  // Place before card 456 in the new column
}
```

**Why this behavior?** The plugin cannot guess where you want the item positioned in the new group. Should it go first? Last? In the middle? You must explicitly specify the desired position.

### Multi-Tenant Positioning

```javascript
await api.use(PositioningPlugin, {
  filters: ['tenantId', 'listId']
});

// Each tenant has independent position sequences
// Tenant A's positions don't affect Tenant B's positions
```

## API Usage

### Creating Items

```javascript
// Add at end (default)
POST /api/items
{ "name": "New item" }

// Add at end explicitly
POST /api/items
{ "name": "New item", "beforeId": null }

// Add at specific position
POST /api/items
{ "name": "New item", "beforeId": 123 }

// Note: Manual position values are ignored!
// The plugin always calculates positions to ensure consistency
POST /api/items
{ "name": "New item", "position": "a0abc" }  // 'position' will be recalculated!
```

### Updating Positions

```javascript
// Move item before another
PATCH /api/items/456
{ "beforeId": 789 }

// Move to end
PATCH /api/items/456
{ "beforeId": null }

// Update other fields without changing position
PATCH /api/items/456
{ "name": "Updated name" }
// Position remains unchanged

// IMPORTANT: Changing filter fields without beforeId
PATCH /api/items/456
{ "status": "done" }
// Item moves to 'done' group but KEEPS its position value!
// May appear in unexpected location in the new group
```

### Simplified Format

The plugin works with both JSON:API and simplified formats:

```javascript
// Simplified format
POST /api/items
{
  "name": "New item",
  "categoryId": 5,
  "beforeId": 10
}

// JSON:API format
POST /api/items
{
  "data": {
    "type": "items",
    "attributes": {
      "name": "New item",
      "categoryId": 5,
      "beforeId": 10
    }
  }
}
```

## Important Behaviors to Understand

### 1. Position Values are Immutable by Design

The plugin NEVER changes an item's position unless you explicitly request it with `beforeId`. This means:

- Changing filter fields (status, category, etc.) does NOT reposition the item
- The item keeps its position value when moving between groups
- You must provide `beforeId` to position items in their new group

### 2. Position Groups are Independent

Each combination of filter values creates a completely separate position space:

```javascript
// These items can all have position "a0" because they're in different groups:
item1: { projectId: 1, status: 'todo', position: 'a0' }
item2: { projectId: 1, status: 'done', position: 'a0' }  // Different status
item3: { projectId: 2, status: 'todo', position: 'a0' }  // Different project
```

### 3. BeforeId Context Matters

The `beforeId` only works within the same position group:

```javascript
// This will NOT work as expected:
PATCH /api/items/1
{
  "status": "done",
  "beforeId": 2  // Item 2 is in the 'todo' group, not 'done'!
}
// Result: Item 1 moves to 'done' but ignores beforeId (item not found in target group)
```

### 4. Manual Position Values are Ignored

The plugin always calculates positions to ensure consistency:

```javascript
// This position value will be ignored:
POST /api/items
{
  "name": "Test",
  "position": "zzz"  // Ignored! Plugin calculates actual position
}
```

### 5. Null Values in Filters

Null values in filter fields create their own position group:

```javascript
// These are THREE different position groups:
items.where({ projectId: 1, status: 'active' })   // Group 1
items.where({ projectId: 1, status: null })       // Group 2 (null status)
items.where({ projectId: null, status: 'active' }) // Group 3 (null project)
```

## Real-World Examples

### 1. Trello-Style Board

```javascript
// Configure with board and list grouping
await api.use(PositioningPlugin, {
  filters: ['boardId', 'listId']
});

// Moving a card
async function moveCard(cardId, targetListId, targetPosition) {
  const response = await fetch(`/api/cards/${cardId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      listId: targetListId,
      beforeId: targetPosition  // ID of card to insert before
    })
  });
  return response.json();
}
```

### 2. Priority Task List

```javascript
// Configure with status grouping
await api.use(PositioningPlugin, {
  filters: ['status'],
  defaultPosition: 'first'  // New tasks go to top
});

// Reorder within status
async function reprioritizeTask(taskId, beforeTaskId) {
  return fetch(`/api/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ beforeId: beforeTaskId })
  });
}
```

### 3. Playlist Manager

```javascript
// No filters - global ordering
await api.use(PositioningPlugin, {
  field: 'playOrder'
});

// Add song to playlist
async function addToPlaylist(songId, position = null) {
  return fetch('/api/playlist-songs', {
    method: 'POST',
    body: JSON.stringify({
      songId,
      beforeId: position  // null = add to end
    })
  });
}
```

### 4. Multi-Level Navigation Menu

```javascript
// Configure with parent grouping
await api.use(PositioningPlugin, {
  filters: ['parentId'],  // Each menu level has its own ordering
  field: 'menuOrder'
});

// Create menu structure
await createMenuItem({ title: 'Products', parentId: null });  // Top level
await createMenuItem({ title: 'Software', parentId: 1 });     // Under Products
await createMenuItem({ title: 'Hardware', parentId: 1, beforeId: 2 }); // Before Software
```

## How It Works

### Fractional Indexing Algorithm

The plugin uses fractional indexing to generate position keys that can be infinitely subdivided:

1. **Initial positions**: First item gets "a0", second gets "a1", etc.
2. **Inserting between**: Between "a0" and "a1", we generate "a0m"
3. **Further subdivision**: Between "a0" and "a0m", we get "a0g"
4. **Infinite precision**: Can always find a key between any two keys

**Why these strange strings?** The fractional-indexing algorithm uses a base-62 encoding (0-9, a-z, A-Z) to create sortable strings that can be infinitely subdivided. The strings are designed to:
- Sort correctly as strings (no numeric parsing needed)
- Allow insertion between any two values
- Minimize string length growth
- Work with any database that can sort strings

### Position Calculation Flow

1. **Request arrives** with optional `beforeId`
2. **Plugin extracts** the beforeId and filter field values
3. **Determines if positioning is needed**:
   - For POST: Always calculates position
   - For PATCH/PUT: Only if `beforeId` is provided
   - Changing filter fields alone does NOT trigger repositioning
4. **Query database** for items in the same position group (based on filter fields)
5. **Calculate position**:
   - If `beforeId` is null → place at end of the group
   - If `beforeId` is 'FIRST' → place at beginning of the group
   - If `beforeId` is an ID → find that item and place before it
   - If target item not found → place at end (fail-safe behavior)
6. **Store position** in the position field
7. **Save record** with calculated position

**Key Insight**: The position is calculated relative to other items in the same "position group" (items with matching filter field values). An item with `status: 'todo'` has no position relationship with items where `status: 'done'`.

### Database Structure

The plugin automatically creates an efficient composite index:

```sql
CREATE INDEX idx_tasks_positioning ON tasks(status, projectId, position);
```

This ensures fast queries for:
- Retrieving ordered items within a group
- Finding specific positions for insertion
- Moving items between groups

## Migration Guide

### From Integer-Based Positioning

If you have existing integer positions, you can migrate gradually:

```javascript
// 1. Add the plugin (it works alongside existing positions)
await api.use(PositioningPlugin, {
  field: 'sort_order'  // Your existing field
});

// 2. New items will get fractional positions
// 3. Existing integer positions still work (treated as strings)
// 4. Optionally, batch convert integers to fractional:

async function migratePositions() {
  const items = await knex('tasks').select('id', 'sort_order');
  
  for (let i = 0; i < items.length; i++) {
    const fractionalPos = generateKeyBetween(
      i > 0 ? items[i-1].sort_order : null,
      null
    );
    
    await knex('tasks')
      .where('id', items[i].id)
      .update({ sort_order: fractionalPos });
  }
}
```

### Adding to Existing Resources

The plugin automatically adds the position field to schemas:

```javascript
// Before plugin
api.addResource('items', {
  schema: {
    name: { type: 'string' }
  }
});

// After adding plugin
// 'position' field is automatically added to the schema
```

## Performance Considerations

### Indexing

The plugin creates optimal indexes automatically:

```sql
-- For ungrouped positioning
CREATE INDEX ON items(position);

-- For grouped positioning
CREATE INDEX ON items(status, projectId, position);
```

### Query Performance

- **Retrieving ordered lists**: O(log n) with index
- **Inserting items**: O(log n) to find position + O(1) to insert
- **Moving items**: O(log n) to find positions + O(1) to update

### Position String Length

Fractional keys can grow longer with many insertions in the same spot:

- Starting positions: "a0", "a1" (2 characters)
- After many insertions: "a0zzzzz" (7+ characters)
- Plugin monitors length and can trigger rebalancing
- In practice, this rarely happens with normal usage

### Best Practices

1. **Use grouping** when items have natural categories
2. **Avoid manual positions** unless migrating data
3. **Let the plugin handle positioning** for consistency
4. **Monitor position lengths** in high-activity systems

## Troubleshooting

### Common Issues

**Items not maintaining order**
- Check that no other sorting is applied in queries
- Verify the position field contains valid fractional keys
- Ensure you're querying within the correct position group
- Remember: position values are strings, sorted lexicographically ("a10" comes before "a2"!)

**Position field not present in schema**
- The position field must exist in your schema
- Check `excludeResources` configuration
- The plugin will throw an error if the field is missing
- Look for plugin initialization errors in logs

**BeforeId not working**
- Ensure the target item exists in the same position group
- Check that filter field values match (e.g., same status, same projectId)
- Verify beforeId is a valid ID (string or number)
- Note: You cannot position relative to items in different groups

**Items appear in wrong position after moving between groups**
- This is expected behavior! Items keep their position when filter values change
- Always provide a `beforeId` when changing filter fields
- The plugin cannot guess where you want the item in the new group

**Performance degradation**
- Check if indexes were created successfully
- Monitor position string lengths
- Consider rebalancing if strings are very long

### Debug Logging

Enable debug logging to see position calculations:

```javascript
const api = new Api({
  name: 'my-api',
  version: '1.0.0',
  logging: { level: 'debug' }
});
```

### Manual Position Management

For advanced use cases, you can work directly with positions:

```javascript
import { generateKeyBetween } from 'fractional-indexing';

// Generate a position between two items
const newPosition = generateKeyBetween('a0', 'a1'); // Returns 'a0m'

// Generate first position
const firstPosition = generateKeyBetween(null, null); // Returns 'a0'

// Generate last position after 'z5'
const lastPosition = generateKeyBetween('z5', null); // Returns 'z6'
```

## Summary

The Positioning Plugin provides a production-ready solution for maintaining custom order in your REST API resources. With fractional indexing and position grouping, it handles complex ordering requirements while maintaining excellent performance and avoiding conflicts.

Key benefits:
- **No batch updates** - Only the moved item is updated
- **Infinite precision** - Always room to insert between items
- **Natural API** - Works with drag-and-drop interfaces
- **Grouped positioning** - Separate sequences per category
- **Automatic indexes** - Optimal database performance
- **Zero conflicts** - Multiple users can reorder simultaneously

The plugin integrates seamlessly with the REST API plugin ecosystem, requiring minimal configuration while providing powerful positioning capabilities for modern applications.