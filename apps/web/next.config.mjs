/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @wabao/shared 为 workspace 内的 TS 源码包，交给 Next 编译
  transpilePackages: ["@wabao/shared"],
};

export default nextConfig;
