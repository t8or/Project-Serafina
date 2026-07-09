/**
 * Local Ollama readiness adapter.
 *
 * Its only current interface is checkAvailability(). Keep model generation out
 * of this module until a concrete, non-authoritative local review workflow
 * exists and has tests. The runtime never selects a cloud model or fallback.
 */

import {
  OLLAMA_BASE_URL,
  OLLAMA_MODEL,
  assertLoopbackUrl,
} from '../config/runtime_paths.js';

class OllamaService {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || OLLAMA_BASE_URL;
    this.model = options.model || OLLAMA_MODEL;
    assertLoopbackUrl(this.baseUrl, 'SERAFINA_OLLAMA_BASE_URL');
  }

  async checkAvailability() {
    try {
      const response = await fetch(new URL('/api/tags', this.baseUrl), {
        signal: AbortSignal.timeout(3_000),
      });
      if (!response.ok) throw new Error(`Ollama responded with ${response.status}`);
      const { models = [] } = await response.json();
      const names = models.map((entry) => entry.name);
      return {
        available: names.includes(this.model),
        configuredModel: this.model,
        installedModels: names,
        error: names.includes(this.model) ? undefined : `Configured model ${this.model} is not installed`,
      };
    } catch (error) {
      return { available: false, configuredModel: this.model, installedModels: [], error: error.message };
    }
  }
}

export { OllamaService };
