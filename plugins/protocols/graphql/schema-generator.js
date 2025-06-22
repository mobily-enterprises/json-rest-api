import {
  GraphQLObjectType,
  GraphQLInputObjectType,
  GraphQLString,
  GraphQLInt,
  GraphQLFloat,
  GraphQLBoolean,
  GraphQLList,
  GraphQLNonNull,
  GraphQLID,
  GraphQLEnumType
} from 'graphql';

// Convert JSON schema type to GraphQL type
function schemaTypeToGraphQL(field, customScalars, isInput = false, typeCache = new Map()) {
  const { type, required, items, enum: enumValues } = field;
  
  let graphqlType;
  
  // Handle enums
  if (enumValues && Array.isArray(enumValues)) {
    const enumName = `${field.name || 'Unknown'}Enum`;
    if (!typeCache.has(enumName)) {
      typeCache.set(enumName, new GraphQLEnumType({
        name: enumName,
        values: enumValues.reduce((acc, val) => {
          // GraphQL enum values must be uppercase
          const key = String(val).toUpperCase().replace(/[^A-Z0-9_]/g, '_');
          acc[key] = { value: val };
          return acc;
        }, {})
      }));
    }
    graphqlType = typeCache.get(enumName);
  } else {
    switch (type) {
      case 'string':
        graphqlType = GraphQLString;
        break;
      case 'number':
        graphqlType = GraphQLFloat;
        break;
      case 'integer':
        graphqlType = GraphQLInt;
        break;
      case 'boolean':
        graphqlType = GraphQLBoolean;
        break;
      case 'id':
        graphqlType = GraphQLID;
        break;
      case 'date':
      case 'timestamp':
        graphqlType = customScalars.Date || GraphQLString;
        break;
      case 'array':
        if (items) {
          graphqlType = new GraphQLList(schemaTypeToGraphQL(items, customScalars, isInput, typeCache));
        } else {
          graphqlType = new GraphQLList(GraphQLString);
        }
        break;
      case 'object':
      case 'serialize':
        // Use JSON scalar for complex objects
        graphqlType = customScalars.JSON || GraphQLString;
        break;
      default:
        graphqlType = GraphQLString;
    }
  }

  // Apply required constraint for non-input types
  if (required && !isInput) {
    return new GraphQLNonNull(graphqlType);
  }
  
  return graphqlType;
}

// Generate field config for GraphQL
function generateFieldConfig(fieldName, fieldDef, customScalars, isInput, typeCache) {
  const config = {
    type: schemaTypeToGraphQL(fieldDef, customScalars, isInput, typeCache)
  };

  if (fieldDef.description) {
    config.description = fieldDef.description;
  }

  if (!isInput && fieldDef.deprecationReason) {
    config.deprecationReason = fieldDef.deprecationReason;
  }

  return config;
}

// Generate filter input type
function generateFilterType(typeName, schema, customScalars, typeCache) {
  const filterFields = {};
  
  for (const [fieldName, fieldDef] of Object.entries(schema.structure || schema.fields || {})) {
    if (fieldDef.searchable) {
      const baseType = schemaTypeToGraphQL(fieldDef, customScalars, true, typeCache);
      
      // Basic equality filter
      filterFields[fieldName] = { type: baseType };
      
      // Comparison operators for numbers and dates
      if (['number', 'integer', 'date', 'timestamp'].includes(fieldDef.type)) {
        filterFields[`${fieldName}_gt`] = { type: baseType };
        filterFields[`${fieldName}_gte`] = { type: baseType };
        filterFields[`${fieldName}_lt`] = { type: baseType };
        filterFields[`${fieldName}_lte`] = { type: baseType };
      }
      
      // String operators
      if (fieldDef.type === 'string') {
        filterFields[`${fieldName}_like`] = { type: GraphQLString };
        filterFields[`${fieldName}_ilike`] = { type: GraphQLString };
        filterFields[`${fieldName}_in`] = { type: new GraphQLList(GraphQLString) };
      }
      
      // Array operators
      filterFields[`${fieldName}_in`] = { type: new GraphQLList(baseType) };
      filterFields[`${fieldName}_nin`] = { type: new GraphQLList(baseType) };
      
      // Null checks
      filterFields[`${fieldName}_is_null`] = { type: GraphQLBoolean };
    }
  }

  // Add logical operators
  const filterTypeName = `${typeName}Filter`;
  const filterType = new GraphQLInputObjectType({
    name: filterTypeName,
    fields: () => ({
      ...filterFields,
      AND: { type: new GraphQLList(filterType) },
      OR: { type: new GraphQLList(filterType) },
      NOT: { type: filterType }
    })
  });

  return filterType;
}

// Generate sort input type
function generateSortType(typeName, schema) {
  const sortableFields = {};
  
  for (const [fieldName, fieldDef] of Object.entries(schema.structure || schema.fields || {})) {
    if (!fieldDef.virtual && !fieldDef.silent) {
      sortableFields[fieldName.toUpperCase()] = { value: fieldName };
      sortableFields[`${fieldName.toUpperCase()}_DESC`] = { value: `-${fieldName}` };
    }
  }

  return new GraphQLEnumType({
    name: `${typeName}SortField`,
    values: sortableFields
  });
}

// Generate page input type
function generatePageInputType() {
  return new GraphQLInputObjectType({
    name: 'PageInput',
    fields: {
      number: { type: GraphQLInt, defaultValue: 1 },
      size: { type: GraphQLInt, defaultValue: 20 }
    }
  });
}

// Main schema generation function
export function generateSchema(resourceName, schema, customScalars = {}, sharedTypeCache = null, existingTypes = null) {
  const typeCache = sharedTypeCache || new Map();
  const fields = {};
  const inputFields = {};
  const structure = schema.structure || schema.fields || {};

  // Generate fields for output type
  for (const [fieldName, fieldDef] of Object.entries(structure)) {
    if (!fieldDef.silent) {
      fields[fieldName] = generateFieldConfig(
        fieldName, 
        fieldDef, 
        customScalars, 
        false, 
        typeCache
      );
      
      // Add resolver for computed/virtual fields
      if (fieldDef.virtual || fieldDef.compute) {
        fields[fieldName].resolve = async (parent, args, context) => {
          if (fieldDef.compute && typeof fieldDef.compute === 'function') {
            return fieldDef.compute(parent, context);
          }
          return parent[fieldName];
        };
      }
      
      // Add relationship field for refs
      if (fieldDef.refs && fieldDef.refs.resource) {
        const relFieldName = fieldName.replace(/Id$/, '');
        if (relFieldName !== fieldName && !fields[relFieldName]) {
          // Store the relationship resource name for later resolution
          const relResource = fieldDef.refs.resource;
          let resolvedType = null;
          
          fields[relFieldName] = {
            get type() {
              // Cache the resolved type to avoid repeated lookups
              if (resolvedType) return resolvedType;
              
              // Look up the type from existing types when accessed
              if (existingTypes && existingTypes.has(relResource)) {
                const relatedTypes = existingTypes.get(relResource);
                if (relatedTypes && relatedTypes.outputType) {
                  resolvedType = relatedTypes.outputType;
                  return resolvedType;
                }
              }
              
              // Fallback to string if type not found yet
              resolvedType = GraphQLString;
              return resolvedType;
            },
            resolve: (parent) => {
              // The transformer will handle this from the relationships data
              return parent[relFieldName];
            }
          };
        }
      }
    }

    // Generate input fields (exclude virtual and auto-generated fields)
    if (!fieldDef.virtual && !fieldDef.silent && fieldName !== 'id' && 
        !['createdAt', 'updatedAt'].includes(fieldName)) {
      inputFields[fieldName] = generateFieldConfig(
        fieldName, 
        fieldDef, 
        customScalars, 
        true, 
        typeCache
      );
    }
  }

  // Create output type
  // Singularize resource name for type name
  const typeName = resourceName.endsWith('s') 
    ? capitalize(resourceName.slice(0, -1))
    : capitalize(resourceName);
  
  const outputType = new GraphQLObjectType({
    name: typeName,
    description: `${resourceName} resource type`,
    fields
  });

  // Create input type for mutations
  const inputType = new GraphQLInputObjectType({
    name: `${typeName}Input`,
    description: `Input type for creating/updating ${resourceName}`,
    fields: inputFields
  });

  // Create update input type (all fields optional)
  const updateInputType = new GraphQLInputObjectType({
    name: `${typeName}UpdateInput`,
    description: `Input type for updating ${resourceName}`,
    fields: Object.entries(inputFields).reduce((acc, [key, config]) => {
      // Make all fields optional for updates
      acc[key] = {
        ...config,
        type: config.type instanceof GraphQLNonNull ? config.type.ofType : config.type
      };
      return acc;
    }, {})
  });

  // Create filter type
  const filterType = generateFilterType(typeName, schema, customScalars, typeCache);

  // Create sort type
  const sortType = generateSortType(typeName, schema);

  // Page input type (reusable)
  let pageInputType = typeCache.get('PageInput');
  if (!pageInputType) {
    pageInputType = generatePageInputType();
    typeCache.set('PageInput', pageInputType);
  }

  // Create response type with metadata
  const responseType = new GraphQLObjectType({
    name: `${typeName}Response`,
    fields: {
      data: { type: new GraphQLList(outputType) },
      meta: {
        type: new GraphQLObjectType({
          name: `${typeName}Meta`,
          fields: {
            total: { type: GraphQLInt },
            pageSize: { type: GraphQLInt },
            pageNumber: { type: GraphQLInt },
            totalPages: { type: GraphQLInt }
          }
        })
      }
    }
  });

  return {
    outputType,
    inputType,
    updateInputType,
    filterType,
    sortType,
    pageInputType,
    responseType,
    typeCache
  };
}

// Helper to capitalize strings
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}