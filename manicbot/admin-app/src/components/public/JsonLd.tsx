import { jsonLdScript } from "~/lib/seo";

/**
 * Server component that emits a <script type="application/ld+json"> tag.
 * Pass a single schema object or an array.
 */
export function JsonLd({ data }: { data: unknown | unknown[] }) {
  const items = Array.isArray(data) ? data : [data];
  return (
    <>
      {items.map((item, idx) => (
        <script
          key={idx}
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger -- safe: jsonLdScript escapes </
          dangerouslySetInnerHTML={{ __html: jsonLdScript(item) }}
        />
      ))}
    </>
  );
}
