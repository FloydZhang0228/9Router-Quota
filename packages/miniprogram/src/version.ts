/**
 * 版本号展示。本地 dev 构建显示 "dev"；
 * CI 打包时用 tag 覆写这个常量（见 .github/workflows/release.yml 的
 * "Stamp mini-program version" 步骤），不提交、不回推。
 */
export const APP_VERSION = 'dev';
