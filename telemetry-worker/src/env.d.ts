// Wrangler generates the non-secret bindings from its configuration. Secrets
// are configured separately and need a declaration without a stored value.
interface Env {
  POSTHOG_KEY: string;
}
