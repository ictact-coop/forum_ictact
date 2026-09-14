/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  // @libsql/client는 플랫폼별 네이티브 바인딩(옵셔널 디펜던시)을 포함하고 있어서,
  // Vercel 등 서버리스 환경에서 웹팩이 이를 그대로 번들링하려 하면 배포가 깨지거나
  // 함수 용량이 불필요하게 커질 수 있습니다. 서버 전용 패키지로 표시해 런타임에
  // node_modules에서 그대로 require하도록 합니다.
  serverExternalPackages: ["@libsql/client"],
};

module.exports = nextConfig;
