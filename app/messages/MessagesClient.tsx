'use client'

import ConversationList from '../components/ConversationList'

export default function MessagesPage() {
  return (
    <main className="p-4 md:p-8 max-w-3xl mx-auto">
      <ConversationList />
    </main>
  )
}
