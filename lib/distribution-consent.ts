// One source of truth for the wording shown on the consent page and the audit row.
export const DISTRIBUTION_CONSENT_VERSION = '1.1' as const

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

/**
 * Fields returned and rendered by the guest-facing /profile/[username] page:
 * username, avatar_url, bio and created_at (displayed as "С нами с ...").
 * City is not a profiles column. Role badges are only shown on the owner's
 * /profile page, not the public profile route. notifications_muted is a
 * private preference and is intentionally excluded.
 */
export const PROFILE_PUBLIC_CONSENT_CATEGORIES = [
  'profile_username',
  'profile_avatar',
  'profile_bio',
  'profile_joined_at',
] as const
