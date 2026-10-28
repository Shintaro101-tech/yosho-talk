// URL of the Cloudflare Worker relay that holds the OpenAI API key (see worker/).
// While developing on localhost, the local `wrangler dev` server is used.
const DEPLOYED_WORKER_URL = 'https://yosho-talk-api.gotta-do-more-gotta-be-more.workers.dev';

export const WORKER_URL = ['localhost', '127.0.0.1'].includes(location.hostname)
  ? 'http://localhost:8787'
  : DEPLOYED_WORKER_URL;

// Accounts (Supabase). Leave both empty to keep the passcode-only mode.
// The publishable (anon) key is meant to be public: it only allows what the database's
// row level security allows (each account reads and writes its own rows).
export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';
