import type { Metadata } from 'next'
import EmailRecoveryConfirmClient from './EmailRecoveryConfirmClient'

export const metadata: Metadata = {
  title: 'Подтверждение email',
  robots: { index: false, follow: false },
}

export default function EmailRecoveryConfirmPage() {
  return <EmailRecoveryConfirmClient />
}
