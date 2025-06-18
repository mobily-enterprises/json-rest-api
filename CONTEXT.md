# JSON REST API - Development Context

This file preserves the context of development sessions with Claude, documenting what was built, why, and what's next.

## Session: January 2024 - Major Feature Implementation

### What We Built

#### 1. **Structured Error Handling System** (`errors.js`)
- Created comprehensive error class hierarchy (ApiError base class)
- Implemented specific error types: BadRequestError, NotFoundError, ValidationError, etc.
- Added error code standardization (ErrorCodes object)
- Multi-field validation error support
- Error context preservation with `withContext()`
- JSON:API compliant error formatting

**Why**: The original codebase had ad-hoc error creation. We built a proper OOP error system for consistency, type safety, and better debugging.

#### 2. **Automatic Timestamps Plugin** (`plugins/timestamps.js`)
- Automatically manages `createdAt` and `updatedAt` fields
- Configurable field names and formats (timestamp/date/dateTime)
- Optional touchOnGet feature
- Helper methods: `touchRecord()`, `getTimestampFields()`

**Why**: Common pattern that was missing from the library. Saves developers from manually managing timestamps.

#### 3. **Relationship System with `refs`**
- Schema fields can define foreign key relationships:
  ```javascript
  userId: { type: 'id', refs: { resource: 'users' } }
  ```
- Added methods: `getFieldRelationship()`, `getRelationshipFields()`
- Extensible design for future features (joins, cascading, etc.)

**Why**: Based on the legacy system's `foreignEndpoint` pattern but modernized. Single source of truth for relationships.

#### 4. **Affected Records System**
- Three ways to specify affected records in hooks:
  ```javascript
  context.refetchRelated = ['userId', 'productId'];  // Uses schema refs
  context.affectedRecords = [{type: 'users', id: '123'}];  // Direct
  context.calculateAffected = async (record) => [...];  // Dynamic
  ```
- HTTP plugin automatically fetches and includes affected records
- Returns JSON:API compound documents with `included` section

**Why**: Solves the problem where updating one record (e.g., review) affects others (e.g., user's average rating). Clients get all updated data in one response.

#### 5. **Artificial Delay Option**
- Added `artificialDelay` option to Api constructor
- Applies delay to all CRUD operations
- Can be overridden per operation

**Why**: Useful for testing loading states and race conditions in development.

### Key Design Decisions

1. **Error Classes Over Strings**: We created a full error class hierarchy instead of just error factories because it enables `instanceof` checks and better IDE support.

2. **refs in Schema**: Placed relationship definitions directly in schema field definitions for locality and self-documentation.

3. **Context-Based Affected Records**: Used the existing context object pattern to declare affected records, maintaining consistency with the hook system.

4. **Separation of Concerns**: HTTP plugin handles JSON:API formatting; storage plugins don't know about it. Clean architecture.

### Code Style Observed

- User prefers NO comments in code unless specifically requested
- User values consistency highly ("I am VERY worried about consistency")
- User prefers intuitive APIs (e.g., `api.resources.users` over `api.get(id, {type: 'users'})`)
- User wants practical features over theoretical purity

### What's Next

1. **Soft Delete Support** - User explicitly said "I WILL IMPLEMENT IT IN THE FUTURE"
2. **Possible refs Extensions**:
   - `refs: { resource: 'users', join: true, fields: ['name', 'email'] }`
   - `refs: { resource: 'users', cascade: 'delete' }`
   - `refs: { resource: 'users', eager: true }`

### Current State

- All tests should be passing (if tests exist)
- The library now has professional error handling
- Relationships are well-defined and extensible
- HTTP responses can include affected records automatically
- Timestamps are handled automatically

### Important Files Modified

1. `api.js` - Added relationship methods and artificial delay
2. `errors.js` - New file with complete error system
3. `plugins/http.js` - Added affected records handling
4. `plugins/timestamps.js` - New file with timestamp management
5. `plugins/memory.js` - Updated to use new error classes
6. `plugins/mysql.js` - Updated to use new error classes
7. `plugins/validation.js` - Updated to use new error classes
8. `index.js` - Added new exports (errors, TimestampsPlugin)
9. `docs/API.md` - Documented all new features
10. `docs/GUIDES.md` - Added practical examples

### User Preferences

- Dislikes manual type passing in CRUD operations
- Removed `api.apis` property for accessing other APIs (confusing)
- Prefers registry access to be class-level (`Api.registry`)
- Wants consistency in API patterns
- Appreciates practical examples over theory

### Session Notes

- User was very happy with the error system ("I want to marry you")
- We built the error system from scratch based on best practices, not from the original library
- User confirmed the error system design was great despite being invented
- ApiRegistryPlugin was identified as legacy and can be deleted

This context file helps future sessions understand the library's evolution and design philosophy.