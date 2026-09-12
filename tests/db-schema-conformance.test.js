import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDatabase, databaseClient } from './helpers/test-database.js'
import { introspectKnexColumnConstraints, introspectKnexTableSnapshot } from '../plugins/core/lib/dbIntrospection.js'
import { addKnexFields, alterKnexFields, createKnexTable, generateKnexMigration, generateKnexMigrationDiff } from '../plugins/core/lib/dbTablesOperations.js'
import { createRegularSchemaApi } from './fixtures/api-configs.js'
import { cleanTables, createJsonApiDocument } from './helpers/test-utils.js'

const tableName = 'schema_records'
const idColumn = 'record_key'
const schemaOptions = { idProperty: idColumn, dialect: databaseClient }

function loadMigration (source) {
  const exports = {}
  // eslint-disable-next-line no-new-func -- Execute the actual generated migration against an isolated database.
  new Function('exports', source)(exports)
  return exports
}

function assertEmptyPlan (diff) {
  for (const [key, entries] of Object.entries(diff.plan)) assert.deepEqual(entries, [], key)
}

function tableSchema (functionDefault = () => 'runtime-only') {
  return {
    structure: {
      displayName: { type: 'string', maxLength: 80, required: true, storage: { column: 'legacy_name' } },
      emptyText: { type: 'string', defaultTo: '' },
      quotedText: { type: 'string', defaultTo: "O'Brien" },
      enabled: { type: 'boolean', defaultTo: false },
      count: { type: 'integer', defaultTo: 0 },
      amount: { type: 'number', precision: 12, scale: 2 },
      observedAt: { type: 'dateTime', temporalPrecision: 3 },
      atTime: { type: 'time' },
      day: { type: 'date' },
      epochMs: { type: 'epochMilliseconds' },
      payload: { type: 'object' },
      bytes: { type: 'blob' },
      runtimeLabel: { type: 'string', defaultTo: functionDefault }
    },
    indexes: [{ name: 'idx_schema_name_count', columns: ['displayName', 'count'] }],
    checkConstraints: [{ name: 'ck_schema_count', clause: 'count >= 0' }]
  }
}

for (const naming of ['snake_case', 'exact']) {
  describe(`Public schema helpers (${databaseClient}, regular storage, ${naming})`, () => {
    let database, db, items, defaultCalls
    const columnName = naming === 'exact' ? 'loginCount' : 'login_count'
    before(async () => {
      database = await createTestDatabase()
      db = database.knex
      const api = await createRegularSchemaApi(db, {
        storage: { naming },
        schema: {
          id: { type: 'id', storage: { column: idColumn } },
          displayName: { type: 'string', required: true, storage: { column: 'legacy_name' } },
          loginCount: { type: 'integer', defaultTo: 0 },
          runtimeLabel: { type: 'string', defaultTo: () => { defaultCalls++; return 'Generated' } },
          virtualNote: { type: 'string', virtual: true },
          computedLabel: { type: 'string', computed: true, compute: () => 'Calculated' }
        },
        indexes: [{ name: 'idx_schema_public_name_count', columns: ['displayName', 'loginCount'] }]
      })
      items = api.resources.items
    })
    after(async () => database?.close())
    beforeEach(async () => {
      defaultCalls = 0
      await db.schema.dropTableIfExists(tableName)
      await items.createKnexTable()
      await cleanTables(db, [tableName], { storage: 'knex' })
    })

    for (const method of ['direct', 'generated']) {
      it(`round-trips mapped IDs, defaults and non-stored fields (${method})`, async () => {
        if (method === 'generated') {
          await db.schema.dropTable(tableName)
          await loadMigration(await items.generateKnexMigration()).up(db)
        }
        const current = await items.introspectKnexTableSnapshot()
        assert.equal(current.idColumn, idColumn)
        assert.deepEqual(current.columns.map(column => column.name).sort(), [idColumn, 'legacy_name', columnName, naming === 'exact' ? 'runtimeLabel' : 'runtime_label'].sort())
        assert.deepEqual(current.indexes[0].columns, ['legacy_name', columnName])
        assertEmptyPlan(await items.generateKnexMigrationDiff())
        assert.equal(defaultCalls, 0)
        const result = await items.post({ document: createJsonApiDocument('items', { displayName: 'Public' }) })
        assert.equal(typeof result.data.id, 'string')
        assert.equal(result.data.attributes.loginCount, 0)
        assert.equal(result.data.attributes.runtimeLabel, 'Generated')
        assert.equal(result.data.attributes.computedLabel, 'Calculated')
        assert.equal(defaultCalls, 1)
        const stored = await db(tableName).first()
        assert.equal(String(stored[idColumn]), result.data.id)
        assert.equal(stored.legacy_name, 'Public')
        assert.equal(stored[columnName], 0)
      })
    }

    it('uses resource naming and explicit mappings when adding columns', async () => {
      await db(tableName).insert({ legacy_name: 'Existing' })
      await items.addKnexFields({
        fields: {
          newCount: { type: 'integer', defaultTo: 0 },
          mappedNote: { type: 'string', defaultTo: 'Added', storage: { column: 'legacy_note' } }
        }
      })
      const stored = await db(tableName).first()
      assert.equal(stored[naming === 'exact' ? 'newCount' : 'new_count'], 0)
      assert.equal(stored.legacy_note, 'Added')
      assert.equal(stored.legacy_name, 'Existing')
    })

    it('uses resource naming when altering a column default', async () => {
      await db(tableName).insert({ legacy_name: 'Existing' })
      await items.alterKnexFields({ fields: { loginCount: { type: 'integer', defaultTo: 7 } } })
      await db(tableName).insert({ legacy_name: 'New' })
      assert.deepEqual((await db(tableName).orderBy(idColumn)).map(row => row[columnName]), [0, 7])
    })
  })
}

// These helpers operate on ordinary SQL tables, independently of the AnyAPI selection.
describe(`Real table schema and migration contracts (${databaseClient}, regular storage)`, () => {
  let database, db
  before(async () => {
    database = await createTestDatabase()
    db = database.knex
    assert.equal(db.client.config.client, databaseClient)
    if (databaseClient === 'better-sqlite3') await db.raw('PRAGMA foreign_keys = ON')
  })
  after(async () => database?.close())
  beforeEach(async () => {
    await db.schema.dropTableIfExists(tableName)
    await db.schema.dropTableIfExists('schema_parents')
  })

  const snapshot = () => introspectKnexTableSnapshot(db, { tableName, idColumn })
  const create = schema => createKnexTable(db, { tableName, idProperty: idColumn }, schema)
  const diff = (current, schema) => generateKnexMigrationDiff(tableName, current, schema, schemaOptions)

  for (const [name, build, message] of [
    ['missing', table => table.integer('other').primary(), /Could not find id column/],
    ['nullable', table => table.integer(idColumn).nullable(), /must be not-null/],
    ['non-primary', table => table.integer(idColumn).notNullable(), /Primary key must include id column/],
    ['floating-point', table => table.float(idColumn).notNullable().primary(), /must use an integer or string type/],
    ['composite', table => { table.integer(idColumn).notNullable(); table.integer('other').notNullable(); table.primary([idColumn, 'other']) }, /Composite primary keys/]
  ]) {
    it(`rejects a ${name} resource ID in a table snapshot`, async () => {
      await db.schema.createTable(tableName, build)
      await assert.rejects(snapshot(), message)
    })
  }

  if (databaseClient === 'mysql2') {
    for (const columns of ['label(10)', '(lower(label))', 'label DESC']) {
      it(`rejects an unrepresentable MySQL index on ${columns}`, async () => {
        await create({ structure: { label: { type: 'string' } } })
        await db.raw(`CREATE INDEX guarded_label ON ${tableName} (${columns})`)
        await assert.rejects(snapshot(), /Index 'guarded_label'.*simple column-index snapshot/)
      })
    }
    for (const method of ['direct', 'generated']) {
      it(`creates, inspects and alters a native SET with escaped values (${method})`, async () => {
        const schema = { structure: { flags: { type: 'string', setValues: ['featured', "O'Brien", 'Path\\Leaf'], defaultTo: 'featured' } } }
        if (method === 'direct') await create(schema)
        else await loadMigration(generateKnexMigration(tableName, schema, schemaOptions)).up(db)
        await db(tableName).insert({ record_key: 1 })
        await db(tableName).insert({ record_key: 2, flags: "O'Brien,Path\\Leaf" })
        assert.deepEqual((await db(tableName).orderBy(idColumn)).map(row => row.flags), ['featured', "O'Brien,Path\\Leaf"])
        assert.deepEqual((await snapshot()).columns.find(column => column.name === 'flags').setValues, schema.structure.flags.setValues)
        assertEmptyPlan(diff(await snapshot(), schema))
        const desired = { structure: { flags: { ...schema.structure.flags, setValues: [...schema.structure.flags.setValues, 'archived'] } } }
        if (method === 'direct') await alterKnexFields(db, tableName, desired)
        else await loadMigration(diff(await snapshot(), desired).migration).up(db)
        await db(tableName).insert({ flags: 'archived' })
        await assert.rejects(db(tableName).insert({ flags: 'invalid' }))
        assert.deepEqual((await db(tableName).orderBy(idColumn)).map(row => row.flags), ['featured', "O'Brien,Path\\Leaf", 'archived'])
        assertEmptyPlan(diff(await snapshot(), desired))
      })
    }
  }

  it('requires a target dialect when a standalone migration needs SQL-sensitive literals', () => {
    for (const definition of [
      { type: 'string', enum: ['Question?'] },
      { type: 'string', enum: ['Path\\Leaf'] },
      { type: 'string', defaultTo: 'Question?' },
      { type: 'object', defaultTo: { value: 'Question?' } }
    ]) {
      assert.throws(() => generateKnexMigration(tableName, { structure: { value: definition } }), /explicit migration dialect/)
    }
  })

  const createCompositeSchema = async ({ unique = false } = {}) => {
    await createKnexTable(db, { tableName: 'schema_parents' }, {
      structure: { tenantKey: { type: 'integer', required: true }, userKey: { type: 'integer', required: true } },
      indexes: [{ name: 'uq_schema_parent_pair', columns: ['tenantKey', 'userKey'], unique: true }]
    })
    const schema = {
      structure: { tenantRef: { type: 'integer' }, userRef: { type: 'integer' }, label: { type: 'string' } },
      indexes: [{ name: 'idx_schema_child_pair', columns: ['tenantRef', 'userRef'], unique }],
      foreignKeys: [{ name: 'fk_schema_parent_pair', columns: ['tenantRef', 'userRef'], referencedTableName: 'schema_parents', referencedColumns: ['tenant_key', 'user_key'], deleteRule: 'RESTRICT', updateRule: 'CASCADE' }]
    }
    await create(schema)
    await db('schema_parents').insert([{ tenant_key: 1, user_key: 10 }, { tenant_key: 2, user_key: 20 }])
    await db(tableName).insert({ tenant_ref: 1, user_ref: 10, label: 'Preserved' })
    return schema
  }

  it('preserves undeclared uniqueness and foreign keys instead of treating a resource as the whole table', async () => {
    const initial = await createCompositeSchema({ unique: true })
    const current = await snapshot()
    const change = diff(current, { structure: initial.structure })
    assert.deepEqual(change.plan.dropIndexes, [])
    assert.deepEqual(change.plan.dropForeignKeys, [])
    assert.ok(change.warnings.some(warning => /Index 'idx_schema_child_pair'.*Skipping automatic drop/.test(warning)))
    assert.ok(change.warnings.some(warning => /Foreign key 'fk_schema_parent_pair'.*Skipping automatic drop/.test(warning)))
    await loadMigration(change.migration).up(db)
    assert.deepEqual(await snapshot(), current)
    await assert.rejects(db(tableName).insert({ tenant_ref: 1, user_ref: 10, label: 'Duplicate' }))
    await assert.rejects(db(tableName).insert({ tenant_ref: 1, user_ref: 20, label: 'Orphan' }))
  })

  it('only removes undeclared constraints with their explicit drop options', async () => {
    const initial = await createCompositeSchema({ unique: true })
    const change = generateKnexMigrationDiff(tableName, await snapshot(), { structure: initial.structure }, {
      ...schemaOptions, allowDropIndexes: true, allowDropForeignKeys: true
    })
    assert.deepEqual(change.plan.dropIndexes.map(index => index.name), ['idx_schema_child_pair'])
    assert.deepEqual(change.plan.dropForeignKeys.map(key => key.name), ['fk_schema_parent_pair'])
    assert.ok(change.warnings.some(warning => /allowDropIndexes=true/.test(warning)))
    assert.ok(change.warnings.some(warning => /allowDropForeignKeys=true/.test(warning)))
    await loadMigration(change.migration).up(db)
    await db(tableName).insert([{ tenant_ref: 1, user_ref: 10 }, { tenant_ref: 1, user_ref: 20 }])
    assert.equal((await db(tableName)).length, 3)
  })

  it('can remove an undeclared unique index while retaining an undeclared foreign key', async () => {
    const initial = await createCompositeSchema({ unique: true })
    const change = generateKnexMigrationDiff(tableName, await snapshot(), { structure: initial.structure }, {
      ...schemaOptions, allowDropIndexes: true
    })
    assert.ok(change.warnings.some(warning => /Foreign key 'fk_schema_parent_pair'.*Skipping automatic drop/.test(warning)))
    await loadMigration(change.migration).up(db)
    await db(tableName).insert({ tenant_ref: 1, user_ref: 10, label: 'Duplicate now allowed' })
    await assert.rejects(db(tableName).insert({ tenant_ref: 1, user_ref: 20, label: 'Still an orphan' }))
    assert.equal((await snapshot()).foreignKeys[0].name, 'fk_schema_parent_pair')
  })

  it('requires explicit removal of preserved dependencies before dropping their columns', async () => {
    await createCompositeSchema()
    const current = await snapshot()
    const desired = { structure: { label: { type: 'string' } } }
    assert.throws(() => generateKnexMigrationDiff(tableName, current, desired, {
      ...schemaOptions, allowDropColumns: true
    }), /Cannot drop column.*retaining index/)
    assert.throws(() => generateKnexMigrationDiff(tableName, current, desired, {
      ...schemaOptions, allowDropColumns: true, allowDropIndexes: true
    }), /Cannot drop column.*retaining foreign key/)
    for (const dependency of [
      { indexes: [{ name: 'replacement_index', columns: ['tenant_ref'] }] },
      { foreignKeys: [{ name: 'replacement_key', columns: ['user_ref'], referencedTableName: 'schema_parents', referencedColumns: ['user_key'] }] }
    ]) {
      assert.throws(() => generateKnexMigrationDiff(tableName, current, { ...desired, ...dependency }, {
        ...schemaOptions, allowDropColumns: true, allowDropIndexes: true, allowDropForeignKeys: true
      }), /Cannot drop column.*retaining (?:index|foreign key) 'replacement_/)
    }
    assert.deepEqual(await snapshot(), current)
  })

  it('protects target columns used by retained or new self-referential foreign keys', async () => {
    const foreignKey = { name: 'fk_schema_parent_code', columns: ['parentCode'], referencedTableName: tableName, referencedColumns: ['code'] }
    await create({
      structure: { code: { type: 'string' }, parentCode: { type: 'string' } },
      indexes: [{ name: 'uq_schema_code', columns: ['code'], unique: true }],
      foreignKeys: [foreignKey]
    })
    await db(tableName).insert({ code: 'parent' })
    await db(tableName).insert({ code: 'child', parent_code: 'parent' })
    const current = await snapshot()
    const desired = { structure: { parentCode: { type: 'string' } } }
    const options = { ...schemaOptions, allowDropColumns: true, allowDropIndexes: true }
    assert.throws(() => generateKnexMigrationDiff(tableName, current, desired, options), /Cannot drop column 'code'.*foreign key 'fk_schema_parent_code'/)
    assert.throws(() => generateKnexMigrationDiff(tableName, current, {
      ...desired, foreignKeys: [{ ...foreignKey, name: 'replacement_key' }]
    }, { ...options, allowDropForeignKeys: true }), /Cannot drop column 'code'.*foreign key 'replacement_key'/)
    assert.deepEqual(await snapshot(), current)
    assert.equal((await db(tableName)).length, 2)
  })

  it('warns about adding a required column without a usable database default', async () => {
    const initial = { structure: { label: { type: 'string' } } }
    await create(initial)
    await db(tableName).insert({ label: 'Existing' })
    const current = await snapshot()
    for (const defaultTo of [undefined, null, () => 'Only at runtime']) {
      const change = diff(current, { structure: { ...initial.structure, requiredLabel: { type: 'string', required: true, defaultTo } } })
      assert.deepEqual(change.plan.addColumns.map(column => column.name), ['required_label'])
      assert.ok(change.warnings.some(warning => /required_label.*no static non-null default.*backfill/.test(warning)))
    }
    for (const defaultTo of ['', 'Filled']) {
      const change = diff(current, { structure: { ...initial.structure, requiredLabel: { type: 'string', required: true, defaultTo } } })
      assert.deepEqual(change.warnings, [])
    }
    assert.deepEqual(await db(tableName).first(), { record_key: 1, label: 'Existing' })
  })

  it('rejects generated columns from full snapshots without restricting the field-only reader', async () => {
    await db.raw(`CREATE TABLE ${tableName} (${idColumn} INTEGER PRIMARY KEY, amount INTEGER, doubled INTEGER GENERATED ALWAYS AS (amount * 2) STORED)`)
    await assert.rejects(snapshot(), /Column 'doubled'.*generated.*snapshot/)
    if (databaseClient !== 'mysql2') {
      const current = await introspectKnexColumnConstraints(db, tableName)
      assert.ok(current.columns.some(column => column.name === 'amount'))
    }
  })

  if (databaseClient !== 'better-sqlite3') {
    it('warns before narrowing a bigint column to integer', async () => {
      await db.schema.createTable(tableName, table => {
        table.increments(idColumn).primary()
        table.bigInteger('count')
      })
      await db(tableName).insert({ count: '2147483648' })
      const change = diff(await snapshot(), { structure: { count: { type: 'integer' } } })
      assert.deepEqual(change.plan.alterColumns.map(column => column.name), ['count'])
      assert.ok(change.warnings.some(warning => /count.*narrows bigint to integer.*overflow/.test(warning)))
      assert.equal(String((await db(tableName).first()).count), '2147483648')
    })
  }

  it('replaces a supporting composite index while retaining foreign-key enforcement', async () => {
    const initial = await createCompositeSchema()
    assertEmptyPlan(diff(await snapshot(), initial))
    const desired = { ...initial, indexes: [{ ...initial.indexes[0], columns: ['tenantRef', 'userRef', 'label'] }] }
    const change = diff(await snapshot(), desired)
    assert.deepEqual(change.plan.dropIndexes.map(index => index.name), ['idx_schema_child_pair'])
    assert.ok(change.warnings.some(warning => /Index 'idx_schema_child_pair'.*dropped and recreated/.test(warning)))
    await loadMigration(change.migration).up(db)
    assert.deepEqual(await db(tableName).first(), { record_key: 1, tenant_ref: 1, user_ref: 10, label: 'Preserved' })
    await assert.rejects(db(tableName).insert({ tenant_ref: 1, user_ref: 20 }))
    await db('schema_parents').where({ tenant_key: 1 }).update({ user_key: 11 })
    assert.equal((await db(tableName).first()).user_ref, 11)
    assertEmptyPlan(diff(await snapshot(), desired))
  })

  it('preserves composite foreign-key column order when changing referential actions', async () => {
    const initial = await createCompositeSchema()
    const current = await snapshot()
    assert.deepEqual(current.foreignKeys[0].columns, [{ name: 'tenant_ref', referencedName: 'tenant_key' }, { name: 'user_ref', referencedName: 'user_key' }])
    const desired = { ...initial, foreignKeys: [{ ...initial.foreignKeys[0], deleteRule: 'CASCADE' }] }
    const change = diff(current, desired)
    assert.ok(change.warnings.some(warning => /Foreign key 'fk_schema_parent_pair'.*dropped and recreated/.test(warning)))
    await loadMigration(change.migration).up(db)
    await assert.rejects(db(tableName).insert({ tenant_ref: 1, user_ref: 20 }))
    await db('schema_parents').where({ tenant_key: 2 }).delete()
    assert.equal((await db(tableName)).length, 1)
    await db('schema_parents').where({ tenant_key: 1 }).delete()
    assert.equal((await db(tableName)).length, 0)
    assertEmptyPlan(diff(await snapshot(), desired))
  })

  it('replaces a composite index and its changed foreign key in the same migration', async () => {
    const initial = await createCompositeSchema()
    const desired = {
      ...initial,
      indexes: [{ ...initial.indexes[0], columns: ['tenantRef', 'userRef', 'label'] }],
      foreignKeys: [{ ...initial.foreignKeys[0], deleteRule: 'CASCADE' }]
    }
    await loadMigration(diff(await snapshot(), desired).migration).up(db)
    await assert.rejects(db(tableName).insert({ tenant_ref: 1, user_ref: 20 }))
    await db('schema_parents').where({ tenant_key: 1 }).delete()
    assert.equal((await db(tableName)).length, 0)
    assertEmptyPlan(diff(await snapshot(), desired))
  })

  it('removes unwanted uniqueness while preserving a dependent composite foreign key', async () => {
    const initial = await createCompositeSchema()
    const unique = { ...initial, indexes: [{ ...initial.indexes[0], unique: true }] }
    await loadMigration(diff(await snapshot(), unique).migration).up(db)
    await assert.rejects(db(tableName).insert({ tenant_ref: 1, user_ref: 10, label: 'Duplicate' }))
    const desired = { ...initial, indexes: [] }
    await loadMigration(generateKnexMigrationDiff(tableName, await snapshot(), desired, { ...schemaOptions, allowDropIndexes: true }).migration).up(db)
    await db(tableName).insert({ tenant_ref: 1, user_ref: 10, label: 'Allowed' })
    await assert.rejects(db(tableName).insert({ tenant_ref: 1, user_ref: 20 }))
    assertEmptyPlan(diff(await snapshot(), desired))
  })

  it('drops composite dependencies before explicitly dropping their columns', async () => {
    await createCompositeSchema()
    const desired = { structure: { label: { type: 'string' } } }
    const change = generateKnexMigrationDiff(tableName, await snapshot(), desired, {
      ...schemaOptions, allowDropColumns: true, allowDropIndexes: true, allowDropForeignKeys: true
    })
    await loadMigration(change.migration).up(db)
    assert.deepEqual(await db(tableName).first(), { record_key: 1, label: 'Preserved' })
    assert.equal((await db('schema_parents')).length, 2)
    assertEmptyPlan(diff(await snapshot(), desired))
  })

  for (const method of ['direct', 'generated']) {
    it(`preserves question marks in static text, JSON and array defaults (${method})`, async () => {
      const text = "Path\\? O'Brien"
      const payload = { question: 'Which?', path: 'Slash\\?' }
      const values = ['Question?', 'Slash\\?']
      const schema = {
        structure: {
          text: { type: 'string', defaultTo: text },
          payload: { type: 'object', defaultTo: payload },
          values: { type: 'array', defaultTo: values }
        }
      }
      if (method === 'direct') await create(schema)
      else await loadMigration(generateKnexMigration(tableName, schema, schemaOptions)).up(db)
      await db(tableName).insert({ record_key: 1 })
      const row = await db(tableName).first()
      assert.equal(row.text, text)
      assert.deepEqual(typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload, payload)
      assert.deepEqual(typeof row.values === 'string' ? JSON.parse(row.values) : row.values, values)
      const current = await snapshot()
      assert.deepEqual(Object.fromEntries(current.columns.filter(column => ['payload', 'values'].includes(column.name)).map(column => [column.name, column.defaultValue])), { payload: JSON.stringify(payload), values: JSON.stringify(values) })
      assertEmptyPlan(diff(current, schema))
    })

    it(`preserves quoted and backslash-containing enum values (${method})`, async () => {
      const values = ['Owner', "O'Brien", 'Path\\Leaf', 'Question?', 'Slash\\?']
      const schema = { structure: { role: { type: 'string', enum: values, required: true } } }
      if (method === 'direct') await create(schema)
      else await loadMigration(generateKnexMigration(tableName, schema, schemaOptions)).up(db)
      for (const role of values) await db(tableName).insert({ role })
      assert.deepEqual((await db(tableName).orderBy(idColumn)).map(row => row.role), values)
      assert.deepEqual((await snapshot()).columns.find(column => column.name === 'role').enumValues, values)
      assertEmptyPlan(diff(await snapshot(), schema))
      if (databaseClient !== 'better-sqlite3') {
        await db(tableName).where({ role: 'Owner' }).delete()
        const desired = { structure: { role: { ...schema.structure.role, enum: ['Admin', ...values.slice(1)] } } }
        await loadMigration(diff(await snapshot(), desired).migration).up(db)
        await db(tableName).insert({ role: 'Admin' })
        await assert.rejects(db(tableName).insert({ role: 'Owner' }))
        assertEmptyPlan(diff(await snapshot(), desired))
      }
    })

    for (const type of ['integer', 'string']) {
      it(`honors a declared ${type} primary ID without adding a duplicate generated column (${method})`, async () => {
        const schema = {
          structure: {
            id: { type, primary: true, required: true, ...(type === 'string' ? { maxLength: 64 } : {}), storage: { column: idColumn } },
            name: { type: 'string' }
          }
        }
        if (method === 'direct') await create(schema)
        else await loadMigration(generateKnexMigration(tableName, schema, schemaOptions)).up(db)
        const id = type === 'string' ? 'opaque-0' : 0
        await db(tableName).insert({ [idColumn]: id, name: 'Stored' })
        assert.equal((await db(tableName).first())[idColumn], id)
        await assert.rejects(db(tableName).insert({ [idColumn]: id, name: 'Duplicate' }))
        const current = await snapshot()
        assert.deepEqual(current.primaryKeyColumns, [idColumn])
        assert.equal(current.columns.find(column => column.name === idColumn).autoIncrement, false)
        assertEmptyPlan(diff(current, schema))
      })
    }

    it(`rejects implicit numeric allocation for an opaque ID before producing DDL (${method})`, async () => {
      const schema = { structure: { id: { type: 'string', storage: { column: idColumn } } } }
      const expected = /Cannot create an implicit auto-increment column.*Declare primary: true/
      if (method === 'direct') await assert.rejects(create(schema), expected)
      else assert.throws(() => generateKnexMigration(tableName, schema, schemaOptions), expected)
      assert.equal(await db.schema.hasTable(tableName), false)
      if (method === 'direct') await createKnexTable(db, { tableName, idProperty: idColumn }, schema, { autoIncrement: false })
      else await loadMigration(generateKnexMigration(tableName, schema, { ...schemaOptions, autoIncrement: false })).up(db)
      await db(tableName).insert({ [idColumn]: 'caller-owned' })
      assert.equal((await db(tableName).first())[idColumn], 'caller-owned')
    })

    it(`preserves a BigInt default in executable DDL (${method})`, async () => {
      const schema = { structure: { epochMs: { type: 'epochMilliseconds', defaultTo: 9223372036854775807n } } }
      if (method === 'direct') await create(schema)
      else await loadMigration(generateKnexMigration(tableName, schema, schemaOptions)).up(db)
      await db(tableName).insert({ record_key: 1 })
      const row = await db(tableName).first(db.raw(`CAST(?? AS ${databaseClient === 'mysql2' ? 'CHAR' : 'TEXT'}) AS ??`, ['epoch_ms', 'stored']))
      assert.equal(row.stored, '9223372036854775807')
      assertEmptyPlan(diff(await snapshot(), schema))
    })

    it(`creates typed mapped columns and preserves static/function defaults (${method})`, async () => {
      let defaultCalls = 0
      const schema = tableSchema(() => { defaultCalls++; return 'runtime-only' })
      const migration = loadMigration(generateKnexMigration(tableName, schema, schemaOptions))
      if (method === 'direct') await create(schema)
      else await migration.up(db)
      await db(tableName).insert({ legacy_name: 'Stored', amount: '12.34', epoch_ms: '-1234567890123' })
      const row = await db(tableName).first()
      assert.equal(row.legacy_name, 'Stored')
      assert.equal(row.empty_text, '')
      assert.equal(row.quoted_text, "O'Brien")
      assert.equal(Number(row.enabled), 0)
      assert.equal(row.count, 0)
      assert.equal(Number(row.amount), 12.34)
      assert.equal(String(row.epoch_ms), '-1234567890123')
      assert.equal(row.runtime_label, null)
      assert.equal(defaultCalls, 0)
      const result = await snapshot()
      assert.equal(result.idColumn, idColumn)
      assert.deepEqual(result.primaryKeyColumns, [idColumn])
      const columns = Object.fromEntries(result.columns.map(column => [column.name, column]))
      assert.equal(columns[idColumn].autoIncrement, true)
      assert.equal(columns.legacy_name.maxLength, 80)
      assert.equal(columns.legacy_name.nullable, false)
      assert.equal(columns.count.typeKind, 'integer')
      assert.equal(columns.enabled.typeKind, 'boolean')
      assert.equal(columns.payload.typeKind, 'json')
      assert.equal(columns.bytes.typeKind, 'binary')
      assert.equal(columns.empty_text.hasDefault, true)
      assert.equal(columns.empty_text.defaultValue, '')
      assert.equal(columns.quoted_text.defaultValue, "O'Brien")
      assert.equal(columns.runtime_label.hasDefault, false)
      if (databaseClient !== 'better-sqlite3') {
        assert.equal(columns.amount.numericPrecision, 12)
        assert.equal(columns.amount.numericScale, 2)
        assert.equal(columns.observed_at.datetimePrecision, 3)
        assert.equal(columns.at_time.datetimePrecision, 6)
      } else {
        // Knex creates SQLite decimal columns as float, without precision metadata.
        assert.equal(columns.amount.dataType, 'float')
        assert.equal(columns.amount.numericPrecision, null)
        assert.equal(columns.amount.numericScale, null)
      }
      assert.deepEqual(result.indexes.map(index => [index.name, index.columns]), [['idx_schema_name_count', ['legacy_name', 'count']]])
      assert.equal(result.checkConstraints[0].name, 'ck_schema_count')
      if (method === 'generated') {
        await migration.down(db)
        assert.equal(await db.schema.hasTable(tableName), false)
      }
    })

    it(`generates no alterations for its own unchanged schema (${method})`, async () => {
      const schema = tableSchema()
      if (method === 'direct') await create(schema)
      else await loadMigration(generateKnexMigration(tableName, schema, schemaOptions)).up(db)
      assertEmptyPlan(diff(await snapshot(), schema))
    })
  }

  it('keeps quoted, padded and null-string defaults distinct from SQL null', async () => {
    const schema = {
      structure: {
        nullText: { type: 'string', defaultTo: 'null' },
        paddedText: { type: 'string', defaultTo: '  padded  ' },
        quotedText: { type: 'string', defaultTo: "'literal'" },
        explicitNull: { type: 'string', defaultTo: null },
        enabled: { type: 'boolean', defaultTo: true },
        amount: { type: 'number', precision: 12, scale: 2, defaultTo: 12.3 }
      }
    }
    await create(schema)
    await db(tableName).insert({ record_key: 1 })
    const row = await db(tableName).first()
    assert.equal(row.null_text, 'null')
    assert.equal(row.padded_text, '  padded  ')
    assert.equal(row.quoted_text, "'literal'")
    assert.equal(row.explicit_null, null)
    assert.equal(Number(row.enabled), 1)
    assert.equal(Number(row.amount), 12.3)
    assertEmptyPlan(diff(await snapshot(), schema))
  })

  it('introspects generated enum constraints without proposing a repeated alteration', async () => {
    const schema = { structure: { role: { type: 'string', enum: ['Owner', 'Member'], required: true, defaultTo: 'Member' } } }
    await create(schema)
    await db(tableName).insert({ record_key: 1 })
    assert.equal((await db(tableName).first()).role, 'Member')
    const result = await snapshot()
    assert.deepEqual(result.columns.find(column => column.name === 'role').enumValues, ['Owner', 'Member'], JSON.stringify(result.checkConstraints))
    assertEmptyPlan(diff(result, schema))
  })

  it('reports changed checks without attempting to add a duplicate constraint', async () => {
    const initial = { structure: { role: { type: 'string' } }, checkConstraints: [{ name: 'ck_schema_role', clause: "role <> 'Owner'" }] }
    await create(initial)
    const desired = { ...initial, checkConstraints: [{ ...initial.checkConstraints[0], clause: "role <> 'owner'" }] }
    const change = diff(await snapshot(), desired)
    assert.deepEqual(change.plan.addCheckConstraints, [])
    assert.ok(change.warnings.some(warning => /check constraint alteration.*ck_schema_role/.test(warning)))
    await loadMigration(change.migration).up(db)
    await assert.rejects(db(tableName).insert({ role: 'Owner' }))
  })

  it('executes enum changes on native databases and reports SQLite rebuild requirements', async () => {
    const initial = { structure: { role: { type: 'string', enum: ['Owner', 'Member'], defaultTo: 'Member' } } }
    await create(initial)
    await db(tableName).insert({ role: 'Member' })
    const desired = { structure: { role: { type: 'string', enum: ['Admin', 'Member'], defaultTo: 'Member' } } }
    const change = diff(await snapshot(), desired)
    if (databaseClient === 'better-sqlite3') {
      assert.deepEqual(change.plan.alterColumns, [])
      assert.ok(change.warnings.some(warning => /enum alteration.*role.*SQLite requires a table rebuild/.test(warning)))
      await loadMigration(change.migration).up(db)
      await assert.rejects(db(tableName).insert({ role: 'Admin' }))
      assert.deepEqual((await db(tableName)).map(row => row.role), ['Member'])
      return
    }
    await loadMigration(change.migration).up(db)
    await db(tableName).insert({ role: 'Admin' })
    assert.deepEqual((await db(tableName).orderBy(idColumn)).map(row => row.role), ['Member', 'Admin'])
    await assert.rejects(db(tableName).insert({ role: 'Owner' }))
    assertEmptyPlan(diff(await snapshot(), desired))
  })

  it('preserves a structured object default in native storage', async () => {
    const schema = { structure: { payload: { type: 'object', defaultTo: { enabled: true } } } }
    await create(schema)
    await db(tableName).insert({ record_key: 1 })
    const row = await db(tableName).first()
    assert.deepEqual(typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload, { enabled: true })
  })

  it('changes an enum default while retaining one existing check and all allowed values', async () => {
    const initial = { structure: { role: { type: 'string', enum: ['Owner', 'Member'], defaultTo: 'Member' } } }
    await create(initial)
    await db(tableName).insert({ record_key: 1 })
    const desired = { structure: { role: { ...initial.structure.role, defaultTo: 'Owner' } } }
    const change = diff(await snapshot(), desired)
    await loadMigration(change.migration).up(db)
    await db(tableName).insert({ record_key: 2 })
    assert.deepEqual((await db(tableName).orderBy(idColumn)).map(row => row.role), ['Member', 'Owner'])
    await assert.rejects(db(tableName).insert({ role: 'Invalid' }))
    assertEmptyPlan(diff(await snapshot(), desired))
    if (databaseClient === 'better-sqlite3') {
      const table = await db('sqlite_master').where({ type: 'table', name: tableName }).first('sql')
      assert.equal(table.sql.match(/\bCHECK\b/gi).length, 1)
    }
  })

  if (databaseClient !== 'better-sqlite3') {
    it('preserves existing values and constraints after rejected enum narrowing in a transaction', async () => {
      const initial = { structure: { role: { type: 'string', enum: ['Owner', 'Member'], defaultTo: 'Member' } } }
      await create(initial)
      await db(tableName).insert({ role: 'Owner' })
      const desired = { structure: { role: { type: 'string', enum: ['Admin', 'Member'], defaultTo: 'Member' } } }
      const change = diff(await snapshot(), desired)
      await assert.rejects(db.transaction(trx => loadMigration(change.migration).up(trx)), { code: databaseClient === 'pg' ? '23514' : 'WARN_DATA_TRUNCATED' })
      assert.deepEqual((await db(tableName)).map(row => row.role), ['Owner'])
      await assert.rejects(db(tableName).insert({ role: 'Admin' }))
      assertEmptyPlan(diff(await snapshot(), initial))
    })
  }

  if (databaseClient === 'pg') {
    it('reports a partial index instead of treating it as an ordinary index', async () => {
      await create({ structure: { label: { type: 'string' } } })
      await db.raw('CREATE INDEX partial_schema_label ON ?? (label) WHERE label IS NOT NULL', [tableName])
      await assert.rejects(snapshot, /partial_schema_label.*simple column-index snapshot/)
      assert.equal(await db.schema.hasTable(tableName), true)
    })
  }

  it('adds mapped fields with static defaults without evaluating function defaults', async () => {
    await create({ structure: { displayName: { type: 'string', maxLength: 80, required: true } } })
    await db(tableName).insert({ display_name: 'Existing' })
    let calls = 0
    await addKnexFields(db, tableName, {
      structure: {
        newLabel: { type: 'string', defaultTo: 'Added', storage: { column: 'mapped_label' } },
        computedLabel: { type: 'string', defaultTo: () => { calls++; return 'Not DDL' } }
      }
    })
    assert.deepEqual(await db(tableName).first(), { record_key: 1, display_name: 'Existing', mapped_label: 'Added', computed_label: null })
    assert.equal(calls, 0)
  })

  it('executes an additive diff and reaches an empty second diff with existing data', async () => {
    const initial = { structure: { label: { type: 'string', maxLength: 40, required: true } } }
    await create(initial)
    await db(tableName).insert({ label: 'Existing' })
    const desired = { structure: { ...initial.structure, count: { type: 'integer', defaultTo: 0 }, note: { type: 'string', defaultTo: "It's new" } } }
    const change = diff(await snapshot(), desired)
    assert.deepEqual(change.plan.addColumns.map(column => column.name), ['count', 'note'])
    assert.deepEqual(change.plan.alterColumns, [])
    await loadMigration(change.migration).up(db)
    assert.deepEqual(await db(tableName).first(), { record_key: 1, label: 'Existing', count: 0, note: "It's new" })
    assertEmptyPlan(diff(await snapshot(), desired))
  })

  if (databaseClient !== 'better-sqlite3') {
    it('executes a precision-only migration and preserves stored timestamps and times', async () => {
      const initial = { structure: { observedAt: { type: 'dateTime', temporalPrecision: 3 }, atTime: { type: 'time', temporalPrecision: 3 } } }
      await create(initial)
      await db(tableName).insert({ observed_at: '2024-02-29 23:59:59.987', at_time: '12:34:56.123' })
      const before = await db(tableName).first()
      const desired = { structure: { observedAt: { type: 'dateTime' }, atTime: { type: 'time' } } }
      const change = diff(await snapshot(), desired)
      assert.deepEqual(change.plan.alterColumns.map(column => column.name), ['at_time', 'observed_at'])
      await loadMigration(change.migration).up(db)
      assert.deepEqual(await db(tableName).first(), { ...before, at_time: databaseClient === 'mysql2' ? '12:34:56.123000' : '12:34:56.123' })
      const result = await snapshot()
      for (const name of ['at_time', 'observed_at']) assert.equal(result.columns.find(column => column.name === name).datetimePrecision, 6)
      assertEmptyPlan(diff(result, desired))
      const reduction = diff(result, initial)
      assert.ok(reduction.warnings.some(warning => /observed_at.*precision.*6.*3/.test(warning)))
    })
  }

  it('replaces a named foreign key before adding its changed definition', async () => {
    await createKnexTable(db, { tableName: 'schema_parents' }, { structure: { name: { type: 'string' } } })
    const initial = { structure: { parentId: { type: 'id' } }, foreignKeys: [{ name: 'fk_schema_parent', columns: ['parentId'], referencedTableName: 'schema_parents', referencedColumns: ['id'], deleteRule: 'RESTRICT', updateRule: 'RESTRICT' }] }
    await create(initial)
    await db('schema_parents').insert({ name: 'Parent' })
    await db(tableName).insert({ parent_id: 1 })
    const current = await snapshot()
    assert.deepEqual(current.foreignKeys[0].columns, [{ name: 'parent_id', referencedName: 'id' }])
    const desired = { ...initial, foreignKeys: [{ ...initial.foreignKeys[0], deleteRule: 'CASCADE' }] }
    const change = diff(current, desired)
    assert.deepEqual(change.plan.dropForeignKeys.map(key => key.name), ['fk_schema_parent'])
    assert.deepEqual(change.plan.addForeignKeys.map(key => key.name), ['fk_schema_parent'])
    await loadMigration(change.migration).up(db)
    assert.equal((await db(tableName)).length, 1)
    await db('schema_parents').where({ id: 1 }).delete()
    assert.equal((await db(tableName)).length, 0)
    assertEmptyPlan(diff(await snapshot(), desired))
  })
})
