const { Client } = require('pg');
const client = new Client({ connectionString: 'postgres://marketos:marketos@localhost:5432/marketos' });
client.connect().then(async () => {
  try {
    const res1 = await client.query('SELECT count(*) FROM sector_snapshot');
    const res2 = await client.query('SELECT count(*) FROM eod_prices');
    const res3 = await client.query('SELECT count(*) FROM events');
    const res4 = await client.query('SELECT count(*) FROM candidates');
    console.log('sector_snapshot:', res1.rows[0].count);
    console.log('eod_prices:', res2.rows[0].count);
    console.log('events:', res3.rows[0].count);
    console.log('candidates:', res4.rows[0].count);
  } catch(e) { console.error(e) }
  finally { client.end(); }
});
