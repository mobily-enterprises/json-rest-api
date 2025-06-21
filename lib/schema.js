import { stringify as serialize, parse as deserialize } from 'circular-json-es6';

/**
 * Schema class for validating and transforming data with plugin support
 */
export class Schema {
  constructor(structure = {}, options = {}) {
    this.structure = structure;
    this.options = options;
    this.plugins = [];
    this.types = new Map();
    this.params = new Map();
    this._initializeBuiltins();
    this._checkForUnlimitedObjects();
  }

  /**
   * Add a plugin to the schema
   */
  use(plugin, options = {}) {
    if (typeof plugin.install === 'function') {
      plugin.install(this, options);
    }
    this.plugins.push({ plugin, options });
    return this;
  }

  /**
   * Register a custom type handler
   */
  registerType(name, handler) {
    this.types.set(name, handler);
    return this;
  }

  /**
   * Register a custom parameter handler
   */
  registerParam(name, handler) {
    this.params.set(name, handler);
    return this;
  }

  /**
   * Initialize built-in types and parameters
   */
  _initializeBuiltins() {
    // Built-in types
    this.registerType('none', this._noneType);
    this.registerType('string', this._stringType);
    this.registerType('blob', this._blobType);
    this.registerType('number', this._numberType);
    this.registerType('timestamp', this._timestampType);
    this.registerType('dateTime', this._dateTimeType);
    this.registerType('date', this._dateType);
    this.registerType('array', this._arrayType);
    this.registerType('object', this._objectType);
    this.registerType('serialize', this._serializeType);
    this.registerType('boolean', this._booleanType);
    this.registerType('id', this._idType);

    // Built-in parameters
    this.registerParam('required', this._requiredParam);
    this.registerParam('min', this._minParam);
    this.registerParam('max', this._maxParam);
    this.registerParam('validator', this._validatorParam);
    this.registerParam('uppercase', this._uppercaseParam);
    this.registerParam('lowercase', this._lowercaseParam);
    this.registerParam('trim', this._trimParam);
    this.registerParam('length', this._lengthParam);
    this.registerParam('default', this._defaultParam);
    this.registerParam('notEmpty', this._notEmptyParam);
    this.registerParam('enum', this._enumParam);
    
    // Size limit parameters
    this.registerParam('maxItems', this._maxItemsParam);
    this.registerParam('maxKeys', this._maxKeysParam);
    this.registerParam('maxDepth', this._maxDepthParam);
    
    // Format validation parameter
    this.registerParam('format', this._formatParam);
  }

  /**
   * Validate an object against the schema
   */
  async validate(object, options = {}) {
    const errors = [];
    const validatedObject = { ...object };

    // Check for unknown fields unless we're only validating object values
    if (!options.onlyObjectValues) {
      for (const fieldName in object) {
        if (!this.structure[fieldName]) {
          errors.push({
            field: fieldName,
            message: 'Field not allowed',
            code: 'FIELD_NOT_ALLOWED'
          });
        }
      }
    }

    // Determine target object for validation
    const targetObject = options.onlyObjectValues ? object : this.structure;

    for (const fieldName in targetObject) {
      const definition = this.structure[fieldName];
      if (!definition) continue;

      let skipCast = false;
      let skipParams = false;

      // Get field options
      const canBeNull = this._getCanBeNull(definition, options);
      const emptyAsNull = this._getEmptyAsNull(definition, options);

      // Handle required fields
      if (definition.required && object[fieldName] === undefined && !options.partial) {
        if (!this._skipParam('required', options.skipParams, fieldName)) {
          const errorMessage = definition.requiredErrorMessage || 
                             definition.errorMessage || 
                             'Field required';
          errors.push({
            field: fieldName,
            message: errorMessage,
            code: 'FIELD_REQUIRED'
          });
          skipParams = true;
        }
      }

      // Skip casting if not required and undefined
      if (!definition.required && object[fieldName] === undefined) {
        skipCast = true;
      }

      // Handle empty strings
      if (String(object[fieldName]) === '' && emptyAsNull) {
        validatedObject[fieldName] = null;
        skipParams = true;
      }

      // Handle null values
      if (object[fieldName] === null) {
        if (!canBeNull) {
          const errorMessage = definition.nullErrorMessage || 
                             definition.errorMessage || 
                             'Field cannot be null';
          errors.push({
            field: fieldName,
            message: errorMessage,
            code: 'FIELD_CANNOT_BE_NULL'
          });
        }
        skipParams = true;
      }

      // Type casting
      if (!skipCast && !skipParams && this.types.has(definition.type)) {
        try {
          const typeHandler = this.types.get(definition.type);
          const result = await typeHandler.call(this, {
            definition,
            value: object[fieldName],
            fieldName,
            object: validatedObject,
            objectBeforeCast: object,
            valueBeforeCast: object[fieldName],
            options,
            computedOptions: { canBeNull, emptyAsNull }
          });
          if (result !== undefined) {
            validatedObject[fieldName] = result;
          }
        } catch (error) {
          const errorMessage = definition.errorMessage || 
                             definition.castErrorMessage || 
                             error.message || 
                             'Type casting failed';
          errors.push({
            field: fieldName,
            message: errorMessage,
            code: 'TYPE_ERROR'
          });
        }
      }

      // Parameter validation
      if (!skipParams) {
        for (const paramName in definition) {
          if (paramName === 'type' || 
              this._skipParam(paramName, options.skipParams, fieldName)) {
            continue;
          }

          if (this.params.has(paramName)) {
            try {
              const paramHandler = this.params.get(paramName);
              const result = await paramHandler.call(this, {
                definition,
                value: validatedObject[fieldName],
                fieldName,
                object: validatedObject,
                objectBeforeCast: object,
                valueBeforeCast: object[fieldName],
                parameterName: paramName,
                parameterValue: definition[paramName],
                options,
                computedOptions: { canBeNull, emptyAsNull }
              });
              if (result !== undefined) {
                validatedObject[fieldName] = result;
              }
            } catch (error) {
              // Support parameter-specific error messages
              const paramErrorKey = `${paramName}ErrorMessage`;
              const errorMessage = definition[paramErrorKey] || 
                                 definition.errorMessage || 
                                 error.message || 
                                 'Parameter validation failed';
              errors.push({
                field: fieldName,
                message: errorMessage,
                code: 'PARAM_ERROR'
              });
            }
          }
        }
      }
    }

    return { validatedObject, errors };
  }

  /**
   * Clean up an object to only include fields with a specific parameter
   */
  cleanup(object, parameterName) {
    const cleanedObject = {};
    for (const key in object) {
      if (this.structure[key] && this.structure[key][parameterName]) {
        cleanedObject[key] = object[key];
      }
    }
    return cleanedObject;
  }

  /**
   * Helper method to validate with onlyObjectValues option
   * Useful for partial updates
   */
  async validatePartial(object, options = {}) {
    return this.validate(object, { ...options, onlyObjectValues: true });
  }

  // Built-in type handlers
  _noneType({ value }) {
    return value;
  }

  _stringType({ value, definition }) {
    if (value === undefined || value === null) return '';
    if (typeof value.toString !== 'function') {
      throw new Error('Cannot cast to string');
    }
    const str = value.toString();
    return definition.noTrim ? str : str.trim();
  }

  _blobType({ value }) {
    return value;
  }

  _numberType({ value }) {
    if (value === undefined) return 0;
    const num = Number(value);
    if (isNaN(num)) {
      throw new Error('Invalid number');
    }
    return num;
  }

  _timestampType({ value, computedOptions }) {
    const num = Number(value);
    if (isNaN(num)) {
      throw new Error('Invalid timestamp');
    }
    if (!num && computedOptions.canBeNull) return null;
    return num;
  }

  _dateTimeType({ value }) {
    if (!value) return null;
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      throw new Error('Invalid date');
    }
    return date.toISOString().slice(0, 19).replace('T', ' ');
  }

  _dateType(params) {
    const result = this._dateTimeType(params);
    return result ? result.slice(0, 10) : result;
  }

  _arrayType({ value }) {
    return Array.isArray(value) ? value : [value];
  }

  _objectType({ value }) {
    return value;
  }

  _serializeType({ value }) {
    try {
      return serialize(value);
    } catch (error) {
      throw new Error('Serialization failed');
    }
  }

  _booleanType({ value, definition }) {
    if (typeof value === 'string') {
      const falseValue = definition.stringFalseWhen || 'false';
      const trueValue = definition.stringTrueWhen || 'true';
      if (value === falseValue) return false;
      if (value === trueValue || value === 'on') return true;
      return false;
    }
    return !!value;
  }

  _idType({ value }) {
    const num = parseInt(value, 10);
    if (isNaN(num)) {
      throw new Error('Invalid ID');
    }
    return num;
  }

  // Built-in parameter handlers
  _requiredParam({ value, fieldName }) {
    if (value === undefined || value === null) {
      throw new Error(`${fieldName} is required`);
    }
  }

  _minParam({ value, parameterValue, definition, fieldName }) {
    if (value === undefined) return;
    if (definition.type === 'number' && value < parameterValue) {
      const errorMessage = definition.minErrorMessage || 
                         definition.errorMessage || 
                         `${fieldName} is too low`;
      throw new Error(errorMessage);
    }
    if (definition.type === 'string' && value.length < parameterValue) {
      const errorMessage = definition.minErrorMessage || 
                         definition.errorMessage || 
                         `${fieldName} is too short`;
      throw new Error(errorMessage);
    }
    if (definition.type === 'array' && value.length < parameterValue) {
      const errorMessage = definition.minErrorMessage || 
                         definition.errorMessage || 
                         `${fieldName} must have at least ${parameterValue} items`;
      throw new Error(errorMessage);
    }
  }

  _maxParam({ value, parameterValue, definition, fieldName }) {
    if (value === undefined) return;
    if (definition.type === 'number' && value > parameterValue) {
      const errorMessage = definition.maxErrorMessage || 
                         definition.errorMessage || 
                         `${fieldName} is too high`;
      throw new Error(errorMessage);
    }
    if (definition.type === 'string' && value.length > parameterValue) {
      const errorMessage = definition.maxErrorMessage || 
                         definition.errorMessage || 
                         `${fieldName} is too long`;
      throw new Error(errorMessage);
    }
    if (definition.type === 'array' && value.length > parameterValue) {
      const errorMessage = definition.maxErrorMessage || 
                         definition.errorMessage || 
                         `${fieldName} must have at most ${parameterValue} items`;
      throw new Error(errorMessage);
    }
  }

  _validatorParam({ parameterValue, value, object, fieldName, definition }) {
    if (typeof parameterValue !== 'function') {
      throw new Error('Validator must be a function');
    }
    
    // Support custom validator with custom error message
    const validatorResult = parameterValue(value, object, { 
      schema: this, 
      fieldName,
      definition 
    });
    
    // Handle different return types
    if (validatorResult === false) {
      // Use custom error message if provided
      const errorMessage = definition.validatorMessage || 
                          definition.errorMessage || 
                          `Validation failed for ${fieldName}`;
      throw new Error(errorMessage);
    } else if (typeof validatorResult === 'string') {
      // Validator returned a custom error message
      throw new Error(validatorResult);
    } else if (validatorResult instanceof Error) {
      throw validatorResult;
    }
    // If result is true or undefined, validation passed
  }

  _uppercaseParam({ value, definition }) {
    if (definition.type === 'string' && typeof value === 'string') {
      return value.toUpperCase();
    }
  }

  _lowercaseParam({ value, definition }) {
    if (definition.type === 'string' && typeof value === 'string') {
      return value.toLowerCase();
    }
  }

  _trimParam({ value, parameterValue, definition, fieldName, valueBeforeCast }) {
    if (definition.type === 'string' && typeof value === 'string') {
      return value.slice(0, parameterValue);
    }
    if (Number.isInteger(Number(valueBeforeCast)) && 
        String(Number(valueBeforeCast)).length > parameterValue) {
      throw new Error(`${fieldName} out of range`);
    }
  }

  _lengthParam(params) {
    return this._trimParam(params);
  }

  _defaultParam({ valueBeforeCast, parameterValue, object, fieldName, definition }) {
    if (valueBeforeCast === undefined) {
      if (typeof parameterValue === 'function') {
        // Pass context to default function for conditional defaults
        return parameterValue({
          object,
          fieldName,
          definition,
          schema: this
        });
      }
      return parameterValue;
    }
  }

  _notEmptyParam({ valueBeforeCast, parameterValue, fieldName, definition }) {
    const str = valueBeforeCast?.toString ? valueBeforeCast.toString() : '';
    if (parameterValue && valueBeforeCast !== undefined && str === '') {
      const errorMessage = definition.notEmptyErrorMessage || 
                         definition.errorMessage || 
                         `${fieldName} cannot be empty`;
      throw new Error(errorMessage);
    }
  }

  _enumParam({ value, parameterValue, fieldName, definition }) {
    if (!Array.isArray(parameterValue)) {
      throw new Error(`enum parameter for ${fieldName} must be an array`);
    }
    
    if (value !== undefined && value !== null && !parameterValue.includes(value)) {
      const errorMessage = definition.enumErrorMessage || 
                         definition.errorMessage || 
                         `${fieldName} must be one of: ${parameterValue.join(', ')}`;
      throw new Error(errorMessage);
    }
  }

  _maxItemsParam({ value, parameterValue, fieldName, definition }) {
    if (definition.type !== 'array' || !Array.isArray(value)) return;
    
    if (value.length > parameterValue) {
      const errorMessage = definition.maxItemsErrorMessage || 
                         definition.errorMessage || 
                         `${fieldName} cannot have more than ${parameterValue} items`;
      throw new Error(errorMessage);
    }
  }

  _maxKeysParam({ value, parameterValue, fieldName, definition }) {
    if (definition.type !== 'object' || typeof value !== 'object' || value === null) return;
    
    const keyCount = Object.keys(value).length;
    if (keyCount > parameterValue) {
      const errorMessage = definition.maxKeysErrorMessage || 
                         definition.errorMessage || 
                         `${fieldName} cannot have more than ${parameterValue} keys`;
      throw new Error(errorMessage);
    }
  }

  _maxDepthParam({ value, parameterValue, fieldName, definition }) {
    if (definition.type !== 'object' || typeof value !== 'object' || value === null) return;
    
    const getDepth = (obj, currentDepth = 0) => {
      if (typeof obj !== 'object' || obj === null) return currentDepth;
      
      // Arrays don't increase depth, only objects do
      if (Array.isArray(obj)) {
        let maxDepth = currentDepth;
        for (const item of obj) {
          const depth = getDepth(item, currentDepth);
          maxDepth = Math.max(maxDepth, depth);
        }
        return maxDepth;
      }
      
      // For objects, increase depth
      let maxDepth = currentDepth;
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          const depth = getDepth(obj[key], currentDepth + 1);
          maxDepth = Math.max(maxDepth, depth);
        }
      }
      return maxDepth;
    };
    
    const depth = getDepth(value);
    if (depth > parameterValue) {
      const errorMessage = definition.maxDepthErrorMessage || 
                         definition.errorMessage || 
                         `${fieldName} cannot be nested deeper than ${parameterValue} levels`;
      throw new Error(errorMessage);
    }
  }

  // Helper methods
  _skipParam(param, skipParams, field) {
    if (!skipParams || typeof skipParams !== 'object') return false;
    const fieldSkips = skipParams[field];
    return Array.isArray(fieldSkips) && fieldSkips.includes(param);
  }

  _getCanBeNull(definition, options) {
    if (definition.default === null) return true;
    if (typeof definition.canBeNull !== 'undefined') return definition.canBeNull;
    if (typeof options.canBeNull !== 'undefined') return !!options.canBeNull;
    return false;
  }

  _getEmptyAsNull(definition, options) {
    if (typeof definition.emptyAsNull !== 'undefined') return definition.emptyAsNull;
    if (typeof options.emptyAsNull !== 'undefined') return !!options.emptyAsNull;
    return false;
  }

  _checkForUnlimitedObjects() {
    for (const [fieldName, definition] of Object.entries(this.structure)) {
      if (definition.type === 'object' && 
          !definition.maxKeys && 
          !definition.maxDepth && 
          !definition.disabled) {
        console.warn(
          `⚠️  WARNING: Field '${fieldName}' is type 'object' without size limits.\n` +
          `   Consider adding maxKeys and/or maxDepth to prevent DoS attacks:\n` +
          `   ${fieldName}: { type: 'object', maxKeys: 100, maxDepth: 5 }`
        );
      }
      
      if (definition.type === 'array' && 
          !definition.maxItems && 
          !definition.disabled) {
        console.warn(
          `⚠️  WARNING: Field '${fieldName}' is type 'array' without maxItems limit.\n` +
          `   Consider adding maxItems to prevent DoS attacks:\n` +
          `   ${fieldName}: { type: 'array', maxItems: 1000 }`
        );
      }
    }
  }
  
  /**
   * Format validation using safe regex patterns
   */
  async _formatParam(context) {
    const { value, parameterValue: format } = context;
    if (value === null || value === undefined) return true;
    
    // Import safe patterns dynamically
    const { SafePatterns } = await import('./safe-regex.js');
    
    const stringValue = String(value);
    
    switch (format) {
      case 'email':
        if (!SafePatterns.email.test(stringValue)) {
          throw new Error(`Invalid email format`);
        }
        break;
        
      case 'url':
        if (!SafePatterns.url.test(stringValue)) {
          throw new Error(`Invalid URL format`);
        }
        break;
        
      case 'uuid':
        if (!SafePatterns.uuid.test(stringValue)) {
          throw new Error(`Invalid UUID format`);
        }
        break;
        
      case 'alphanumeric':
        if (!SafePatterns.alphanumeric.test(stringValue)) {
          throw new Error(`Value must be alphanumeric`);
        }
        break;
        
      case 'slug':
        if (!SafePatterns.slug.test(stringValue)) {
          throw new Error(`Invalid slug format (use letters, numbers, and hyphens)`);
        }
        break;
        
      case 'date':
        if (!SafePatterns.date.test(stringValue)) {
          throw new Error(`Invalid date format (use YYYY-MM-DD)`);
        }
        break;
        
      case 'time':
        if (!SafePatterns.time.test(stringValue)) {
          throw new Error(`Invalid time format (use HH:MM or HH:MM:SS)`);
        }
        break;
        
      case 'phone':
        if (!SafePatterns.phone.test(stringValue)) {
          throw new Error(`Invalid phone number format`);
        }
        break;
        
      case 'postalCode':
        if (!SafePatterns.postalCode.test(stringValue)) {
          throw new Error(`Invalid postal code format`);
        }
        break;
        
      default:
        console.warn(`Unknown format: ${format}`);
    }
    
    return true;
  }
}