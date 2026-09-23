/* eslint-disable @typescript-eslint/no-explicit-any, @next/next/no-img-element */

'use client';

import { Clover, Film, Home, Menu, Search, Star, Tv } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { useSite } from './SiteProvider';

interface SidebarContextType {
  isCollapsed: boolean;
}

const SidebarContext = createContext<SidebarContextType>({
  isCollapsed: false,
});

export const useSidebar = () => useContext(SidebarContext);

// 可替换为你自己的 logo 图片
const Logo = () => {
  const { siteName } = useSite();
  return (
    <Link
      href='/'
      className='flex items-center justify-start gap-2 h-16 pl-4 select-none hover:opacity-80 transition-opacity duration-200'
    >
      {/* 浅色模式用蓝色电视，深色模式用白色电视 */}
      <img
        src='/icons/icon-192x192.png'
        alt='logo'
        width={32}
        height={32}
        className='h-8 w-8 shrink-0 object-contain block dark:hidden'
      />
      <img
        src='/icons/icon-192x192-dark.png'
        alt='logo'
        width={32}
        height={32}
        className='h-8 w-8 shrink-0 object-contain hidden dark:block'
      />
      <span className='sidebar-text whitespace-nowrap inline-flex h-8 items-center text-2xl font-bold leading-none text-green-600 tracking-tight'>
        {siteName}
      </span>
    </Link>
  );
};

interface SidebarProps {
  onToggle?: (collapsed: boolean) => void;
  activePath?: string;
}

// 在浏览器环境下通过全局变量缓存折叠状态，避免组件重新挂载时出现初始值闪烁
declare global {
  interface Window {
    __sidebarCollapsed?: boolean;
  }
}

// 同构 layoutEffect：SSR 用 useEffect（不执行、无 warning），
// 客户端用 useLayoutEffect（浏览器首次绘制前同步执行），读取 localStorage 后即时重渲染，
// 因此「收起态刷新」不会出现先展开再收起的闪烁。
const useIsoLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

const Sidebar = ({ onToggle, activePath = '/' }: SidebarProps) => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // 初始态固定为展开(false)：服务端渲染与客户端水合首帧完全一致，
  // 从根本上消除 Hydration mismatch；真实折叠状态由下方 layoutEffect 在绘制前同步应用。
  // 客户端 CSR 首帧即读取 localStorage 决定折叠态，直接以正确宽度渲染，
  // 从根上消灭「先展开(w-64)再收起」导致的刷新瞬间文字漏出。
  // 主页为纯客户端渲染(SSR 不输出 <aside>)，无 hydration 需求；
  // 若个别页面 SSR 输出了侧边栏，<aside> 上的 suppressHydrationWarning 会抑制告警。
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('sidebarCollapsed');
        return saved !== null ? (JSON.parse(saved) as boolean) : false;
      } catch {
        return false;
      }
    }
    return false;
  });
  const [menuReady, setMenuReady] = useState(true);
  const [widthReady, setWidthReady] = useState(false);
  const isFirstMenuEffect = useRef(true);

  useIsoLayoutEffect(() => {
    try {
      const collapsed = isCollapsed;
      setMenuReady(!collapsed);
      window.__sidebarCollapsed = collapsed;
      // 同步 <html> 属性，配合 globals.css 收起态 CSS（双保险）
      if (collapsed) {
        document.documentElement.setAttribute('data-sidebar-collapsed', 'true');
      } else {
        document.documentElement.removeAttribute('data-sidebar-collapsed');
      }
    } catch {
      /* 忽略 localStorage 读取失败 */
    }
  }, []);

  // 仅在用户点击「从收起展开」后延迟显示按钮，避免宽条动画中途按钮抢先出现。
  // 首轮 effect 与 layoutEffect 同步过的状态对齐，不再额外延时。
  useEffect(() => {
    if (isFirstMenuEffect.current) {
      isFirstMenuEffect.current = false;
      return;
    }
    if (isCollapsed) {
      setMenuReady(false);
      return;
    }
    const t = setTimeout(() => setMenuReady(true), 320);
    return () => clearTimeout(t);
  }, [isCollapsed]);

  // 首帧关闭 width transition，避免刷新时从默认值过渡到目标宽度带动整栏抖动。
  useEffect(() => {
    setWidthReady(true);
  }, []);

  const [active, setActive] = useState(activePath);

  useEffect(() => {
    // 优先使用传入的 activePath
    if (activePath) {
      setActive(activePath);
    } else {
      // 否则使用当前路径
      const getCurrentFullPath = () => {
        const queryString = searchParams.toString();
        return queryString ? `${pathname}?${queryString}` : pathname;
      };
      const fullPath = getCurrentFullPath();
      setActive(fullPath);
    }
  }, [activePath, pathname, searchParams]);

  const handleToggle = useCallback(() => {
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    localStorage.setItem('sidebarCollapsed', JSON.stringify(newState));
    if (typeof window !== 'undefined') {
      window.__sidebarCollapsed = newState;
    }
    if (typeof document !== 'undefined') {
      if (newState) {
        document.documentElement.setAttribute('data-sidebar-collapsed', 'true');
      } else {
        document.documentElement.removeAttribute('data-sidebar-collapsed');
      }
    }
    onToggle?.(newState);
  }, [isCollapsed, onToggle]);

  const handleSearchClick = useCallback(() => {
    router.push('/search');
  }, [router]);

  const contextValue = {
    isCollapsed,
  };

  const [menuItems, setMenuItems] = useState([
    {
      icon: Film,
      label: '电影',
      href: '/douban?type=movie',
    },
    {
      icon: Tv,
      label: '剧集',
      href: '/douban?type=tv',
    },
    {
      icon: Clover,
      label: '综艺',
      href: '/douban?type=show',
    },
  ]);

  useEffect(() => {
    const runtimeConfig = (window as any).RUNTIME_CONFIG;
    if (runtimeConfig?.CUSTOM_CATEGORIES?.length > 0) {
      setMenuItems((prevItems) => [
        ...prevItems,
        {
          icon: Star,
          label: '自定义',
          href: '/douban?type=custom',
        },
      ]);
    }
  }, []);

  return (
    <SidebarContext.Provider value={contextValue}>
      {/* 在移动端隐藏侧边栏 */}
      <div className='hidden md:flex'>
        <aside
          data-sidebar
          suppressHydrationWarning
          className={`fixed top-0 left-0 isolate z-10 h-screen border-r border-gray-200/50 shadow-lg dark:border-gray-700/50 ${
            widthReady ? 'transition-[width] duration-300' : ''
          } ${isCollapsed ? 'w-16' : 'w-64'}`}
        >
          {/* 模糊层与文字分离，避免 overflow + backdrop-filter 在刷新时把文字重新栅格化导致上跳 */}
          <div
            aria-hidden
            className='pointer-events-none absolute inset-0 -z-10 bg-white/40 backdrop-blur-xl dark:bg-gray-900/70'
            style={{
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
            }}
          />
          <div className='relative flex h-full flex-col overflow-x-hidden'>
            {/* 顶部 Logo 区域 */}
            <div className='relative h-16 shrink-0'>
              {/* 始终渲染 Logo，使 logo 的 <img> 节点在展开/收起间保持稳定，
                  避免条件渲染替换 DOM 子树导致图标重新加载闪烁 */}
              <Logo />
              {/* 收起态：覆盖一层透明按钮接管「点击展开」，不影响 Logo 的 img 节点 */}
              {isCollapsed && (
                <button
                  type='button'
                  onClick={handleToggle}
                  aria-label='展开侧边栏'
                  className='absolute inset-0 z-0 cursor-pointer bg-transparent border-0 p-0 appearance-none hover:opacity-80 transition-opacity duration-200'
                />
              )}
              {menuReady && (
                <button
                  onClick={handleToggle}
                  data-sidebar-collapse
                  aria-label='收起侧边栏'
                  className='absolute top-1/2 -translate-y-1/2 right-2 flex items-center justify-center w-8 h-8 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100/50 transition-colors duration-200 z-10 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-700/50'
                >
                  <Menu className='h-4 w-4' />
                </button>
              )}
            </div>

            {/* 首页和搜索导航 */}
            <nav className='px-2 mt-4 space-y-1'>
              <Link
                href='/'
                onClick={() => setActive('/')}
                data-active={active === '/'}
                className={`group flex items-center rounded-lg px-2 py-2 pl-4 text-gray-700 hover:bg-gray-100/30 hover:text-green-600 data-[active=true]:bg-green-500/20 data-[active=true]:text-green-700 font-medium transition-colors duration-200 min-h-[40px] dark:text-gray-300 dark:hover:text-green-400 dark:data-[active=true]:bg-green-500/10 dark:data-[active=true]:text-green-400 ${
                  isCollapsed ? 'w-full max-w-none mx-0' : 'mx-0'
                } gap-3 justify-start`}
              >
                <div className='w-4 h-4 flex items-center justify-center'>
                  <Home className='h-4 w-4 text-gray-500 group-hover:text-green-600 data-[active=true]:text-green-700 dark:text-gray-400 dark:group-hover:text-green-400 dark:data-[active=true]:text-green-400' />
                </div>
                <span className='sidebar-text inline-flex h-4 items-center whitespace-nowrap leading-none'>
                  首页
                </span>
              </Link>
              <Link
                href='/search'
                onClick={(e) => {
                  e.preventDefault();
                  handleSearchClick();
                  setActive('/search');
                }}
                data-active={active === '/search'}
                className={`group flex items-center rounded-lg px-2 py-2 pl-4 text-gray-700 hover:bg-gray-100/30 hover:text-green-600 data-[active=true]:bg-green-500/20 data-[active=true]:text-green-700 font-medium transition-colors duration-200 min-h-[40px] dark:text-gray-300 dark:hover:text-green-400 dark:data-[active=true]:bg-green-500/10 dark:data-[active=true]:text-green-400 ${
                  isCollapsed ? 'w-full max-w-none mx-0' : 'mx-0'
                } gap-3 justify-start`}
              >
                <div className='w-4 h-4 flex items-center justify-center'>
                  <Search className='h-4 w-4 text-gray-500 group-hover:text-green-600 data-[active=true]:text-green-700 dark:text-gray-400 dark:group-hover:text-green-400 dark:data-[active=true]:text-green-400' />
                </div>
                <span className='sidebar-text inline-flex h-4 items-center whitespace-nowrap leading-none'>
                  搜索
                </span>
              </Link>
            </nav>

            {/* 菜单项 */}
            <div className='flex-1 overflow-y-auto px-2 pt-4'>
              <div className='space-y-1'>
                {menuItems.map((item) => {
                  // 检查当前路径是否匹配这个菜单项
                  const typeMatch = item.href.match(/type=([^&]+)/)?.[1];

                  // 解码URL以进行正确的比较
                  const decodedActive = decodeURIComponent(active);
                  const decodedItemHref = decodeURIComponent(item.href);

                  const isActive =
                    decodedActive === decodedItemHref ||
                    (decodedActive.startsWith('/douban') &&
                      decodedActive.includes(`type=${typeMatch}`));
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.label}
                      href={item.href}
                      onClick={() => setActive(item.href)}
                      data-active={isActive}
                      className={`group flex items-center rounded-lg px-2 py-2 pl-4 text-sm text-gray-700 hover:bg-gray-100/30 hover:text-green-600 data-[active=true]:bg-green-500/20 data-[active=true]:text-green-700 transition-colors duration-200 min-h-[40px] dark:text-gray-300 dark:hover:text-green-400 dark:data-[active=true]:bg-green-500/10 dark:data-[active=true]:text-green-400 ${
                        isCollapsed ? 'w-full max-w-none mx-0' : 'mx-0'
                      } gap-3 justify-start`}
                    >
                      <div className='w-4 h-4 flex items-center justify-center'>
                        <Icon className='h-4 w-4 text-gray-500 group-hover:text-green-600 data-[active=true]:text-green-700 dark:text-gray-400 dark:group-hover:text-green-400 dark:data-[active=true]:text-green-400' />
                      </div>
                      <span className='sidebar-text inline-flex h-4 items-center whitespace-nowrap leading-none'>
                        {item.label}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        </aside>
        <div
          className={`sidebar-offset ${
            widthReady ? 'transition-[width] duration-300' : ''
          } ${isCollapsed ? 'w-16' : 'w-64'}`}
        ></div>
      </div>
    </SidebarContext.Provider>
  );
};

export default Sidebar;
