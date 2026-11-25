import React from 'react';

// Extracted from ProjectStrategyStep.tsx so StrategyRunReport.tsx (and any
// other consumer of strategy/plan text) renders the exact same way instead
// of duplicating this logic.

// Splits a single line into text/**bold**/*italic*/[link](url) segments in
// one pass — one regex rather than several separate .split() passes, so a
// lone italic marker next to a bold span doesn't get mis-parsed as half of
// a bold pair.
export const renderInlineMarkdown = (text: string): React.ReactNode => {
  const parts = text.split(/(\*\*[^*]+?\*\*|\*[^*]+?\*|\[[^\]]+?\]\([^)]+?\))/g);
  return parts.map((part, j) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={j} className="font-bold text-[#1A1416] dark:text-[#F2ECEC]">{part.slice(2, -2)}</strong>;
    }
    const linkMatch = part.match(/^\[([^\]]+?)\]\(([^)]+?)\)$/);
    if (linkMatch) {
      return (
        <a key={j} href={linkMatch[2]} className="text-[#9C3752] dark:text-[#F0879C] underline underline-offset-2 font-medium">
          {linkMatch[1]}
        </a>
      );
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 1) {
      return <em key={j}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
};

const TABLE_SEPARATOR = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/;

const isTableRow = (line: string) => {
  const t = line.trim();
  return t.startsWith('|') && t.endsWith('|') && t.length > 1;
};

const tableCells = (line: string) =>
  line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

// A GitHub-style pipe table (header row, "|---|" separator, body rows), the
// shape the strategy pipeline uses for gate tables, KPIs and summaries.
export function MarkdownTable({ header, rows }: { header: string[]; rows: string[][] }) {
  return (
    <div className="my-3 overflow-x-auto rounded-lg border border-[#E9E0DF] dark:border-[#2E2729]">
      <table className="w-full border-collapse text-left text-[0.92em] leading-snug">
        <thead className="bg-[#F7F1F0] dark:bg-[#1F1A1B]">
          <tr>
            {header.map((cell, j) => (
              <th key={j} className="px-3 py-2 font-semibold text-[#1A1416] dark:text-[#F2ECEC] border-b border-[#E9E0DF] dark:border-[#2E2729] align-bottom">
                {renderInlineMarkdown(cell)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="even:bg-[#FBF8F7] dark:even:bg-[#181415]">
              {header.map((_, j) => (
                <td key={j} className="px-3 py-1.5 align-top border-t border-[#F0E8E7] dark:border-[#262021]">
                  {renderInlineMarkdown(row[j] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Renders `text` line by line with `renderLine`, except that pipe tables and
// "> " quote blocks are gathered and rendered as a table and a callout, so
// neither shows up as raw "|" or ">" characters. Shared by both markdown
// renderers so every view handles them the same way.
export function renderMarkdownBlocks(
  text: string,
  renderLine: (line: string, key: number) => React.ReactNode,
): React.ReactNode[] {
  const lines = text.split('\n');
  const out: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isTableRow(line) && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1].trim())) {
      const header = tableCells(line);
      const rows: string[][] = [];
      let k = i + 2;
      while (k < lines.length && isTableRow(lines[k])) rows.push(tableCells(lines[k++]));
      out.push(<MarkdownTable key={i} header={header} rows={rows} />);
      i = k;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quoted: string[] = [];
      let k = i;
      while (k < lines.length && /^\s*>/.test(lines[k])) quoted.push(lines[k++].replace(/^\s*>\s?/, ''));
      out.push(
        <blockquote key={i} className="my-2 rounded-r-md border-l-4 border-[#D9A441] bg-[#FBF5E8] px-3 py-2 text-[0.95em] dark:border-[#C9973A] dark:bg-[#231D12]">
          {quoted.map((q, n) => (q.trim() ? <p key={n} className="my-0.5">{renderInlineMarkdown(q)}</p> : null))}
        </blockquote>,
      );
      i = k;
      continue;
    }
    out.push(renderLine(line, i));
    i++;
  }
  return out;
}

// Basic markdown rendering for chat bubbles: headers (any # depth, not just
// up to ###), **bold**, *italic*, "- " lists (actually stripped of their
// marker, not just prefixed with a bullet glyph), "---" rules, pipe tables and
// "> " callouts — good enough for the strategy/plan text the pipeline
// generates, without pulling in a full markdown library.
export const renderMarkdown = (text: string) => {
  if (!text) return null;
  return renderMarkdownBlocks(text, (line, i) => {
    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const Tag = (level <= 1 ? 'h1' : level === 2 ? 'h2' : level === 3 ? 'h3' : 'h4') as 'h1' | 'h2' | 'h3' | 'h4';
      const sizeClass =
        level <= 1 ? 'text-xl mt-5 mb-2' : level === 2 ? 'text-lg mt-4 mb-1.5' : level === 3 ? 'text-base mt-3 mb-1.5' : 'text-sm mt-2.5 mb-1';
      return (
        <Tag key={i} className={`font-bold text-[#9C3752] dark:text-[#F0879C] ${sizeClass}`}>
          {renderInlineMarkdown(headerMatch[2])}
        </Tag>
      );
    }

    const trimmed = line.trim();
    if (trimmed === '---' || trimmed === '***') {
      return <hr key={i} className="my-3 border-[#E9E0DF] dark:border-[#241F20]" />;
    }
    // A lone bullet glyph with no text of its own (an artifact of some
    // pipeline output pairing a "•" line with its own separate "- item"
    // line right after) — drop it rather than rendering an empty bullet.
    if (trimmed === '•') return null;

    if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
      return (
        <div key={i} className="flex gap-2 my-0.5 pl-2">
          <span className="text-[#9C3752] dark:text-[#F0879C] mt-1">•</span>
          <span>{renderInlineMarkdown(trimmed.slice(2))}</span>
        </div>
      );
    }

    if (!trimmed) return <div key={i} className="h-2" />;

    return <p key={i} className="my-1">{renderInlineMarkdown(line)}</p>;
  });
};
