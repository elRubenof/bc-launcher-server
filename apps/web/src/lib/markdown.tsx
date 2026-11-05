import type { ReactNode } from "react";

/**
 * A small markdown renderer for the news preview: headings, paragraphs, line breaks, lists,
 * **bold**, *italic*, `code` and [links](https://…). It builds React elements (never HTML
 * strings), so nothing in the text can inject markup. The launcher renders the same markdown with
 * its own renderer.
 */
export function renderMarkdown(text: string): ReactNode[] {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] as string;
    if (!line.trim()) {
      i++;
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      const level = (heading[1] as string).length;
      const content = inline(heading[2] as string, `h${i}`);
      const className = ["text-lg font-bold", "text-base font-bold", "font-semibold"][level - 1];
      blocks.push(
        level === 1 ? (
          <h3 key={i} className={className}>
            {content}
          </h3>
        ) : level === 2 ? (
          <h4 key={i} className={className}>
            {content}
          </h4>
        ) : (
          <h5 key={i} className={className}>
            {content}
          </h5>
        ),
      );
      i++;
      continue;
    }

    const bullet = /^\s*[-*+]\s+/;
    const numbered = /^\s*\d+[.)]\s+/;
    const listKind = bullet.test(line) ? bullet : numbered.test(line) ? numbered : null;
    if (listKind) {
      const items: ReactNode[] = [];
      while (i < lines.length && listKind.test(lines[i] as string)) {
        items.push(<li key={i}>{inline((lines[i] as string).replace(listKind, ""), `l${i}`)}</li>);
        i++;
      }
      blocks.push(
        listKind === bullet ? (
          <ul key={`u${i}`} className="list-disc pl-5">
            {items}
          </ul>
        ) : (
          <ol key={`o${i}`} className="list-decimal pl-5">
            {items}
          </ol>
        ),
      );
      continue;
    }

    // A paragraph runs until a blank line, a heading or a list.
    const start = i;
    const paragraph: ReactNode[] = [];
    while (
      i < lines.length &&
      (lines[i] as string).trim() &&
      !/^#{1,3}\s/.test(lines[i] as string) &&
      !bullet.test(lines[i] as string) &&
      !numbered.test(lines[i] as string)
    ) {
      if (i > start) paragraph.push(<br key={`br${i}`} />);
      paragraph.push(...inline(lines[i] as string, `p${i}`));
      i++;
    }
    blocks.push(<p key={`p${start}`}>{paragraph}</p>);
  }
  return blocks;
}

// Only `*` for emphasis: `_` is common in Minecraft names (`a_b_c` must stay as written).
const INLINE = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\))/;

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let n = 0;
  while (rest) {
    const match = rest.match(INLINE);
    if (!match || match.index === undefined) {
      out.push(rest);
      break;
    }
    if (match.index > 0) out.push(rest.slice(0, match.index));
    const k = `${key}-${n++}`;
    const [, , bold, italic, code, label, href] = match;
    if (bold) out.push(<strong key={k}>{inline(bold, k)}</strong>);
    else if (italic) out.push(<em key={k}>{inline(italic, k)}</em>);
    else if (code) {
      out.push(
        <code key={k} className="rounded bg-muted px-1 font-mono text-[0.9em]">
          {code}
        </code>,
      );
    } else if (label && href) {
      out.push(
        /^https?:\/\//i.test(href) ? (
          <a key={k} href={href} target="_blank" rel="noreferrer noopener">
            {label}
          </a>
        ) : (
          label
        ),
      );
    }
    rest = rest.slice(match.index + match[0].length);
  }
  return out;
}
