import type { DetectedFile, ExpressFileOptions, FileDetector, FileDetectorRegistry, ParsedFiles } from '../../types/file-detectors.js'

const file: DetectedFile = { filename: 'photo.png', mimetype: 'image/png', size: 4, data: Buffer.from('data') }
const parsed: ParsedFiles = { fields: { title: 'Photo' }, files: { image: file } }
const detector: FileDetector = {
  name: 'custom',
  detect: async params => params.upload === true,
  parse: () => parsed
}
declare const registry: FileDetectorRegistry
registry.registerFileDetector(detector)
const builtin: ExpressFileOptions = { fileParser: 'busboy', fileParserOptions: { limits: { files: 2 } } }
const custom: ExpressFileOptions = {
  fileParser: async () => ({
    name: 'custom-express',
    detect: params => params._expressReq.headers['content-type'] === 'application/example',
    parse: async () => parsed
  })
}
void [builtin, custom]

// @ts-expect-error Detector decisions are booleans, not a parser name.
const invalidDetector: FileDetector = { name: 'invalid', detect: () => 'busboy', parse: () => parsed }
// @ts-expect-error A detector file carries a numeric byte size for configured limits.
const invalidSize: DetectedFile = { filename: 'photo.png', mimetype: 'image/png', size: '4' }
// @ts-expect-error Detected files need their MIME type for acceptance checks.
const missingMime: DetectedFile = { filename: 'photo.png', size: 4 }
// @ts-expect-error One file per field is the parser result contract.
const fileArray: ParsedFiles = { files: { image: [file] } }
// @ts-expect-error Only the two built-in parser names are supported.
const invalidParser: ExpressFileOptions = { fileParser: 'multer' }
// @ts-expect-error Factories must produce a complete detector.
const invalidFactory: ExpressFileOptions = { fileParser: () => ({ name: 'incomplete' }) }
void [invalidDetector, invalidSize, missingMime, fileArray, invalidParser, invalidFactory]
