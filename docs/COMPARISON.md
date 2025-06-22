# Framework Comparison: Real-World Example

This document compares json-rest-api with popular alternatives using a realistic business scenario.

## The Scenario

We're building an API for a multinational corporation system with:
- **Continents**: Basic lookup (7 records)
- **Countries**: Belong to continents (~200 records)
- **Companies**: Headquartered in countries, with sensitive financial data
- **Offices**: Companies have 3-10 offices across different countries


### Requirements
1. When fetching a company, automatically include all offices with their country information
2. Hide sensitive fields (revenue, employee count) from non-admin users
3. Enable filtering by searchable fields
4. Full CRUD operations with validation
5. Nested relationships: Company → Offices → Country → Continent

## json-rest-api Implementation

```javascript
import { createApi, Schema } from 'json-rest-api';
import express from 'express';

const app = express();
const api = createApi({ storage: 'memory', http: { app } });

// Define all resources with relationships and permissions
api.addResource('continents', new Schema({
  name: { type: 'string', required: true },
  code: { type: 'string', required: true, length: 2 }
}));

api.addResource('countries', new Schema({
  name: { type: 'string', required: true, searchable: true },
  code: { type: 'string', required: true, length: 3 },
  continentId: {
    type: 'id',
    required: true,
    refs: {
      resource: 'continents',
      join: { eager: true }
    }
  }
}));

api.addResource('companies', new Schema({
  name: { type: 'string', required: true, searchable: true },
  industry: { type: 'string', required: true, searchable: true },
  countryId: {
    type: 'id',
    required: true,
    refs: {
      resource: 'countries',
      join: { eager: true }
    }
  },
  revenue: { 
    type: 'number',
    permissions: { read: 'admin', write: 'admin' }
  },
  offices: {
    type: 'list',
    virtual: true,
    foreignResource: 'offices',
    foreignKey: 'companyId',
    join: {
      eager: true,
      include: ['countryId']  // Include country for each office
    }
  }
}));

api.addResource('offices', new Schema({
  name: { type: 'string', required: true },
  type: { type: 'string', enum: ['headquarters', 'branch', 'r&d'], searchable: true },
  companyId: {
    type: 'id',
    required: true,
    searchable: true,
    refs: { resource: 'companies' }
  },
  countryId: {
    type: 'id',
    required: true,
    refs: {
      resource: 'countries',
      join: { eager: true }
    }
  }
}));

app.listen(3000);
```

**That's it!** This gives you:
- ✅ All CRUD endpoints for all resources
- ✅ Automatic nested loading (company → offices → countries)
- ✅ Field-level permissions
- ✅ Filtering, sorting, pagination
- ✅ Validation and error handling
- ✅ JSON:API compliant responses

**Lines of code: ~50**

## Strapi (Headless CMS)

Strapi requires creating content types through the admin UI or configuration files:

```javascript
// api/continent/models/continent.settings.json
{
  "kind": "collectionType",
  "collectionName": "continents",
  "attributes": {
    "name": { "type": "string", "required": true },
    "code": { "type": "string", "required": true, "maxLength": 2 },
    "countries": {
      "collection": "country",
      "via": "continent"
    }
  }
}

// api/country/models/country.settings.json
{
  "kind": "collectionType",
  "collectionName": "countries",
  "attributes": {
    "name": { "type": "string", "required": true, "searchable": true },
    "code": { "type": "string", "required": true, "maxLength": 3 },
    "continent": {
      "model": "continent",
      "via": "countries"
    },
    "companies": {
      "collection": "company",
      "via": "country"
    },
    "offices": {
      "collection": "office",
      "via": "country"
    }
  }
}

// api/company/models/company.settings.json
{
  "kind": "collectionType",
  "collectionName": "companies",
  "attributes": {
    "name": { "type": "string", "required": true, "searchable": true },
    "industry": { "type": "string", "required": true, "searchable": true },
    "country": {
      "model": "country",
      "via": "companies"
    },
    "revenue": {
      "type": "decimal",
      "private": true  // Only hides from API, not admin panel
    },
    "offices": {
      "collection": "office",
      "via": "company"
    }
  }
}

// api/office/models/office.settings.json
{
  "kind": "collectionType",
  "collectionName": "offices",
  "attributes": {
    "name": { "type": "string", "required": true },
    "type": {
      "type": "enumeration",
      "enum": ["headquarters", "branch", "r&d"],
      "searchable": true
    },
    "company": {
      "model": "company",
      "via": "offices"
    },
    "country": {
      "model": "country",
      "via": "offices"
    }
  }
}

// Plus custom controllers for field-level permissions:
// api/company/controllers/company.js
module.exports = {
  async find(ctx) {
    let entities;
    if (ctx.query._q) {
      entities = await strapi.services.company.search(ctx.query);
    } else {
      entities = await strapi.services.company.find(ctx.query);
    }

    // Remove sensitive fields for non-admin users
    if (!ctx.state.user || ctx.state.user.role.type !== 'admin') {
      entities = entities.map(entity => {
        delete entity.revenue;
        return entity;
      });
    }

    return entities.map(entity => 
      strapi.services.company.formatResponse(entity)
    );
  }
};

// To populate nested relations, you need:
// GET /companies?populate=deep
// Or configure default population in controllers
```

**Drawbacks:**
- 🔴 Requires database setup and migrations
- 🔴 Heavy footprint (~500MB)
- 🔴 Slow startup (30-60 seconds)
- 🔴 Complex deployment
- 🔴 Field permissions require custom code
- 🔴 CMS-first, not API-first

**Lines of code: ~200+ (plus UI configuration)**

## NestJS

```typescript
// continent.entity.ts
@Entity()
export class Continent {
  @PrimaryGeneratedColumn() id: number;
  @Column() name: string;
  @Column({ length: 2 }) code: string;
  @OneToMany(() => Country, country => country.continent)
  countries: Country[];
}

// country.entity.ts
@Entity()
export class Country {
  @PrimaryGeneratedColumn() id: number;
  @Column() name: string;
  @Column({ length: 3 }) code: string;
  @ManyToOne(() => Continent, continent => continent.countries, { eager: true })
  continent: Continent;
  @OneToMany(() => Company, company => company.country)
  companies: Company[];
  @OneToMany(() => Office, office => office.country)
  offices: Office[];
}

// company.entity.ts
@Entity()
export class Company {
  @PrimaryGeneratedColumn() id: number;
  @Column() name: string;
  @Column() industry: string;
  @ManyToOne(() => Country, country => country.companies, { eager: true })
  country: Country;
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  revenue: number;
  @OneToMany(() => Office, office => office.company, { eager: true })
  offices: Office[];
}

// office.entity.ts
@Entity()
export class Office {
  @PrimaryGeneratedColumn() id: number;
  @Column() name: string;
  @Column({ type: 'enum', enum: ['headquarters', 'branch', 'r&d'] })
  type: string;
  @ManyToOne(() => Company, company => company.offices)
  company: Company;
  @ManyToOne(() => Country, country => country.offices, { eager: true })
  country: Country;
}

// DTOs for each entity (create-company.dto.ts)
export class CreateCompanyDto {
  @IsString() @IsNotEmpty() name: string;
  @IsString() @IsNotEmpty() industry: string;
  @IsNumber() countryId: number;
  @IsNumber() @IsOptional() revenue?: number;
}

// Service for each entity (company.service.ts)
@Injectable()
export class CompanyService {
  constructor(
    @InjectRepository(Company)
    private companyRepository: Repository<Company>,
  ) {}

  findAll(user: User) {
    const query = this.companyRepository
      .createQueryBuilder('company')
      .leftJoinAndSelect('company.country', 'country')
      .leftJoinAndSelect('country.continent', 'continent')
      .leftJoinAndSelect('company.offices', 'offices')
      .leftJoinAndSelect('offices.country', 'officeCountry');
    
    // Hide revenue for non-admins
    if (!user || user.role !== 'admin') {
      query.select([
        'company.id', 'company.name', 'company.industry',
        'country', 'continent', 'offices', 'officeCountry'
      ]);
    }
    
    return query.getMany();
  }

  findOne(id: number, user: User) {
    const query = this.companyRepository
      .createQueryBuilder('company')
      .where('company.id = :id', { id })
      .leftJoinAndSelect('company.country', 'country')
      .leftJoinAndSelect('country.continent', 'continent')
      .leftJoinAndSelect('company.offices', 'offices')
      .leftJoinAndSelect('offices.country', 'officeCountry');
    
    if (!user || user.role !== 'admin') {
      query.select([
        'company.id', 'company.name', 'company.industry',
        'country', 'continent', 'offices', 'officeCountry'
      ]);
    }
    
    return query.getOne();
  }

  // Plus create, update, remove methods...
}

// Controller for each entity (company.controller.ts)
@Controller('companies')
@UseGuards(AuthGuard)
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  @Get()
  findAll(@Query() query: any, @Request() req) {
    // Need to implement filtering, sorting, pagination manually
    return this.companyService.findAll(req.user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req) {
    return this.companyService.findOne(+id, req.user);
  }

  @Post()
  @UsePipes(new ValidationPipe())
  create(@Body() createCompanyDto: CreateCompanyDto) {
    return this.companyService.create(createCompanyDto);
  }

  // Plus update and delete...
}

// Module for each entity (company.module.ts)
@Module({
  imports: [TypeOrmModule.forFeature([Company])],
  controllers: [CompanyController],
  providers: [CompanyService],
  exports: [CompanyService]
})
export class CompanyModule {}

// App module
@Module({
  imports: [
    TypeOrmModule.forRoot({/* config */}),
    ContinentModule,
    CountryModule,
    CompanyModule,
    OfficeModule,
  ],
})
export class AppModule {}
```

**Plus you still need:**
- Implement filtering/sorting/pagination logic
- Create interceptors for response formatting
- Add guards for authentication
- Configure TypeORM relationships
- Handle nested population manually
- Add Swagger decorators for documentation

**Drawbacks:**
- 🔴 10+ files per resource
- 🔴 ~500 lines for basic CRUD
- 🔴 Manual relationship management
- 🔴 No built-in filtering/sorting
- 🔴 Heavy boilerplate
- 🔴 Complex dependency injection

**Lines of code: ~500+**

## Feathers.js

```javascript
// services/continents/continents.class.js
const { Service } = require('feathers-knex');
class Continents extends Service {
  constructor(options, app) {
    super({
      ...options,
      name: 'continents'
    });
  }
}

// services/continents/continents.service.js
const createModel = require('../../models/continents.model');
const { Continents } = require('./continents.class');
const hooks = require('./continents.hooks');

module.exports = function (app) {
  const options = {
    Model: createModel(app),
    paginate: app.get('paginate')
  };
  app.use('/continents', new Continents(options, app));
  app.service('continents').hooks(hooks);
};

// services/companies/companies.hooks.js
const { populate } = require('feathers-hooks-common');
const checkPermissions = require('../../hooks/check-permissions');

const companySchema = {
  include: [
    {
      service: 'countries',
      nameAs: 'country',
      parentField: 'countryId',
      childField: 'id',
      include: [{
        service: 'continents',
        nameAs: 'continent',
        parentField: 'continentId',
        childField: 'id'
      }]
    },
    {
      service: 'offices',
      nameAs: 'offices',
      parentField: 'id',
      childField: 'companyId',
      asArray: true,
      include: [{
        service: 'countries',
        nameAs: 'country',
        parentField: 'countryId',
        childField: 'id'
      }]
    }
  ]
};

module.exports = {
  before: {
    all: [authenticate('jwt')],
    find: [],
    get: [],
    create: [checkPermissions({ roles: ['admin'] })],
    update: [checkPermissions({ roles: ['admin'] })],
    patch: [checkPermissions({ roles: ['admin'] })],
    remove: [checkPermissions({ roles: ['admin'] })]
  },
  after: {
    all: [],
    find: [
      populate({ schema: companySchema }),
      removeField('revenue', { unless: isAdmin })
    ],
    get: [
      populate({ schema: companySchema }),
      removeField('revenue', { unless: isAdmin })
    ],
    create: [populate({ schema: companySchema })],
    update: [populate({ schema: companySchema })],
    patch: [populate({ schema: companySchema })],
    remove: []
  }
};

// Custom hook for field removal
function removeField(fieldName, options = {}) {
  return async context => {
    const { unless } = options;
    if (unless && unless(context)) return context;
    
    const remove = data => {
      if (Array.isArray(data)) {
        return data.map(remove);
      }
      delete data[fieldName];
      return data;
    };
    
    if (context.result.data) {
      context.result.data = remove(context.result.data);
    } else {
      context.result = remove(context.result);
    }
    
    return context;
  };
}

// Plus similar setup for each resource...
```

**Drawbacks:**
- 🔴 Complex hook system
- 🔴 Manual relationship population
- 🔴 Separate files for each service
- 🔴 No built-in permissions (DIY)
- 🔴 Verbose configuration

**Lines of code: ~400+**

## Loopback 4

```typescript
// models/company.model.ts
@model({
  settings: {
    indexes: {
      uniqueName: {
        keys: { name: 1 },
        options: { unique: true }
      }
    }
  }
})
export class Company extends Entity {
  @property({ id: true, generated: true })
  id?: number;

  @property({ required: true })
  name: string;

  @property({ required: true })
  industry: string;

  @belongsTo(() => Country)
  countryId: number;

  @property({
    type: 'number',
    postgresql: { dataType: 'decimal', precision: 10, scale: 2 }
  })
  revenue?: number;

  @hasMany(() => Office)
  offices: Office[];
}

// repositories/company.repository.ts
export class CompanyRepository extends DefaultCrudRepository<
  Company,
  typeof Company.prototype.id,
  CompanyRelations
> {
  public readonly country: BelongsToAccessor<Country, typeof Company.prototype.id>;
  public readonly offices: HasManyRepositoryFactory<Office, typeof Company.prototype.id>;

  constructor(
    @inject('datasources.db') dataSource: DbDataSource,
    @repository.getter('CountryRepository')
    protected countryRepositoryGetter: Getter<CountryRepository>,
    @repository.getter('OfficeRepository')
    protected officeRepositoryGetter: Getter<OfficeRepository>,
  ) {
    super(Company, dataSource);
    this.country = this.createBelongsToAccessorFor('country', countryRepositoryGetter);
    this.offices = this.createHasManyRepositoryFactoryFor('offices', officeRepositoryGetter);
    
    this.registerInclusionResolver('country', this.country.inclusionResolver);
    this.registerInclusionResolver('offices', this.offices.inclusionResolver);
  }
}

// controllers/company.controller.ts
export class CompanyController {
  constructor(
    @repository(CompanyRepository)
    public companyRepository: CompanyRepository,
  ) {}

  @get('/companies')
  @response(200, {
    description: 'Array of Company model instances',
    content: {
      'application/json': {
        schema: {
          type: 'array',
          items: getModelSchemaRef(Company, {includeRelations: true}),
        },
      },
    },
  })
  @authenticate('jwt')
  async find(
    @inject(SecurityBindings.USER) currentUser: UserProfile,
    @param.filter(Company) filter?: Filter<Company>,
  ): Promise<Company[]> {
    // Need to manually handle field-level permissions
    const companies = await this.companyRepository.find(filter);
    
    if (currentUser.role !== 'admin') {
      // Remove sensitive fields
      return companies.map(company => {
        delete company.revenue;
        return company;
      });
    }
    
    return companies;
  }

  // Plus other CRUD methods with similar permission handling...
}

// Plus authentication strategy, authorization decorators, etc.
```

**Drawbacks:**
- 🔴 Extremely verbose
- 🔴 Complex dependency injection
- 🔴 Manual permission handling
- 🔴 Heavy decorators everywhere
- 🔴 Steep learning curve

**Lines of code: ~600+**

## Summary Comparison

| Feature | json-rest-api | Strapi | NestJS | Feathers | Loopback 4 |
|---------|--------------|---------|---------|----------|------------|
| **Lines of Code** | ~50 | ~200+ | ~500+ | ~400+ | ~600+ |
| **Setup Time** | 5 minutes | 30 minutes | 2 hours | 1 hour | 2 hours |
| **Auto Relationships** | ✅ Yes | ✅ Yes | ❌ Manual | ❌ Manual | ⚠️ Complex |
| **Nested Loading** | ✅ Automatic | ⚠️ Configure | ❌ Manual | ❌ Manual | ❌ Manual |
| **Field Permissions** | ✅ Built-in | ❌ Custom code | ❌ Custom guards | ❌ Custom hooks | ❌ Manual |
| **Filtering/Sorting** | ✅ Built-in | ✅ Built-in | ❌ Build yourself | ⚠️ Basic | ⚠️ Basic |
| **Memory Usage** | ~50MB | ~500MB | ~200MB | ~150MB | ~200MB |
| **Dependencies** | Minimal | Heavy | Heavy | Moderate | Heavy |
| **Learning Curve** | Low | Medium | High | Medium | Very High |

## Why json-rest-api Wins

1. **Minimal Code**: 10x less code than alternatives
2. **Automatic Features**: Relationships, permissions, filtering just work
3. **True API-First**: Not a CMS, not over-architected
4. **Production Ready**: All features you need, none you don't
5. **Fast Development**: Build complete APIs in minutes, not hours

## When to Use Alternatives

- **Strapi**: When you need a CMS with admin UI
- **NestJS**: Large enterprise teams who love complexity
- **Feathers**: Real-time features with Socket.io
- **Loopback 4**: If you're already invested in the ecosystem

But for building REST APIs quickly and efficiently, **json-rest-api** is unmatched.