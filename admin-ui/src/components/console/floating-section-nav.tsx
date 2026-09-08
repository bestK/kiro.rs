import { useEffect, useState, useRef, useCallback } from 'react'
import { cn } from '@/lib/utils'

export interface NavSectionItem {
  id: string
  title: string
}

export interface FloatingSectionNavProps {
  items: NavSectionItem[]
  className?: string
}

/**
 * 页面右侧固定模块目录导航
 * - 默认为横线，模块数量对应横线数量
 * - 鼠标悬浮时向左弹出模块名字，横条视觉微展
 * - 点击平滑滚动至对应模块（支持动画期间防跳变锁）
 * - 跟随页面滚动自动高亮当前模块（RAF 节流 + 零额外重排重绘）
 */
export function FloatingSectionNav({ items, className }: FloatingSectionNavProps) {
  const [activeId, setActiveId] = useState<string>(items[0]?.id || '')
  const activeIdRef = useRef<string>(activeId)
  const isProgrammaticScrollRef = useRef<boolean>(false)
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 仅在真实发生变更时才触发 React 状态更新，杜绝重复渲染开销
  const setActiveSafe = useCallback((nextId: string) => {
    if (activeIdRef.current !== nextId) {
      activeIdRef.current = nextId
      setActiveId(nextId)
    }
  }, [])

  // 滚动高亮检测算法
  const updateActive = useCallback(() => {
    if (items.length === 0) return

    const main = document.querySelector('main')

    // 1. 如果已滚动触底，高亮最后一个模块
    if (main) {
      const isAtBottom = main.scrollHeight - main.scrollTop - main.clientHeight <= 48
      if (isAtBottom) {
        setActiveSafe(items[items.length - 1].id)
        return
      }
    } else {
      const isAtBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 48
      if (isAtBottom) {
        setActiveSafe(items[items.length - 1].id)
        return
      }
    }

    // 2. 基于滚动视口相对顶部判定模块可视性
    const containerTop = main ? main.getBoundingClientRect().top : 0
    const threshold = containerTop + 140

    for (let i = items.length - 1; i >= 0; i--) {
      const el = document.getElementById(items[i].id)
      if (el) {
        const rect = el.getBoundingClientRect()
        if (rect.top <= threshold) {
          setActiveSafe(items[i].id)
          return
        }
      }
    }

    // 3. 兜底高亮首个
    if (items.length > 0) {
      setActiveSafe(items[0].id)
    }
  }, [items, setActiveSafe])

  // 滚动监听绑定：采用 requestAnimationFrame 帧率对齐节流
  useEffect(() => {
    if (items.length === 0) return

    updateActive()

    const main = document.querySelector('main')
    const scrollTarget = main || window
    let rafId: number | null = null

    const onScroll = () => {
      // 若处于点击平滑滚动锁定中，跳过被动高亮检测，防止指示器沿途剧烈跳变
      if (isProgrammaticScrollRef.current) return

      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        updateActive()
      })
    }

    // 若用户在平滑滚动期间主动操作滚轮/触摸板，立刻释放锁定恢复自由跟随
    const onUserInterrupt = () => {
      if (isProgrammaticScrollRef.current) {
        isProgrammaticScrollRef.current = false
        if (scrollTimeoutRef.current) {
          clearTimeout(scrollTimeoutRef.current)
          scrollTimeoutRef.current = null
        }
      }
    }

    scrollTarget.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    scrollTarget.addEventListener('wheel', onUserInterrupt, { passive: true })
    scrollTarget.addEventListener('touchmove', onUserInterrupt, { passive: true })

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
      }
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
        scrollTimeoutRef.current = null
      }
      scrollTarget.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      scrollTarget.removeEventListener('wheel', onUserInterrupt)
      scrollTarget.removeEventListener('touchmove', onUserInterrupt)
    }
  }, [items, updateActive])

  // 点击平滑滚动：精准定位并加上滚动期间锁
  const scrollTo = useCallback((id: string) => {
    const el = document.getElementById(id)
    if (!el) return

    // 锁定并即时高亮
    isProgrammaticScrollRef.current = true
    setActiveSafe(id)

    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current)
    }
    scrollTimeoutRef.current = setTimeout(() => {
      isProgrammaticScrollRef.current = false
    }, 750)

    const main = document.querySelector('main')
    if (main) {
      const mainRect = main.getBoundingClientRect()
      const elRect = el.getBoundingClientRect()
      const targetScrollTop = main.scrollTop + (elRect.top - mainRect.top) - 20
      main.scrollTo({
        top: Math.max(0, targetScrollTop),
        behavior: 'smooth',
      })
    } else {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [setActiveSafe])

  if (items.length === 0) return null

  return (
    <nav
      aria-label="模块目录导航"
      className={cn(
        'fixed right-3.5 lg:right-6 top-1/2 -translate-y-1/2 z-40',
        'hidden md:flex flex-col items-end gap-1.5 py-2.5 px-1.5',
        'rounded-2xl bg-card/90 dark:bg-card/80 border border-border/60 shadow-xs hover:shadow-md',
        'select-none transition-shadow duration-200 [transform:translateZ(0)] will-change-transform',
        className
      )}
    >
      {items.map((item, index) => {
        const isActive = activeId === item.id
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => scrollTo(item.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                scrollTo(item.id)
              }
            }}
            className="group relative flex items-center justify-end h-7 px-1.5 cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded-md"
            title={item.title}
            aria-label={`跳转至 ${item.title}`}
          >
            {/* 鼠标悬浮显示的模块名字气泡 */}
            <div
              className={cn(
                'pointer-events-none absolute right-full mr-2.5 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium',
                'bg-popover text-popover-foreground shadow-md border border-border/90',
                'transition-[opacity,transform] duration-150 ease-out select-none',
                'opacity-0 translate-x-1 group-hover:opacity-100 group-hover:translate-x-0',
                isActive && 'border-primary/50 text-primary font-semibold'
              )}
            >
              <span className="mr-1.5 opacity-50 font-mono text-[10px]">0{index + 1}</span>
              {item.title}
            </div>

            {/* 横线指示器：未激活 14px，悬停 20px，激活 24px */}
            <div
              className={cn(
                'h-[3px] rounded-full transition-[width,background-color] duration-200 ease-out',
                isActive
                  ? 'w-6 bg-primary shadow-xs shadow-primary/40'
                  : 'w-3.5 bg-muted-foreground/30 group-hover:w-5 group-hover:bg-foreground/80'
              )}
            />
          </button>
        )
      })}
    </nav>
  )
}

