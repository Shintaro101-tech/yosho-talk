// URL of the Cloudflare Worker relay that holds the OpenAI API key (see worker/).
// While developing on localhost, the local `wrangler dev` server is used.
const DEPLOYED_WORKER_URL = '';

export const WORKER_URL = ['localhost', '127.0.0.1'].includes(location.hostname)
  ? 'http://localhost:8787'
  : DEPLOYED_WORKER_URL;
