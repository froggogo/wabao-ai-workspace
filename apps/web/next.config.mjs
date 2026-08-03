/** @type {import('next').NextConfig} */

// 后端内网地址（与 lib/server/auth.ts 的 backendUrl 保持一致）。
// 媒体静态资源由后端 /uploads 托管，这里做同源重写，让浏览器可以直接用
// <img src="/uploads/xxx.png">，避免跨域与 CORS 配置。
const apiBase = (process.env.API_INTERNAL_URL ?? "http://localhost:3001/api/v1").replace(
  /\/api\/v1\/?$/,
  "",
);

const nextConfig = {
  reactStrictMode: true,
  // @wabao/shared 为 workspace 内的 TS 源码包，交给 Next 编译
  transpilePackages: ["@wabao/shared"],
  async rewrites() {
    return [
      {
        source: "/uploads/:path*",
        destination: `${apiBase}/uploads/:path*`,
      },
    ];
  },
};

export default nextConfig;
