import { RestApiPlugin, RestApiKnexPlugin, ExpressPlugin } from './index.js'; // Added: ExpressPlugin
import { Api } from 'hooked-api';
import knexLib from 'knex';
import util from 'util';
import express from 'express'; // Added: Express

// Utility used throughout this guide
const inspect = (obj) => util.inspect(obj, { depth: 5 })

// Create a Knex instance connected to SQLite in-memory database
const knex = knexLib({
  client: 'better-sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
});

// Create API instance
const api = new Api({ name: 'book-catalog-api', version: '1.0.0' });

// Install plugins
await api.use(RestApiPlugin, { publicBaseUrl: '/api/1.0' });
await api.use(RestApiKnexPlugin, { knex });
await api.use(ExpressPlugin, {  mountPath: '/api' }); // Added: Express Plugin

/// *** ...programmatic calls here... ***





 await api.addResource('countries', {
    schema: {
      name: {
        type: 'string', required: true, search: {
          name: { filterUsing: '=', type: 'string' },
          nameLike: { filterUsing: 'like', type: 'string' }
        }
      },
      code: { type: 'string', unique: true, search: true }
    }
  });
  await api.resources.countries.createKnexTable()


await api.resources.countries.post({ name: 'France', code: 'FR' });
await api.resources.countries.post({ name: 'Italy', code: 'IT' });
await api.resources.countries.post({ name: 'Germany', code: 'DE' });
await api.resources.countries.post({ name: 'Australia', code: 'AU' });
await api.resources.countries.post({ name: 'Austria', code: 'AT' });

const searchAustralia = await api.resources.countries.query({
  queryParams: {
    filters: {
      name: 'Australia'
    }
  }
});
const searchAustr = await api.resources.countries.query({
  queryParams: {
    filters: {
      nameLike: 'Austr'
    }
  }
});
console.log('Search for "Australia":', inspect(searchAustralia))
console.log('Search for "Austr":', inspect(searchAustr))







// Createthe express server and add the API's routes 
const app = express();
app.use(api.http.express.router);
app.use(api.http.express.notFoundRouter);

app.listen(3000, () => {
  console.log('Express server started on port 3000. API available at http://localhost:3000/api');
});
