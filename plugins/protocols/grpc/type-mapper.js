export class TypeMapper {
  constructor(options = {}) {
    this.strictTypes = options.strictTypes || false;
    this.dateFormat = options.dateFormat || 'ISO8601';
  }

  // Convert JSON API format to gRPC format
  jsonApiToGrpc(jsonApiData, schema) {
    if (!jsonApiData) return null;
    
    const grpcObject = {
      id: jsonApiData.id
    };
    
    // Map attributes
    if (jsonApiData.attributes) {
      for (const [key, value] of Object.entries(jsonApiData.attributes)) {
        const fieldDef = schema.structure?.[key] || schema.fields?.[key];
        if (fieldDef) {
          grpcObject[this.toSnakeCase(key)] = this.convertToGrpcType(value, fieldDef);
        }
      }
    }
    
    // Map relationships (as IDs for now)
    if (jsonApiData.relationships) {
      for (const [key, rel] of Object.entries(jsonApiData.relationships)) {
        if (rel.data) {
          if (Array.isArray(rel.data)) {
            grpcObject[`${this.toSnakeCase(key)}_ids`] = rel.data.map(r => r.id);
          } else {
            grpcObject[`${this.toSnakeCase(key)}_id`] = rel.data.id;
          }
        }
      }
    }
    
    return grpcObject;
  }

  // Convert gRPC format to JSON API format
  grpcToJsonApi(grpcData, schema) {
    if (!grpcData) return null;
    
    const attributes = {};
    const relationships = {};
    
    for (const [key, value] of Object.entries(grpcData)) {
      if (key === 'id') continue;
      
      const camelKey = this.toCamelCase(key);
      const fieldDef = schema.structure?.[camelKey] || schema.fields?.[camelKey];
      
      if (key.endsWith('_id') && !fieldDef) {
        // This is a relationship ID
        const relName = this.toCamelCase(key.replace(/_id$/, ''));
        relationships[relName] = {
          data: { type: relName, id: value }
        };
      } else if (key.endsWith('_ids') && !fieldDef) {
        // This is a to-many relationship
        const relName = this.toCamelCase(key.replace(/_ids$/, ''));
        relationships[relName] = {
          data: value.map(id => ({ type: relName, id }))
        };
      } else if (fieldDef) {
        attributes[camelKey] = this.convertFromGrpcType(value, fieldDef);
      }
    }
    
    const result = {
      type: schema.name || 'resource',
      attributes
    };
    
    if (grpcData.id) {
      result.id = grpcData.id;
    }
    
    if (Object.keys(relationships).length > 0) {
      result.relationships = relationships;
    }
    
    return result;
  }

  // Convert value to gRPC-compatible type
  convertToGrpcType(value, fieldDef) {
    if (value === null || value === undefined) {
      return this.getDefaultValue(fieldDef);
    }
    
    switch (fieldDef.type) {
      case 'string':
      case 'id':
        return String(value);
      
      case 'number':
      case 'float':
        return parseFloat(value) || 0;
      
      case 'integer':
        return parseInt(value, 10) || 0;
      
      case 'boolean':
        return Boolean(value);
      
      case 'date':
      case 'timestamp':
        return this.dateToTimestamp(value);
      
      case 'array':
        if (!Array.isArray(value)) return [];
        if (fieldDef.items) {
          return value.map(item => this.convertToGrpcType(item, fieldDef.items));
        }
        return value;
      
      case 'object':
        if (this.strictTypes) {
          // In strict mode, we need a defined structure
          throw new Error(`Cannot convert dynamic object field: ${fieldDef.name}`);
        }
        return this.objectToStruct(value);
      
      case 'blob':
      case 'binary':
        return this.toBuffer(value);
      
      default:
        return value;
    }
  }

  // Convert from gRPC type to JS type
  convertFromGrpcType(value, fieldDef) {
    if (value === null || value === undefined) {
      return fieldDef.default || null;
    }
    
    switch (fieldDef.type) {
      case 'date':
      case 'timestamp':
        return this.timestampToDate(value);
      
      case 'object':
        return this.structToObject(value);
      
      case 'blob':
      case 'binary':
        return this.fromBuffer(value);
      
      case 'array':
        if (!Array.isArray(value)) return [];
        if (fieldDef.items) {
          return value.map(item => this.convertFromGrpcType(item, fieldDef.items));
        }
        return value;
      
      default:
        return value;
    }
  }

  // Get default value for a field type
  getDefaultValue(fieldDef) {
    if (fieldDef.default !== undefined) {
      return fieldDef.default;
    }
    
    switch (fieldDef.type) {
      case 'string':
      case 'id':
        return '';
      case 'number':
      case 'float':
      case 'integer':
        return 0;
      case 'boolean':
        return false;
      case 'array':
        return [];
      case 'object':
        return {};
      default:
        return null;
    }
  }

  // Date/timestamp conversions
  dateToTimestamp(value) {
    if (!value) return null;
    
    const date = value instanceof Date ? value : new Date(value);
    
    return {
      seconds: Math.floor(date.getTime() / 1000),
      nanos: (date.getTime() % 1000) * 1000000
    };
  }

  timestampToDate(timestamp) {
    if (!timestamp) return null;
    
    if (timestamp.seconds !== undefined) {
      // Google protobuf Timestamp
      const ms = (timestamp.seconds * 1000) + (timestamp.nanos / 1000000);
      return new Date(ms);
    }
    
    // Try parsing as string
    return new Date(timestamp);
  }

  // Object/Struct conversions
  objectToStruct(obj) {
    if (!obj || typeof obj !== 'object') return null;
    
    const fields = {};
    
    for (const [key, value] of Object.entries(obj)) {
      fields[key] = this.valueToStructValue(value);
    }
    
    return { fields };
  }

  structToObject(struct) {
    if (!struct || !struct.fields) return {};
    
    const obj = {};
    
    for (const [key, value] of Object.entries(struct.fields)) {
      obj[key] = this.structValueToValue(value);
    }
    
    return obj;
  }

  valueToStructValue(value) {
    if (value === null) {
      return { null_value: 0 };
    } else if (typeof value === 'number') {
      return { number_value: value };
    } else if (typeof value === 'string') {
      return { string_value: value };
    } else if (typeof value === 'boolean') {
      return { bool_value: value };
    } else if (Array.isArray(value)) {
      return {
        list_value: {
          values: value.map(v => this.valueToStructValue(v))
        }
      };
    } else if (typeof value === 'object') {
      return {
        struct_value: this.objectToStruct(value)
      };
    }
    
    return { null_value: 0 };
  }

  structValueToValue(structValue) {
    if (structValue.null_value !== undefined) {
      return null;
    } else if (structValue.number_value !== undefined) {
      return structValue.number_value;
    } else if (structValue.string_value !== undefined) {
      return structValue.string_value;
    } else if (structValue.bool_value !== undefined) {
      return structValue.bool_value;
    } else if (structValue.list_value !== undefined) {
      return structValue.list_value.values.map(v => this.structValueToValue(v));
    } else if (structValue.struct_value !== undefined) {
      return this.structToObject(structValue.struct_value);
    }
    
    return null;
  }

  // Buffer conversions
  toBuffer(value) {
    if (Buffer.isBuffer(value)) {
      return value;
    } else if (typeof value === 'string') {
      return Buffer.from(value, 'base64');
    } else if (value instanceof Uint8Array) {
      return Buffer.from(value);
    }
    
    return Buffer.alloc(0);
  }

  fromBuffer(buffer) {
    if (!buffer) return null;
    
    if (Buffer.isBuffer(buffer)) {
      return buffer.toString('base64');
    } else if (buffer instanceof Uint8Array) {
      return Buffer.from(buffer).toString('base64');
    }
    
    return null;
  }

  // Case conversions
  toSnakeCase(str) {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`).replace(/^_/, '');
  }

  toCamelCase(str) {
    return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  }

  // Validate if a value can be converted
  canConvert(value, fieldDef) {
    try {
      this.convertToGrpcType(value, fieldDef);
      return true;
    } catch (error) {
      return false;
    }
  }

  // Get proto type name for a schema field
  getProtoTypeName(fieldDef) {
    switch (fieldDef.type) {
      case 'string':
      case 'id':
        return 'string';
      case 'number':
      case 'float':
        return 'double';
      case 'integer':
        return 'int32';
      case 'boolean':
        return 'bool';
      case 'date':
      case 'timestamp':
        return 'google.protobuf.Timestamp';
      case 'array':
        return fieldDef.items ? `repeated ${this.getProtoTypeName(fieldDef.items)}` : 'repeated google.protobuf.Value';
      case 'object':
        return 'google.protobuf.Struct';
      case 'blob':
      case 'binary':
        return 'bytes';
      default:
        return 'google.protobuf.Value';
    }
  }
}