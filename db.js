// db.js
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  connectionString: process.env.DATABASE_URL,
  // Supabase requires SSL for remote connections
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Helper to convert `?` placeholders to `$1, $2, ...`
function convertQuery(query) {
  let count = 1;
  // Replace standard queries that use ? to bind params
  // Also remove backticks since pg uses double quotes, though standard backtick removal might suffice for most cases
  let pgQuery = query.replace(/\?/g, () => `$${count++}`);
  // PostgreSQL does not support backticks for identifiers, replace them with double quotes
  pgQuery = pgQuery.replace(/`/g, '"');
  
  // "User" is a reserved keyword in PostgreSQL, so any raw unquoted occurrences need to be wrapped in quotes
  pgQuery = pgQuery.replace(/\bUser\b/g, '"User"');
  
  return pgQuery;
}

// Executes query and maps response to mysql2 format
const keyMap = {
  userid: 'UserID', username: 'Username', password: 'Password', firstname: 'FirstName',
  lastname: 'LastName', dob: 'DoB', status: 'Status', planid: 'PlanID', planname: 'PlanName',
  type: 'Type', providerid: 'ProviderID', workingdayid: 'WorkingDayID', day: 'Day',
  exmoveid: 'ExMoveID', steps: 'Steps', description: 'Description', caution: 'Caution',
  url: 'URL', accessibility: 'Accessibility', recordtype: 'RecordType', progresstype: 'ProgressType',
  sessionid: 'SessionID', sessiondate: 'SessionDate', userweight: 'UserWeight', userheight: 'UserHeight',
  prid: 'PRID', trainerid: 'TrainerID',
  clientid: 'ClientID', dobstring: 'DoBString', exercisename: 'ExerciseName',
  plan_id: 'plan_id', provider_id: 'provider_id'
};

function mapKeys(rows) {
  if (!rows || !Array.isArray(rows)) return rows;
  return rows.map(row => {
    const newRow = {};
    for (let k in row) {
      const lowerK = k.toLowerCase();
      if (keyMap[lowerK]) {
        newRow[keyMap[lowerK]] = row[k];
      } else {
        newRow[k] = row[k];
      }
    }
    return newRow;
  });
}

async function executeQuery(client_or_pool, queryString, params = []) {
  const isSelect = /^\s*(SELECT|SHOW|DESCRIBE|EXPLAIN)/i.test(queryString);
  let pgQuery = convertQuery(queryString);
  
  if (/^\s*INSERT\s+INTO/i.test(queryString) && !/\bRETURNING\b/i.test(queryString)) {
    pgQuery += ' RETURNING *';
  }

  const commandResult = await client_or_pool.query(pgQuery, params);
  const mappedRows = mapKeys(commandResult.rows);

  if (isSelect) {
    return [mappedRows, commandResult.fields];
  } else {
    let insertId = 0;
    if (mappedRows && mappedRows.length > 0) {
       const keys = Object.keys(mappedRows[0]);
       const idColumn = keys.find(k => /(id)$/i.test(k)) || keys[0];
       insertId = mappedRows[0][idColumn];
    }
    const resultObj = {
      affectedRows: commandResult.rowCount,
      insertId: insertId,
      warningStatus: 0
    };
    return [resultObj, commandResult.fields];
  }
}

const dbAdapter = {
  query: async function (queryString, params = []) {
    return executeQuery(pool, queryString, params);
  },
  
  execute: async function (queryString, params = []) {
    return this.query(queryString, params);
  },
  
  getConnection: async function () {
    const client = await pool.connect();
    
    const connAdapter = {
      query: async function (queryString, params = []) {
        return executeQuery(client, queryString, params);
      },
      execute: async function (queryString, params = []) {
        return this.query(queryString, params);
      },
      beginTransaction: async function () {
        await client.query('BEGIN');
      },
      commit: async function () {
        await client.query('COMMIT');
      },
      rollback: async function () {
        await client.query('ROLLBACK');
      },
      release: function () {
        client.release();
      }
    };
    
    return connAdapter;
  }
};

pool.query('SELECT 1')
  .then(() => console.log("✅ Successfully connected to PostgreSQL!"))
  .catch(err => console.error("❌ Connection failed:", err.message));

module.exports = dbAdapter;