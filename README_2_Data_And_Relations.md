# Data and relations

In the previous section we showed how to set up a set of REST endpoints that you can manipulate 

### Search (Filtering)

TODO

### Sparse Fields

The JSON:API specification allows clients to request only a subset of fields for a given resource, a feature known as "sparse fieldsets". This is crucial for optimizing network traffic by reducing the size of the response payload, especially when dealing with large records.

You can specify which fields to return using the `fields[resourceType]=field1,field2` query parameter.

**Programmatic Example: Get only `name` for `countries`**

```javascript
TODO
```

**HTTP Example: Get Books with only `title` and `isbn`**

TODO

Sparse fieldsets also apply to `included` resources. If you request related data, you can specify which fields of those related resources should be returned as well.




## belongsTo records

### Search (belongsTo)

### Sparse fields (belongsTo)

### Computed and hidden fields




## hasMany records

### Search (hasMany)

### Sparse fields (hasMany)

### Computed and hidden fields




## hasMany records (polymorphic)

### Search (hasMany)

### Sparse fields (hasMany)

### Computed and hidden fields




## Many to many (hasMany with through records)

### Search (many to many)

### Sparse fields (many to many)

### Computed and hidden fields






## Next Steps

- [Schema Definition Guide](docs/schemas.md) - Learn about all field types and validation rules
- [Relationships Guide](docs/relationships.md) - Deep dive into relationship configuration
- [Querying Guide](docs/querying.md) - Advanced filtering, sorting, and pagination
- [File Uploads Guide](docs/file-uploads.md) - Handle file uploads with various storage backends
- [Authentication Guide](docs/authentication.md) - Add authentication and authorization
- [Testing Guide](docs/testing.md) - Write tests for your API

## License

GPL-3.0-or-later


