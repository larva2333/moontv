/* 无害空 Service Worker —— 用于 Neutralize 旧版本 next-pwa 残留的 SW 缓存。
 *
 * 背景：本站已关闭 next-pwa（见 next.config.js）。但部分浏览器仍装着旧部署生成的
 * Service Worker，会长期缓存「上一次部署」的 HTML/JS，导致新部署后版本错配（#418/#423 闪屏）。
 *
 * 此文件随部署发布到 /sw.js。已安装旧 SW 的浏览器在下次 SW 更新检查时拉到本文件，
 * 因内容不同会激活本 SW：它不缓存任何资源、并清空所有旧缓存，从而让页面恢复走网络、消除错配。
 * 新访问的用户本就不会注册 SW（注册脚本已移除），不受任何影响。
 */
self.addEventListener('install', function () {
  // 立即激活，取代旧 SW
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  // 仅清空所有旧缓存，避免旧 SW 残留的 HTML/JS 缓存继续被派发。
  // 不调用 clients.claim()，避免强行接管已打开页面触发 React 重渲染（#329 瞬时抖动）。
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (key) {
          return caches.delete(key);
        })
      );
    })
  );
});

// 不注册 fetch 监听：所有资源都直接走网络，不再有缓存错配风险。
