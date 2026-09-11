// Internal declaration for the error class used by checked code in hooked-api 1.0.24.
declare module 'hooked-api' {
  export class HookedApiError extends Error {
    constructor(message: string, code?: string)
    code: string
  }
}
