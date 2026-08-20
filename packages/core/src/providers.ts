export const PROVIDERS: Record<string, [service: string, company: string]> = {
  github: ['GitHub Copilot', 'GitHub（Microsoft）'],
  'gemini-cli': ['Gemini CLI', 'Google'],
  antigravity: ['Antigravity', 'Google'],
  claude: ['Claude', 'Anthropic'],
  codex: ['OpenAI', 'OpenAI'],
  kiro: ['Kiro AI', 'Amazon Web Services（AWS）'],
  qoder: ['Qoder', 'Alibaba'],
  ollama: ['Ollama Cloud', 'Ollama'],
  glm: ['GLM Coding', '智谱 AI'],
  'glm-cn': ['GLM China', '智谱 AI'],
  minimax: ['MiniMax Coding', 'MiniMax'],
  'minimax-cn': ['MiniMax China', 'MiniMax'],
  'vercel-ai-gateway': ['Vercel AI Gateway', 'Vercel'],
  'codebuddy-cn': ['CodeBuddy CN', '腾讯'],
  'codebuddy-intl': ['CodeBuddy', '腾讯'],
  'grok-cli': ['Grok CLI', 'xAI'],
  kimi: ['Kimi', '月之暗面（Moonshot AI）'],
  deepseek: ['DeepSeek', '深度求索'],
};

export function describeProvider(provider: string): { service: string; company: string } {
  const [service, company] = PROVIDERS[provider] ?? [provider, '未知'];
  return { service, company };
}
