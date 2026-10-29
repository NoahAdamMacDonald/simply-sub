// The bot's secret, which `wrangler types` doesn't see: a fine-grained GitHub token for this repository only, with
// Contents and Pull requests read and write (`wrangler secret put GITHUB_TOKEN`; BLUEPRINT §7.2).
interface Env {
  GITHUB_TOKEN: string;
  // The discovery's web search (M3.11), each optional: an engine without its secret is skipped. TAVILY_API_KEY and
  // BRAVE_API_KEY are the engines' API keys; SEARXNG_URL is your own SearXNG instance's https address.
  TAVILY_API_KEY?: string;
  BRAVE_API_KEY?: string;
  SEARXNG_URL?: string;
}
