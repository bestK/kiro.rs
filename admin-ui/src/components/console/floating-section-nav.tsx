import { useEffect, useState } from 'react'
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
 * - 鼠标悬浮时向左弹出模块名字
 * - 点击平滑滚动至对应模块
 * - 跟随页面滚动自动高亮当前模块
 */
export function FloatingSectionNav({ items, className }: FloatingSectionNavProps) {
  const [activeId, setActiveId] = useState<string>(items[0]?.id || '')

  useEffect(() => {
    if (items.length === 0) return

    const main = document.querySelector('main')

    const updateActive = () => {
      // 1. 如果已滚动到底部，高亮最后一个模块
      if (main) {
        const isAtBottom = main.scrollHeight - main.scrollTop - main.clientHeight < 60
        if (isAtBottom) {
          setActiveId(items[items.length - 1].id)
          return
        }
      }

      // 2. 从下往上查找当前可见的模块 (顶部距离阈值 240px)
      const threshold = 240
      for (let i = items.length - 1; i >= 0; i--) {
        const el = document.getElementById(items[i].id)
        if (el) {
          const rect = el.getBoundingClientRect()
          if (rect.top <= threshold) {
            setActiveId(items[i].id)
            return
          }
        }
      }

      // 3. 兜底高亮首个
      if (items.length > 0) {
        setActiveId(items[0].id)
      }
    }

    updateActive()

    const scrollTarget = main || window
    scrollTarget.addEventListener('scroll', updateActive, { passive: true })
    window.addEventListener('resize', updateActive, { passive: true })

    return () => {
      scrollTarget.removeEventListener('scroll', updateActive)
      window.removeEventListener('resize', updateActive)
    }
  }, [items])

  const scrollTo = (id: string) => {
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setActiveId(id)
    }
  }

  if (items.length === 0) return null

  return (
    <nav
      aria-label="模块目录导航"
      className={cn(
        'fixed right-3.5 lg:right-6 top-1/2 -translate-y-1/2 z-40',
        'hidden md:flex flex-col items-end gap-2.5 py-3 px-2',
        'rounded-2xl bg-card/75 dark:bg-card/60 backdrop-blur-md',
        'border border-border/50 shadow-xs hover:shadow-md transition-all duration-300',
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
            className="group relative flex items-center justify-end py-1.5 px-1 cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
            title={item.title}
            aria-label={`跳转至 ${item.title}`}
          >
            {/* 鼠标悬浮显示的模块名字气泡 */}
            <div
              className={cn(
                'pointer-events-none absolute right-full mr-3 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-medium',
                'bg-popover/95 text-popover-foreground shadow-md border border-border/80 backdrop-blur-md',
                'transition-all duration-200 ease-out select-none',
                'opacity-0 translate-x-2 group-hover:opacity-100 group-hover:translate-x-0',
                isActive && 'border-primary/40 text-primary font-semibold'
              )}
            >
              <span className="mr-1.5 opacity-60 font-mono text-[10px]">0{index + 1}</span>
              {item.title}
            </div>

            {/* 默认为横线 (固定长度，不发生长度伸缩变化) */}
            <div
              className={cn(
                'w-5 h-[2.5px] rounded-full transition-colors duration-200 ease-out',
                isActive
                  ? 'bg-primary shadow-xs shadow-primary/40'
                  : 'bg-muted-foreground/35 group-hover:bg-foreground/85'
              )}
            />
          </button>
        )
      })}
    </nav>
  )
}
