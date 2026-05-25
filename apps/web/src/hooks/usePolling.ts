import { useEffect, useRef } from 'react';

/**
 * usePolling —— 页面状态自动刷新。
 *
 * 在组件挂载期间，每隔 intervalMs 调用一次 callback，使预警 / 任务 / 绑定申请等
 * 列表无需用户手动 reload 即可保持 up-to-date。
 *
 * 设计要点：
 * - callback 用 ref 保存，每次渲染更新，避免闭包过期（始终调用最新的 callback，
 *   也就能读到最新的筛选条件 state），同时不会因 callback 变化而重建定时器。
 * - 页面 / 标签页不可见时（document.hidden）自动暂停轮询，重新可见时立即刷新一次，
 *   避免后台标签页持续打接口。
 * - enabled = false 时完全不轮询（例如未登录、详情页缺少 id）。
 * - 卸载时清理定时器与事件监听，不泄漏。
 */
export function usePolling(
  callback: () => void | Promise<unknown>,
  intervalMs: number,
  enabled: boolean = true,
): void {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return;

    let timer: number | undefined;

    const runCallback = () => {
      try {
        void savedCallback.current();
      } catch {
        // 轮询刷新失败不应中断页面，下个周期自动重试。
      }
    };

    const start = () => {
      if (timer !== undefined) return;
      timer = window.setInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) return;
        runCallback();
      }, intervalMs);
    };

    const stop = () => {
      if (timer !== undefined) {
        window.clearInterval(timer);
        timer = undefined;
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stop();
      } else {
        runCallback();
        start();
      }
    };

    start();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [intervalMs, enabled]);
}
