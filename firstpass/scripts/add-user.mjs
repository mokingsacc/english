// Makes a First Pass user: prints the SQL that adds them (hashes only) with the wrangler command to run it, and the two
// links, the page link with the key and the connector address with the token, each secret shown this once.
//   node scripts/add-user.mjs "Name" --origin https://firstpass.pages.dev
//   node scripts/add-user.mjs "Name" --dev        adds them straight to the dev server's database (.dev/dev.sqlite)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeUser, userSql, insertUser } from '../src/worker/store/users.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const name = args.find((a, i) => !a.startsWith('--') && !['--origin'].includes(args[i - 1]));
if (!name) {
  console.error('Give the person\'s name: node scripts/add-user.mjs "Name" --origin https://<your site>  (or --dev)');
  process.exit(1);
}
const dev = args.includes('--dev');
const origin = (flag('--origin') || (dev ? `http://127.0.0.1:${process.env.PORT || 8788}` : 'https://<your site>')).replace(/\/+$/, '');
const u = await makeUser(name);

if (dev) {
  const { createD1 } = await import('../tests/worker/d1-fake.mjs');
  const d1 = createD1({ file: path.join(ROOT, '.dev/dev.sqlite') });
  await insertUser(d1.DB, u);
  d1.close();
  console.log(`Added ${u.name} (${u.id}) to the dev database.`);
} else {
  const sql = userSql(u);
  console.log(`1. Add ${u.name} (${u.id}) to the database, from firstpass/:\n`);
  console.log(`   npx wrangler@4 d1 execute DB --remote --command "${sql.replace(/"/g, '\\"')}"\n`);
}
console.log(`${dev ? '' : '2. '}Give ${u.name} these two links. They are shown only now; the database keeps only their hashes.\n`);
console.log(`   Page:      ${origin}/#k=${u.key}`);
console.log(`   Connector: ${origin}/mcp/${u.token}   (in Claude: Settings, Connectors, Add custom connector)`);
