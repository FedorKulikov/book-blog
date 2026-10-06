import Link from 'next/link'
import { ReactNode } from 'react'

type Props = {
  icon?: ReactNode
  title: string
  description?: string
  action?: {
    label: string
    href: string
  }
}

export default function EmptyState({
  icon,
  title,
  description,
  action,
}: Props) {
  return (
    <div className="bg-cream-warm/15 border border-dashed border-emerald-dark/15 rounded-2xl p-10 md:p-14 text-center">
      {icon && (
        <div className="flex justify-center mb-5 text-emerald-mid/35">
          {icon}
        </div>
      )}
      <h3 className="font-playfair text-xl font-bold text-emerald-dark mb-2">
        {title}
      </h3>
      {description && (
        <p className="text-sm text-brown/65 max-w-md mx-auto leading-relaxed">
          {description}
        </p>
      )}
      {action && (
        <Link
          href={action.href}
          className="inline-block mt-6 bg-wine hover:bg-wine-dark text-white px-5 py-2.5 rounded-full text-sm transition-colors"
        >
          {action.label}
        </Link>
      )}
    </div>
  )
}
