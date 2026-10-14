import { Parser } from "htmlparser2";
export function articlePassages(html: string) {
  const blocks: { html: string; quote: string; index: number }[] = [];
  let depth = 0,
    start = 0,
    text = "";
  const parser = new Parser(
    {
      onopentag() {
        if (depth++ === 0) {
          start = parser.startIndex;
          text = "";
        }
      },
      ontext(value) {
        text += value;
      },
      onclosetag() {
        if (--depth === 0) {
          blocks.push({
            html: html.slice(start, parser.endIndex + 1),
            quote: text.replace(/\s+/g, " ").trim().slice(0, 1200),
            index: blocks.length,
          });
        }
      },
    },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();
  return blocks;
}
export type PassageComment = {
  blockIndex: number;
  quote: string;
  message: string;
};
export function revisionMessage(
  message: string,
  passages: PassageComment[] = [],
) {
  return [
    message.trim(),
    ...passages.map(
      (p) =>
        "Passage " +
        (p.blockIndex + 1) +
        ": “" +
        p.quote +
        "”\nRequested change: " +
        p.message.trim(),
    ),
  ]
    .filter(Boolean)
    .join("\n\n");
}
