// The bot's secret, which `wrangler types` doesn't see: a fine-grained GitHub token for this repository only, with
// Contents and Pull requests read and write (`wrangler secret put GITHUB_TOKEN`; BLUEPRINT §7.2).
interface Env {
  GITHUB_TOKEN: string;
}
