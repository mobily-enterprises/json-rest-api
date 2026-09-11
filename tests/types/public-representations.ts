import type {
  CollectionResult, InputResourceIdentifier, ResourceIdentifier,
  SingleResourceResult, WriteResult
} from '../../types/representations.js'

interface Fields { name: string; revision: string; parent: { id: string } | null }
const input: InputResourceIdentifier<'items'> = { type: 'items', id: 42 }
const output: ResourceIdentifier<'items'> = { type: 'items', id: String(input.id) }
const plain: SingleResourceResult<'plain', Fields> = { id: output.id, name: 'Name' }
const document: SingleResourceResult<'jsonapi', Fields, 'items'> = { data: { ...output, attributes: { name: 'Name' } } }
const collection: CollectionResult<'plain', Fields> = { data: [plain], meta: { total: 1 } }
const jsonCollection: CollectionResult<'jsonapi', Fields, 'items'> = { data: [document.data] }
const minimal: WriteResult<'plain', 'minimal', Fields, 'items'> = output
const minimalDocument: WriteResult<'jsonapi', 'minimal', Fields, 'items'> = { data: output }
const nothing: WriteResult<'plain', 'none', Fields> = undefined
void [collection, jsonCollection, minimalDocument, nothing]

// @ts-expect-error Output IDs are normalized strings, unlike input IDs.
const numericOutput: ResourceIdentifier = { type: 'items', id: 42 }
// @ts-expect-error Plain query results retain a data envelope.
const bareCollection: CollectionResult<'plain', Fields> = [plain]
// @ts-expect-error Minimal responses do not promise attributes.
minimal.name
// @ts-expect-error No-return writes cannot yield a record.
const unexpectedRecord: WriteResult<'jsonapi', 'none'> = document
// @ts-expect-error Sparse fieldsets can omit a declared property.
const requiredName: string = plain.name
// @ts-expect-error JSON:API responses require the selected resource type.
const wrongType: SingleResourceResult<'jsonapi', Fields, 'items'> = { data: { type: 'groups', id: '1' } }
// @ts-expect-error Removed representation aliases are not public formats.
type RemovedFormat = SingleResourceResult<'simplified', Fields>
void [numericOutput, bareCollection, unexpectedRecord, requiredName, wrongType]
