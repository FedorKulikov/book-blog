'use client'

import ReportButton from '../ReportButton'
import { Send, Trash2 } from '../icons'

export type CommentRow = {
  id: string
  post_id: string
  user_id: string
  parent_id: string | null
  text: string
  created_at: string
  profiles?: { username: string | null; avatar_url?: string | null } | null
}

/** Всё, что нужно узлу дерева: состояние живёт в родителе (Comments). */
export type CommentNodeContext = {
  user: { id: string } | null
  isStaff: boolean
  replyTo: string | null
  replyText: string
  submitting: boolean
  /** Ветки, раскрытые кнопкой «Показать ещё ответы» */
  expanded: Set<string>
  onToggleExpanded: (id: string) => void
  onReplyToggle: (id: string | null) => void
  onReplyTextChange: (text: string) => void
  onSubmitReply: (text: string, parentId: string) => void
  onDelete: (id: string) => void
  /** parent_id -> дети (один проход, без filter в рендере) */
  childrenByParent: Map<string, CommentRow[]>
}

/** Сколько ответов показываем до кнопки «Показать ещё» */
const VISIBLE_REPLIES = 5

function Avatar({
  name,
  url,
  size = 32,
}: {
  name: string
  url?: string | null
  size?: number
}) {
  if (url) {
    return (
      <img
        src={url}
        alt=""
        style={{ width: size, height: size }}
        className="rounded-full object-cover flex-shrink-0"
      />
    )
  }
  return (
    <div
      style={{ width: size, height: size }}
      className="rounded-full bg-emerald-mid text-cream flex items-center justify-center text-xs font-bold flex-shrink-0"
    >
      {(name[0] || '?').toUpperCase()}
    </div>
  )
}

export default function CommentNode({
  comment,
  depth,
  ctx,
}: {
  comment: CommentRow
  depth: number
  ctx: CommentNodeContext
}) {
  const name = comment.profiles?.username || 'Аноним'
  const children = ctx.childrenByParent.get(comment.id) ?? []
  const isExpanded = ctx.expanded.has(comment.id)
  const visible = isExpanded ? children : children.slice(0, VISIBLE_REPLIES)
  const hiddenCount = children.length - visible.length

  return (
    <div
      className={
        depth > 0 ? 'ml-6 mt-3 border-l-2 border-emerald-dark/8 pl-4' : 'mt-4'
      }
    >
      <div className="flex gap-3">
        <Avatar name={name} url={comment.profiles?.avatar_url} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium text-emerald-dark">{name}</span>
            <span className="text-brown/45 text-xs">
              {new Date(comment.created_at).toLocaleString('ru-RU', {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
          <p className="text-brown-dark mt-1 whitespace-pre-wrap text-sm leading-relaxed">
            {comment.text}
          </p>

          <div className="flex items-center gap-3 mt-1">
            {ctx.user && (
              <button
                type="button"
                onClick={() =>
                  ctx.onReplyToggle(ctx.replyTo === comment.id ? null : comment.id)
                }
                className="text-xs text-brown/60 hover:text-wine transition-colors"
              >
                {ctx.replyTo === comment.id ? 'Отмена' : 'Ответить'}
              </button>
            )}
            {(ctx.user?.id === comment.user_id || ctx.isStaff) && (
              <button
                type="button"
                onClick={() => ctx.onDelete(comment.id)}
                className="flex items-center gap-1 text-xs text-brown/40 hover:text-wine transition-colors"
                title="Удалить комментарий"
              >
                <Trash2 size={11} strokeWidth={1.8} />
              </button>
            )}
            {ctx.user && ctx.user.id !== comment.user_id && (
              <ReportButton commentId={comment.id} />
            )}
          </div>

          {ctx.replyTo === comment.id && (
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                value={ctx.replyText}
                onChange={(e) => ctx.onReplyTextChange(e.target.value)}
                placeholder="Ваш ответ…"
                className="flex-1 border border-emerald-dark/15 rounded-full px-4 py-1.5 text-sm bg-cream-warm/40 focus:outline-none focus:border-emerald-mid"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !ctx.submitting) {
                    ctx.onSubmitReply(ctx.replyText, comment.id)
                  }
                }}
              />
              <button
                type="button"
                onClick={() => ctx.onSubmitReply(ctx.replyText, comment.id)}
                disabled={ctx.submitting || !ctx.replyText.trim()}
                className="bg-wine text-white px-3 py-1.5 rounded-full text-sm hover:bg-wine-dark transition-colors flex items-center disabled:opacity-50"
              >
                {ctx.submitting ? '…' : <Send size={14} strokeWidth={1.8} />}
              </button>
            </div>
          )}

          {visible.map(child => (
            <CommentNode
              key={child.id}
              comment={child}
              depth={depth + 1}
              ctx={ctx}
            />
          ))}

          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => ctx.onToggleExpanded(comment.id)}
              className="mt-2 text-xs text-emerald-mid hover:text-wine transition-colors"
            >
              Показать ещё ответы ({hiddenCount})
            </button>
          )}

          {isExpanded && children.length > VISIBLE_REPLIES && (
            <button
              type="button"
              onClick={() => ctx.onToggleExpanded(comment.id)}
              className="mt-2 text-xs text-brown/45 hover:text-wine transition-colors"
            >
              Свернуть ответы
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
