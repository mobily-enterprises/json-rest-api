import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import knexLib from 'knex'
import { getDatabaseInfo } from '../plugins/core/lib/querying-writing/database-capabilities.js'
import { applyDatabaseReadOptions } from '../plugins/core/lib/querying-writing/database-value-normalizers.js'
import { inListLimit, rememberInPredicateConversionThreshold, splitLongInLists } from '../plugins/core/lib/querying/in-lists.js'

// How a locking read on MariaDB sends an IN list of the server's
// in_predicate_conversion_threshold values or more (see in-lists.js), compiled
// without a server: the same rows, as an OR of lists below the threshold.
const values = count => Array.from({ length: count }, (_, index) => index + 1)
const lists = sql => [...sql.matchAll(/`?(\w+)`? in \(([^()]*)\)/g)].map(([, column, list]) => `${column}:${list.split(',').length}`)

describe('Long IN lists in locking reads', () => {
  const mariadb = () => {
    const knex = knexLib({ client: 'mysql2' })
    rememberInPredicateConversionThreshold(knex, 1000)
    return knex
  }

  it('reads MariaDB\'s threshold as it starts, and keeps it for the connection\'s queries', async () => {
    const knex = knexLib({ client: 'mysql2' })
    const database = {
      client: knex.client,
      raw: sql => sql,
      first: async sql => sql.includes('VERSION()') ? { version: '11.4.13-MariaDB', maxAllowedPacket: 16777216 } : { threshold: 500 }
    }
    assert.deepEqual(await getDatabaseInfo(database), { client: 'MySQL', version: '11.4.13-MariaDB', maxAllowedPacket: 16777216, inPredicateConversionThreshold: 500 })
    assert.equal(inListLimit(knex), 499)
    assert.equal(inListLimit(knex('t')), 499)
    // MySQL keeps every list a list; a threshold of 0 converts none.
    const mysql = knexLib({ client: 'mysql2' })
    assert.deepEqual(await getDatabaseInfo({ client: mysql.client, raw: sql => sql, first: async () => ({ version: '8.4.13', maxAllowedPacket: 1024 }) }), { client: 'MySQL', version: '8.4.13', maxAllowedPacket: 1024 })
    assert.equal(inListLimit(mysql), Infinity)
    rememberInPredicateConversionThreshold(mysql, 0)
    assert.equal(inListLimit(mysql), Infinity)
  })

  it('sends a long list as an OR of lists below the threshold, and a NOT IN as the matching AND', () => {
    const knex = mariadb()
    const query = knex('t').where('a', 1).whereIn('b', values(2500)).orWhereNotIn('c', values(1000)).whereIn('d', values(999)).forUpdate()
    splitLongInLists(query, knex)
    const { sql, bindings } = query.toSQL()
    assert.deepEqual(lists(sql), ['b:999', 'b:999', 'b:502', 'c:999', 'c:1', 'd:999'])
    assert.match(sql, /^select \* from `t` where `a` = \? and \(`b` in \([?, ]+\) or `b` in \([?, ]+\) or `b` in \([?, ]+\)\) or not \(`c` in \([?, ]+\) or `c` in \([?, ]+\)\) and `d` in \([?, ]+\) for update$/)
    assert.deepEqual(bindings, [1, ...values(2500), ...values(1000), ...values(999)])
  })

  it('counts a tuple list by its values, splits lists in parenthesised groups, and leaves a nested SELECT\'s alone', () => {
    const knex = mariadb()
    const pairs = values(600).map(value => [value, value + 1])
    const query = knex('t')
      .whereIn(['a', 'b'], pairs)
      .where(group => group.whereIn('c', values(1500)).orWhere('d', 2))
      .whereIn('e', knex('u').select('e').whereIn('f', values(1200)))
      .forShare()
    splitLongInLists(query, knex)
    const { sql } = query.toSQL()
    assert.equal((sql.match(/\(`a`, `b`\) in/g) || []).length, 2, sql)
    assert.equal((sql.match(/`c` in/g) || []).length, 2, sql)
    assert.equal((sql.match(/`f` in/g) || []).length, 1, sql)
    assert.deepEqual(query.toSQL().bindings, [...pairs.flat(), ...values(1500), 2, ...values(1200)])
  })

  it('splits a locking read\'s lists as it is sent, and leaves plain reads and servers with no threshold as they are', () => {
    const knex = mariadb()
    const sent = query => lists(applyDatabaseReadOptions(query).toSQL().sql).length
    assert.equal(sent(knex('t').whereIn('a', values(1000)).forShare()), 2)
    assert.equal(sent(knex('t').whereIn('a', values(1000))), 1)
    const unknown = knexLib({ client: 'mysql2' })
    assert.equal(sent(unknown('t').whereIn('a', values(1000)).forUpdate()), 1)
  })
})
