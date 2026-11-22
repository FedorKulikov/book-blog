// One source of truth for the wording shown on the consent page and the audit row.
export const DISTRIBUTION_CONSENT_VERSION = '1.0' as const

// Categories recorded for a public post. Keep in sync with /consent-distribution.
export const DISTRIBUTION_CONSENT_CATEGORIES = [
  'author_username',
  'author_avatar',
  'publication_title',
  'publication_text',
  'publication_images',
  'publication_tags',
  'linked_book',
  'news_metadata',
] as const
