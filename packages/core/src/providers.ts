/**
 * provider 单一真源：服务名、公司、logo 文件名一处定义。
 *
 * 收录范围 = 9router 服务端 `features.usage === true` 的 provider（open-sse/providers/registry/*.js
 * 汇总成 USAGE_SUPPORTED_PROVIDERS），只有它们会出现在 /api/providers/client 的返回里。
 * logo 素材从 9router 的 public/providers/ 拷进 media/providers/，文件名与 key 一致。
 * 服务端新增了而这里还没登记时不会报错：名字回落成 provider 原文，图标走首字母徽标。
 */
export type ProviderInfo = {
  service: string;
  company: string;
  logo: string | null;
};

export const PROVIDERS: Record<string, ProviderInfo> = {
  github: { service: 'GitHub Copilot', company: 'GitHub（Microsoft）', logo: 'github.png' },
  'gemini-cli': { service: 'Gemini CLI', company: 'Google', logo: 'gemini-cli.png' },
  antigravity: { service: 'Antigravity', company: 'Google', logo: 'antigravity.png' },
  claude: { service: 'Claude', company: 'Anthropic', logo: 'claude.png' },
  codex: { service: 'OpenAI', company: 'OpenAI', logo: 'codex.png' },
  kiro: { service: 'Kiro AI', company: 'Amazon Web Services（AWS）', logo: 'kiro.png' },
  qoder: { service: 'Qoder', company: 'Alibaba', logo: 'qoder.png' },
  ollama: { service: 'Ollama Cloud', company: 'Ollama', logo: 'ollama.png' },
  glm: { service: 'GLM Coding', company: '智谱 AI', logo: 'glm.png' },
  'glm-cn': { service: 'GLM China', company: '智谱 AI', logo: 'glm-cn.png' },
  minimax: { service: 'MiniMax Coding', company: 'MiniMax', logo: 'minimax.png' },
  'minimax-cn': { service: 'MiniMax China', company: 'MiniMax', logo: 'minimax-cn.png' },
  'vercel-ai-gateway': { service: 'Vercel AI Gateway', company: 'Vercel', logo: 'vercel-ai-gateway.png' },
  'codebuddy-cn': { service: 'CodeBuddy CN', company: '腾讯', logo: 'codebuddy-cn.png' },
  'codebuddy-intl': { service: 'CodeBuddy', company: '腾讯', logo: 'codebuddy-intl.png' },
  'grok-cli': { service: 'Grok CLI', company: 'xAI', logo: 'grok-cli.png' },
  kimi: { service: 'Kimi', company: '月之暗面（Moonshot AI）', logo: 'kimi.png' },
  deepseek: { service: 'DeepSeek', company: '深度求索', logo: 'deepseek.png' },
  zed: { service: 'Zed', company: 'Zed Industries', logo: 'zed.png' },
};

export function describeProvider(provider: string): { service: string; company: string } {
  const info = PROVIDERS[provider];
  return { service: info?.service ?? provider, company: info?.company ?? '未知' };
}

/** media/providers/ 下的 logo 文件名；未登记的 provider 返回 null，调用方自行兜底。 */
export function providerLogo(provider: string): string | null {
  return PROVIDERS[provider]?.logo ?? null;
}
