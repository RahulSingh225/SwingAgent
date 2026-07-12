const { Client } = require('pg');
const client = new Client({ connectionString: 'postgres://marketos:marketos@localhost:5432/marketos' });
client.connect().then(async () => {
  try {
    const res = await client.query('SELECT DISTINCT index_name FROM sector_snapshot');
    console.log(res.rows.map(r => r.index_name).sort().join('\n'));
  } catch(e) { console.error(e) }
  finally { client.end(); }
});
