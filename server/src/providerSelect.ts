import { cfg } from './config.js';
import { claudeProvider } from './providers.js';
import type { Provider } from './providers.js';
import { demoProviders } from './demoProviders.js';

// Demo mode: scripted colleagues, used when the Anthropic key is missing (or DEMO_MODE=1). The UI says so, so it is never mistaken for real.
export const isDemo = () => process.env.DEMO_MODE === '1' || !cfg.anthropicKey;

let real: { claude: Provider; gpt: Provider } | null = null;
export function providersFor(): { claude: Provider; gpt: Provider } {
  if (isDemo()) return demoProviders();
  return (real ??= { claude: claudeProvider(), gpt: claudeProvider('gpt') });
}
