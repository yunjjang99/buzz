import { Store } from './store.mjs';
import { classify, destinations } from './classify.mjs';
const store = new Store(process.env.BUZZ_MAIL_DATA || './data');
try {
  const categories = {}; const examples = {};
  for (const row of store.db.prepare("SELECT event FROM messages WHERE account='kovar' AND sent=1").iterate()) {
    const result = classify(JSON.parse(row.event));
    categories[result.category] = (categories[result.category] || 0) + 1;
    examples[result.category] ||= [];
    if (examples[result.category].length < 5) examples[result.category].push({ subject: result.sensitive ? '(보안 알림)' : result.mail.subject, status: result.status });
  }
  console.log(JSON.stringify({ categories, examples, channels: Object.fromEntries(Object.entries(destinations).map(([k,v])=>[k,v.name])) }, null, 2));
} finally { store.close(); }
