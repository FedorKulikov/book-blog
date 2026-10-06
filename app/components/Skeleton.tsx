export function PostCardSkeleton() {
  return (
    <div className="bg-cream-warm/25 border border-emerald-dark/8 rounded-2xl overflow-hidden animate-pulse">
      <div className="aspect-[16/10] bg-emerald-mid/10" />
      <div className="p-5 space-y-3">
        <div className="h-3 w-16 bg-emerald-mid/15 rounded" />
        <div className="h-5 w-3/4 bg-emerald-mid/15 rounded" />
        <div className="h-3 w-full bg-emerald-mid/15 rounded" />
        <div className="h-3 w-5/6 bg-emerald-mid/15 rounded" />
        <div className="flex items-center gap-2 pt-3 border-t border-emerald-dark/5">
          <div className="w-5 h-5 bg-emerald-mid/15 rounded-full" />
          <div className="h-3 w-24 bg-emerald-mid/15 rounded" />
        </div>
      </div>
    </div>
  )
}

export function PostGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      {Array.from({ length: count }).map((_, i) => (
        <PostCardSkeleton key={i} />
      ))}
    </div>
  )
}

export function SidebarSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {[1, 2, 3].map(i => (
        <div key={i} className="space-y-3">
          <div className="h-4 w-32 bg-emerald-mid/15 rounded" />
          <div className="h-3 w-full bg-emerald-mid/15 rounded" />
          <div className="h-3 w-5/6 bg-emerald-mid/15 rounded" />
          <div className="h-3 w-4/6 bg-emerald-mid/15 rounded" />
        </div>
      ))}
    </div>
  )
}
