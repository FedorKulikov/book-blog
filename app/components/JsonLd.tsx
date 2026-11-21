type JsonLdProps = {
  data: Record<string, unknown>
}

/**
 * Emits safely escaped JSON-LD for search engines.
 * User-generated post content must be reduced to plain text before reaching this component.
 */
export default function JsonLd({ data }: JsonLdProps) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c')

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  )
}
