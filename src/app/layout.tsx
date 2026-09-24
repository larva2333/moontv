/* eslint-disable @typescript-eslint/no-explicit-any */

import type { Metadata, Viewport } from 'next';

import './globals.css';
import 'sweetalert2/dist/sweetalert2.min.css';

import { getConfig } from '@/lib/config';
import RuntimeConfig from '@/lib/runtime';

import { GlobalErrorIndicator } from '../components/GlobalErrorIndicator';
import { SiteProvider } from '../components/SiteProvider';
import { ThemeProvider } from '../components/ThemeProvider';

// 动态生成 metadata，支持配置更新后的标题变化
export async function generateMetadata(): Promise<Metadata> {
  let siteName = process.env.SITE_NAME2 || 'MoonTV';
  if (
    process.env.NEXT_PUBLIC_STORAGE_TYPE !== 'd1' &&
    process.env.NEXT_PUBLIC_STORAGE_TYPE !== 'upstash'
  ) {
    const config = await getConfig();
    siteName = config.SiteConfig.SiteName;
  }

  return {
    title: siteName,
    description: '影视聚合',
    manifest: '/manifest.json',
  };
}

export const viewport: Viewport = {
  themeColor: '#000000',
  viewportFit: 'cover',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let siteName = process.env.SITE_NAME2 || 'MoonTV';
  let announcement =
    process.env.ANNOUNCEMENT ||
    '本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。本站不存储任何视频资源，不对任何内容的准确性、合法性、完整性负责。';
  let enableRegister = process.env.NEXT_PUBLIC_ENABLE_REGISTER === 'true';
  let imageProxy = process.env.NEXT_PUBLIC_IMAGE_PROXY || '';
  let doubanProxy = process.env.NEXT_PUBLIC_DOUBAN_PROXY || '';
  let disableYellowFilter =
    process.env.NEXT_PUBLIC_DISABLE_YELLOW_FILTER === 'true';
  let customCategories =
    (RuntimeConfig as any).custom_category?.map((category: any) => ({
      name: 'name' in category ? category.name : '',
      type: category.type,
      query: category.query,
    })) || ([] as Array<{ name: string; type: 'movie' | 'tv'; query: string }>);
  if (
    process.env.NEXT_PUBLIC_STORAGE_TYPE !== 'd1' &&
    process.env.NEXT_PUBLIC_STORAGE_TYPE !== 'upstash'
  ) {
    const config = await getConfig();
    siteName = config.SiteConfig.SiteName;
    announcement = config.SiteConfig.Announcement;
    enableRegister = config.UserConfig.AllowRegister;
    imageProxy = config.SiteConfig.ImageProxy;
    doubanProxy = config.SiteConfig.DoubanProxy;
    disableYellowFilter = config.SiteConfig.DisableYellowFilter;
    customCategories = config.CustomCategories.filter(
      (category) => !category.disabled
    ).map((category) => ({
      name: category.name || '',
      type: category.type,
      query: category.query,
    }));
  }

  // 将运行时配置注入到全局 window 对象，供客户端在运行时读取
  const runtimeConfig = {
    STORAGE_TYPE: process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage',
    ENABLE_REGISTER: enableRegister,
    IMAGE_PROXY: imageProxy,
    DOUBAN_PROXY: doubanProxy,
    DISABLE_YELLOW_FILTER: disableYellowFilter,
    CUSTOM_CATEGORIES: customCategories,
  };

  return (
    <html lang='zh-CN' suppressHydrationWarning>
      <head>
        {/* 防深色模式首屏白闪(FOUC)：在 <html> 解析早期、<body> 绘制前，依据
            next-themes 默认配置(storageKey='theme', defaultTheme='system')同步设置 dark 类。
            逻辑与 next-themes 客户端一致，确保深色用户首帧即深色，避免白底一闪。 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=localStorage.getItem('theme');var t=s||'system';var d=window.matchMedia('(prefers-color-scheme: dark)').matches;var dark=t==='dark'||(t==='system'&&d)||(t==='auto'&&d);var e=document.documentElement;if(dark){e.classList.add('dark');}else{e.classList.remove('dark');}e.style.colorScheme=dark?'dark':'light';}catch(_){}})();`,
          }}
        />
        {/* 内联关键 CSS：在外部 tailwind/globals.css 加载前就确保 body 背景色正确，
            彻底消除 Netlify 上因 CDN/Edge CSS 微延迟导致的深色模式白闪。
            这段 <style> 紧跟在防 FOUC 脚本之后，脚本已为 <html> 设置好 dark 类，
            所以 html.dark body 和 html:not(.dark) body 选择器能立即匹配。 */}
        <style
          dangerouslySetInnerHTML={{
            __html: `html.dark body{background-color:#000!important;color:#e5e7eb!important}html:not(.dark) body{background:linear-gradient(180deg,#e6f3fb 0%,#eaf3f7 18%,#f7f7f3 38%,#e9ecef 60%,#dbe3ea 80%,#d3dde6 100%)!important;background-attachment:fixed!important;color:#111827!important}`,
          }}
        />
        <meta
          name='viewport'
          content='width=device-width, initial-scale=1.0, viewport-fit=cover'
        />
        <link rel='apple-touch-icon' href='/icons/icon-192x192.png' />
        {/* Inter 字体：不用 next/font/google，直接 <link> 加载避免 Netlify OpenNext
            强制注入额外的 font preload 链接（导致 <head> 结构错位 → React #418）。 */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel='stylesheet'
          href='https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap'
        />
        {/* 和 Netlify OpenNext 运行时注入保持一致，消除 SSR/客户端结构差 */}
        <meta name='next-size-adjust' />
        {/* favicon 按系统深浅色切换：浅色用蓝色电视，深色用白色电视 */}
        <link
          rel='icon'
          href='/favicon.ico'
          media='(prefers-color-scheme: light)'
        />
        <link
          rel='icon'
          href='/favicon-dark.ico'
          media='(prefers-color-scheme: dark)'
        />
        {/* 预加载侧边栏 logo 图标，避免硬刷新时图片从网络重新拉取出现半秒空白闪 */}
        <link rel='preload' as='image' href='/icons/icon-192x192.png' />
        <link rel='preload' as='image' href='/icons/icon-192x192-dark.png' />
        {/* 将配置序列化后直接写入脚本，浏览器端可通过 window.RUNTIME_CONFIG 获取 */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        {/* 首帧即根据 localStorage 设定侧边栏收起态，避免 SSR 展开首帧导致的刷新跳动 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem('sidebarCollapsed')==='true'){document.documentElement.setAttribute('data-sidebar-collapsed','true');}}catch(e){}`,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `window.RUNTIME_CONFIG = ${JSON.stringify(runtimeConfig)};`,
          }}
        />
      </head>
      <body className='min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-200'>
        <ThemeProvider
          attribute='class'
          defaultTheme='system'
          enableSystem
          disableTransitionOnChange
        >
          <SiteProvider siteName={siteName} announcement={announcement}>
            {children}
            <GlobalErrorIndicator />
          </SiteProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
