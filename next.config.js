/** @type {import('next').NextConfig} */
/* eslint-disable @typescript-eslint/no-var-requires */
const nextConfig = {
  eslint: {
    dirs: ['src'],
  },

  reactStrictMode: false,
  swcMinify: true,

  // 关闭自动字体优化：不再把字体提取成 /_next/static/media/*.woff2 并注入
  // <link rel=preload as=font>。Netlify 的 @netlify/plugin-nextjs 运行时会对这些
  // 提取出的字体额外注入 preload 链接，而本地 next start 不会，导致线上 <head>
  // 比本地多一个元素、节点顺序错位 -> React 水合结构不匹配 (#418/#423 闪屏)。
  // 关闭后字体按 CSS @font-face 原样加载，无 preload 注入，本地/线上 head 结构一致。
  optimizeFonts: false,

  async headers() {
    return [
      {
        // 图标等长期不变的静态资源：强制浏览器长期缓存（immutable），
        // 避免每次刷新都重新从网络下载导致闪烁。
        source: '/icons/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        // 应用到所有路由，或精确指定到你的API路由，如 '/api/:path*'
        source: '/api/:path*',
        headers: [
          {
            key: 'Netlify-Vary',
            value: 'query', // 关键：告诉Netlify区分查询参数
          },
        ],
      },
    ];
  },

  // Uncoment to add domain whitelist
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: '**',
      },
    ],
  },

  webpack(config) {
    // Grab the existing rule that handles SVG imports
    const fileLoaderRule = config.module.rules.find((rule) =>
      rule.test?.test?.('.svg')
    );

    config.module.rules.push(
      // Reapply the existing rule, but only for svg imports ending in ?url
      {
        ...fileLoaderRule,
        test: /\.svg$/i,
        resourceQuery: /url/, // *.svg?url
      },
      // Convert all other *.svg imports to React components
      {
        test: /\.svg$/i,
        issuer: { not: /\.(css|scss|sass)$/ },
        resourceQuery: { not: /url/ }, // exclude if *.svg?url
        loader: '@svgr/webpack',
        options: {
          dimensions: false,
          titleProp: true,
        },
      }
    );

    // Modify the file loader rule to ignore *.svg, since we have it handled now.
    fileLoaderRule.exclude = /\.svg$/i;

    config.resolve.fallback = {
      ...config.resolve.fallback,
      net: false,
      tls: false,
      crypto: false,
    };

    return config;
  },
};

// 关闭 Service Worker（PWA）。
// 根因：next-pwa 生成的 SW 会在浏览器里长期缓存「上一次部署」的 HTML/JS，
// 新部署后 SW 仍派发旧缓存 → 与新的客户端 JS 版本错配 → React #418/#423 整页重渲染（闪屏）。
// 此工具是登录制内部站点，不需要离线/PWA，关掉即从根上消除该问题。
// 若日后确需 PWA，请改用「navigation 走 NetworkFirst、永不缓存 HTML」的安全配置，且每次部署必须 bump SW 缓存版本。
const withPWA = require('next-pwa')({
  dest: 'public',
  disable: true, // 始终关闭，不再生成/注册会错配的 Service Worker
  register: false,
  skipWaiting: false,
});

module.exports = withPWA(nextConfig);
