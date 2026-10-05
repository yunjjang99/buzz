import { Store } from './store.mjs';
import { Relay } from './relay.mjs';
const store = new Store(process.env.BUZZ_MAIL_DATA || './data');
const relay = new Relay(store);
try {
  if (process.argv[2] === 'identity') console.log(relay.pubkey);
  else if (process.argv[2] === 'relay') { await relay.setup(); console.log('Buzz mail channels ready'); }
  else throw new Error('Use identity or relay');
} finally { store.close(); }
