import { Parser } from "htmlparser2";
import { AppError } from "@/server/lib/errors";

const allowed = new Set([
  "h2",
  "h3",
  "p",
  "ul",
  "ol",
  "li",
  "strong",
  "em",
  "a",
]);
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );

export function sanitizeManualArticleHtml(input: string) {
  if (input.length > 50000) throw new AppError("VALIDATION_ERROR");
  let output = "";
  let topLevelBlocks = 0;
  let headings = 0;
  const stack: string[] = [];
  const parser = new Parser(
    {
      onopentag(tag, attributes) {
        if (!allowed.has(tag)) throw new AppError("VALIDATION_ERROR");
        if (!stack.length) {
          if (!["h2", "h3", "p", "ul", "ol"].includes(tag))
            throw new AppError("VALIDATION_ERROR");
          topLevelBlocks++;
        }
        if (tag === "h2") headings++;
        if (tag === "a") {
          if (!attributes.href?.startsWith("https://"))
            throw new AppError("VALIDATION_ERROR");
          const url = new URL(attributes.href);
          if (url.protocol !== "https:" || url.username || url.password)
            throw new AppError("VALIDATION_ERROR");
          output += `<a href="${escape(url.href)}">`;
        } else output += `<${tag}>`;
        stack.push(tag);
      },
      ontext(value) {
        if (!stack.length && value.trim())
          throw new AppError("VALIDATION_ERROR");
        if (stack.length) output += escape(value);
      },
      onclosetag(tag) {
        if (stack.pop() !== tag) throw new AppError("VALIDATION_ERROR");
        output += `</${tag}>`;
        if (!stack.length) output += "\n";
      },
      oncomment() {
        throw new AppError("VALIDATION_ERROR");
      },
      onprocessinginstruction() {
        throw new AppError("VALIDATION_ERROR");
      },
    },
    { decodeEntities: true },
  );
  parser.end(input);
  if (stack.length || topLevelBlocks < 3 || !headings || output.length < 400)
    throw new AppError("VALIDATION_ERROR");
  return output.trim();
}
