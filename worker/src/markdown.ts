import { escapeHtml } from "./util";

/**
 * A deliberately small Markdown renderer.
 *
 * Security model: the whole source is HTML-escaped *before* any parsing, so a
 * recipe can never inject HTML. The parser only ever emits tags from this file.
 * Supported: headings, paragraphs, ordered/unordered lists, task lists,
 * blockquotes, fenced code, horizontal rules, bold, italic, strikethrough,
 * inline code, and safe http(s) links.
 */

function renderInline(raw: string): string {
  const tokens: string[] = [];
  const stash = (html: string): string => `\u0000${tokens.push(html) - 1}\u0000`;

  let text = raw;

  // Inline code first, so its contents are never treated as emphasis.
  text = text.replace(/`([^`\n]+)`/g, (_match, code: string) =>
    stash(`<code>${code}</code>`),
  );

  // Links: only absolute http(s) URLs. Quotes are already escaped in `url`.
  text = text.replace(
    /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_match, label: string, url: string) =>
      stash(
        `<a href="${url}" rel="noopener noreferrer nofollow">${label}</a>`,
      ),
  );

  text = text.replace(/\*\*([^\n]+?)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/__([^\n]+?)__/g, "<strong>$1</strong>");
  text = text.replace(/~~([^\n]+?)~~/g, "<del>$1</del>");
  text = text.replace(/\*([^*\n]+?)\*/g, "<em>$1</em>");
  text = text.replace(
    /(^|[\s([{])_([^_\n]+?)_(?=$|[\s)\]}.,;:!?])/g,
    (_match, prefix: string, inner: string) =>
      `${prefix}<em>${inner}</em>`,
  );

  return text.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => {
    return tokens[Number(index)] ?? "";
  });
}

export function renderMarkdown(source: string): string {
  // Pre-escape the source: raw HTML in a recipe is text, never markup.
  const escaped = escapeHtml(source.replace(/\r\n?/g, "\n"));
  const lines = escaped.split("\n");

  const output: string[] = [];
  let paragraph: string[] = [];
  let quote: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let listStart = 1;
  let listItems: string[] = [];
  let inCode = false;
  let codeLines: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    output.push(`<p>${paragraph.map(renderInline).join("<br>")}</p>`);
    paragraph = [];
  };

  const flushQuote = (): void => {
    if (quote.length === 0) return;
    output.push(
      `<blockquote><p>${quote.map(renderInline).join("<br>")}</p></blockquote>`,
    );
    quote = [];
  };

  const flushList = (): void => {
    if (!listType) return;
    const tag = listType;
    const startAttr =
      tag === "ol" && listStart !== 1 ? ` start="${listStart}"` : "";
    const items = listItems.map((item) => `<li>${item}</li>`).join("");
    output.push(`<${tag}${startAttr}>${items}</${tag}>`);
    listType = null;
    listStart = 1;
    listItems = [];
  };

  const flushAll = (): void => {
    flushParagraph();
    flushQuote();
    flushList();
  };

  for (const line of lines) {
    if (inCode) {
      if (/^\s*```/.test(line)) {
        output.push(`<pre><code>${codeLines.join("\n")}</code></pre>`);
        inCode = false;
        codeLines = [];
      } else {
        codeLines.push(line);
      }
      continue;
    }

    if (/^\s*```/.test(line)) {
      flushAll();
      inCode = true;
      codeLines = [];
      continue;
    }

    if (/^\s*$/.test(line)) {
      flushAll();
      continue;
    }

    const heading = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/.exec(line);
    if (heading) {
      flushAll();
      // The page already owns <h1>; shift recipe headings down one level.
      const sourceLevel = heading[1]?.length ?? 1;
      const level = Math.min(sourceLevel + 1, 6);
      output.push(`<h${level}>${renderInline(heading[2] ?? "")}</h${level}>`);
      continue;
    }

    if (/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      flushAll();
      output.push("<hr>");
      continue;
    }

    const quoted = /^ {0,3}>[ \t]?(.*)$/.exec(line);
    if (quoted) {
      flushParagraph();
      flushList();
      quote.push(quoted[1] ?? "");
      continue;
    }

    const ordered = /^\s*(\d{1,9})[.)]\s+(.*)$/.exec(line);
    if (ordered) {
      flushParagraph();
      flushQuote();
      if (listType !== "ol") {
        flushList();
        listType = "ol";
        listStart = Number(ordered[1] ?? 1);
      }
      listItems.push(renderInline(ordered[2] ?? ""));
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph();
      flushQuote();
      if (listType !== "ul") {
        flushList();
        listType = "ul";
        listStart = 1;
      }
      const content = bullet[1] ?? "";
      const task = /^\[([ xX])\]\s+(.*)$/.exec(content);
      if (task) {
        const checked = (task[1] ?? " ").toLowerCase() === "x";
        const label = checked ? "Feito" : "A fazer";
        listItems.push(
          `<span class="task-box" role="img" aria-label="${label}">${
            checked ? "☑" : "☐"
          }</span> ${renderInline(task[2] ?? "")}`,
        );
      } else {
        listItems.push(renderInline(content));
      }
      continue;
    }

    // Indented continuation of the previous list item (common in recipes).
    if (listType && /^\s+\S/.test(line)) {
      const previous = listItems.pop() ?? "";
      listItems.push(`${previous}<br>${renderInline(line.trim())}`);
      continue;
    }

    flushQuote();
    flushList();
    paragraph.push(line);
  }

  if (inCode) {
    output.push(`<pre><code>${codeLines.join("\n")}</code></pre>`);
  }
  flushAll();

  return output.join("\n");
}

function toWhatsAppInline(text: string): string {
  return text
    .replace(/~~([^~\n]+?)~~/g, "~$1~")
    .replace(/\*\*([^*\n]+?)\*\*/g, "*$1*")
    .replace(/__([^_\n]+?)__/g, "*$1*");
}

/**
 * WhatsApp-flavored copy text: `**bold**` → `*bold*`, `~~x~~` → `~x~`,
 * `## heading` → `*HEADING*`. Pure string transformation; no HTML here.
 */
export function toWhatsAppText(title: string, body: string): string {
  const convertedBody = body
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => {
      const heading = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
      if (heading) {
        return `*${toWhatsAppInline(heading[1] ?? "").toUpperCase()}*`;
      }
      return toWhatsAppInline(line);
    })
    .join("\n");

  return `${toWhatsAppInline(title)}\n\n${convertedBody}`.trimEnd();
}
