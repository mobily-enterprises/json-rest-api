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
  }

  /**
   * Validate an object against the schema
   */
  async validate(object, options = {}) {
    const errors = [];
    const validatedObject = { ...object };

    // Check for unknown fields
    for (const fieldName in object) {
      if (!this.structure[fieldName]) {
        errors.push({
          field: fieldName,
          message: 'Field not allowed',
          code: 'FIELD_NOT_ALLOWED'
        });
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
      if (definition.required && object[fieldName] === undefined) {
        if (!this._skipParam('required', options.skipParams, fieldName)) {
          errors.push({
            field: fieldName,
            message: 'Field required',
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
          errors.push({
            field: fieldName,
            message: 'Field cannot be null',
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
          errors.push({
            field: fieldName,
            message: error.message || 'Type casting failed',
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
              errors.push({
                field: fieldName,
                message: error.message || 'Parameter validation failed',
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
      throw new Error(`${fieldName} is too low`);
    }
    if (definition.type === 'string' && value.length < parameterValue) {
      throw new Error(`${fieldName} is too short`);
    }
  }

  _maxParam({ value, parameterValue, definition, fieldName }) {
    if (value === undefined) return;
    if (definition.type === 'number' && value > parameterValue) {
      throw new Error(`${fieldName} is too high`);
    }
    if (definition.type === 'string' && value.length > parameterValue) {
      throw new Error(`${fieldName} is too long`);
    }
  }

  _validatorParam({ parameterValue, value, object, fieldName }) {
    if (typeof parameterValue !== 'function') {
      throw new Error('Validator must be a function');
    }
    const result = parameterValue(value, object, { schema: this, fieldName });
    if (typeof result === 'string') {
      throw new Error(result);
    }
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

  _defaultParam({ valueBeforeCast, parameterValue }) {
    if (valueBeforeCast === undefined) {
      return typeof parameterValue === 'function' ? parameterValue() : parameterValue;
    }
  }

  _notEmptyParam({ valueBeforeCast, parameterValue, fieldName }) {
    const str = valueBeforeCast?.toString ? valueBeforeCast.toString() : '';
    if (parameterValue && valueBeforeCast !== undefined && str === '') {
      throw new Error(`${fieldName} cannot be empty`);
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
}