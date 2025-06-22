export class ProtoGenerator {
  constructor(options = {}) {
    this.packageName = options.packageName || 'api';
    this.serviceName = options.serviceName || 'ApiService';
    this.strictTypes = options.strictTypes || false;
  }

  generateResourceProto(resourceName, schema) {
    const messages = [];
    const imports = new Set();
    
    // Add common imports
    imports.add('google/protobuf/empty.proto');
    imports.add('google/protobuf/timestamp.proto');
    imports.add('google/protobuf/struct.proto');
    
    // Generate main message
    const messageFields = this.generateMessageFields(schema.structure || schema.fields || {});
    messages.push(`
message ${this.capitalize(resourceName)} {
${messageFields.map((field, index) => `  ${field.definition} = ${index + 1};`).join('\n')}
}`);

    // Generate list message
    messages.push(`
message ${this.capitalize(resourceName)}List {
  repeated ${this.capitalize(resourceName)} items = 1;
  int32 total = 2;
  int32 page = 3;
  int32 page_size = 4;
}`);

    // Generate request/response messages
    messages.push(`
message Get${this.capitalize(resourceName)}Request {
  string id = 1;
  repeated string include = 2;
}

message Create${this.capitalize(resourceName)}Request {
  ${this.capitalize(resourceName)} data = 1;
}

message Update${this.capitalize(resourceName)}Request {
  string id = 1;
  ${this.capitalize(resourceName)} data = 2;
}

message Delete${this.capitalize(resourceName)}Request {
  string id = 1;
}

message Query${this.capitalize(resourceName)}Request {
  map<string, string> filter = 1;
  string sort = 2;
  int32 page = 3;
  int32 page_size = 4;
  repeated string include = 5;
}

message BatchCreate${this.capitalize(resourceName)}Request {
  repeated ${this.capitalize(resourceName)} items = 1;
}

message BatchUpdate${this.capitalize(resourceName)}Request {
  message UpdateItem {
    string id = 1;
    ${this.capitalize(resourceName)} data = 2;
  }
  repeated UpdateItem items = 1;
}

message BatchDelete${this.capitalize(resourceName)}Request {
  repeated string ids = 1;
}

message OperationResponse {
  bool success = 1;
  string message = 2;
  string id = 3;
}`);

    // Build proto file
    const proto = `
syntax = "proto3";

package ${this.packageName};

${Array.from(imports).map(imp => `import "${imp}";`).join('\n')}

${messages.join('\n\n')}
`;

    return proto.trim();
  }

  generateMainProto(schemas) {
    const imports = new Set();
    const services = [];
    
    // Import all resource protos
    for (const [resourceName] of schemas) {
      imports.add(`${resourceName}.proto`);
    }
    
    // Generate service methods for each resource
    for (const [resourceName] of schemas) {
      const capitalized = this.capitalize(resourceName);
      
      services.push(`
  // ${capitalized} methods
  rpc Get${capitalized}(Get${capitalized}Request) returns (${capitalized});
  rpc Create${capitalized}(Create${capitalized}Request) returns (${capitalized});
  rpc Update${capitalized}(Update${capitalized}Request) returns (${capitalized});
  rpc Delete${capitalized}(Delete${capitalized}Request) returns (OperationResponse);
  rpc Query${capitalized}(Query${capitalized}Request) returns (${capitalized}List);
  
  // Batch operations
  rpc BatchCreate${capitalized}(BatchCreate${capitalized}Request) returns (${capitalized}List);
  rpc BatchUpdate${capitalized}(BatchUpdate${capitalized}Request) returns (${capitalized}List);
  rpc BatchDelete${capitalized}(BatchDelete${capitalized}Request) returns (OperationResponse);
  
  // Streaming operations
  rpc Stream${capitalized}(Query${capitalized}Request) returns (stream ${capitalized});
  rpc StreamCreate${capitalized}(stream Create${capitalized}Request) returns (stream ${capitalized});
  rpc StreamUpdate${capitalized}(stream Update${capitalized}Request) returns (stream ${capitalized});
  rpc Watch${capitalized}(Query${capitalized}Request) returns (stream ${capitalized});`);
    }
    
    const proto = `
syntax = "proto3";

package ${this.packageName};

${Array.from(imports).map(imp => `import "${imp}";`).join('\n')}

service ${this.serviceName} {
${services.join('\n')}
}
`;

    return proto.trim();
  }

  generateMessageFields(schemaFields) {
    const fields = [];
    
    for (const [fieldName, fieldDef] of Object.entries(schemaFields)) {
      const protoType = this.getProtoType(fieldDef);
      
      if (protoType) {
        fields.push({
          name: fieldName,
          definition: `${protoType.repeated ? 'repeated ' : ''}${protoType.type} ${this.toSnakeCase(fieldName)}`,
          type: protoType.type,
          repeated: protoType.repeated
        });
      } else if (!this.strictTypes) {
        // Fallback to google.protobuf.Value for unsupported types
        fields.push({
          name: fieldName,
          definition: `google.protobuf.Value ${this.toSnakeCase(fieldName)}`,
          type: 'google.protobuf.Value',
          repeated: false
        });
      }
    }
    
    return fields;
  }

  getProtoType(fieldDef) {
    const { type, items } = fieldDef;
    
    switch (type) {
      case 'string':
        return { type: 'string', repeated: false };
      
      case 'number':
      case 'float':
        return { type: 'double', repeated: false };
      
      case 'integer':
        return { type: 'int32', repeated: false };
      
      case 'boolean':
        return { type: 'bool', repeated: false };
      
      case 'id':
        return { type: 'string', repeated: false };
      
      case 'date':
      case 'timestamp':
        return { type: 'google.protobuf.Timestamp', repeated: false };
      
      case 'array':
        if (items) {
          const itemType = this.getProtoType(items);
          if (itemType) {
            return { type: itemType.type, repeated: true };
          }
        }
        // Fallback for untyped arrays
        return this.strictTypes ? null : { type: 'google.protobuf.Value', repeated: true };
      
      case 'object':
        // Use Struct for dynamic objects
        return this.strictTypes ? null : { type: 'google.protobuf.Struct', repeated: false };
      
      case 'blob':
      case 'binary':
        return { type: 'bytes', repeated: false };
      
      default:
        return null;
    }
  }

  getServiceDefinition(schemas) {
    const methods = {};
    
    for (const [resourceName] of schemas) {
      const capitalized = this.capitalize(resourceName);
      
      // CRUD methods
      methods[`Get${capitalized}`] = {
        path: `/${this.packageName}.${this.serviceName}/Get${capitalized}`,
        requestStream: false,
        responseStream: false,
        requestType: `Get${capitalized}Request`,
        responseType: capitalized
      };
      
      methods[`Create${capitalized}`] = {
        path: `/${this.packageName}.${this.serviceName}/Create${capitalized}`,
        requestStream: false,
        responseStream: false,
        requestType: `Create${capitalized}Request`,
        responseType: capitalized
      };
      
      methods[`Update${capitalized}`] = {
        path: `/${this.packageName}.${this.serviceName}/Update${capitalized}`,
        requestStream: false,
        responseStream: false,
        requestType: `Update${capitalized}Request`,
        responseType: capitalized
      };
      
      methods[`Delete${capitalized}`] = {
        path: `/${this.packageName}.${this.serviceName}/Delete${capitalized}`,
        requestStream: false,
        responseStream: false,
        requestType: `Delete${capitalized}Request`,
        responseType: 'OperationResponse'
      };
      
      methods[`Query${capitalized}`] = {
        path: `/${this.packageName}.${this.serviceName}/Query${capitalized}`,
        requestStream: false,
        responseStream: false,
        requestType: `Query${capitalized}Request`,
        responseType: `${capitalized}List`
      };
      
      // Streaming methods
      methods[`Stream${capitalized}`] = {
        path: `/${this.packageName}.${this.serviceName}/Stream${capitalized}`,
        requestStream: false,
        responseStream: true,
        requestType: `Query${capitalized}Request`,
        responseType: capitalized
      };
      
      methods[`Watch${capitalized}`] = {
        path: `/${this.packageName}.${this.serviceName}/Watch${capitalized}`,
        requestStream: false,
        responseStream: true,
        requestType: `Query${capitalized}Request`,
        responseType: capitalized
      };
    }
    
    return methods;
  }

  capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  toSnakeCase(str) {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`).replace(/^_/, '');
  }
}