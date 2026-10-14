import { useMemo, useState } from "react";
import {
  articlePassages,
  type PassageComment,
} from "@/types/schemas/articlePassages";
export function ArticlePassageReview({
  html,
  comments,
  onChange,
  disabled = false,
  saveHint = "Comments are saved when you request a revision below.",
}: {
  html: string;
  comments: PassageComment[];
  onChange?: (comments: PassageComment[]) => void;
  disabled?: boolean;
  saveHint?: string;
}) {
  const blocks = useMemo(() => articlePassages(html), [html]);
  const [open, setOpen] = useState<number | null>(null);
  if (!onChange)
    return (
      <div
        className="article-content"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  return (
    <section aria-label="Article and passage comments" className="space-y-2">
      <p className="text-sm text-base-content/70">
        Use + beside a passage to request a specific change. {saveHint}
      </p>
      {blocks.map((block) => {
        const comment = comments.find((c) => c.blockIndex === block.index);
        return (
          <div
            key={block.index}
            className="rounded border border-transparent focus-within:border-primary/50"
          >
            <div className="flex items-start gap-3">
              <div
                className="article-content min-w-0 flex-1"
                dangerouslySetInnerHTML={{ __html: block.html }}
              />
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-square mt-2 shrink-0 text-xl"
                title="Add comment"
                disabled={disabled}
                aria-label={"Add comment to passage " + (block.index + 1)}
                aria-expanded={open === block.index}
                onClick={() =>
                  setOpen(open === block.index ? null : block.index)
                }
              >
                <span aria-hidden="true">+</span>
              </button>
            </div>
            {(open === block.index || comment) && (
              <div className="mb-3 rounded border border-base-300 bg-base-200 p-3">
                <label className="block text-sm font-medium">
                  Feedback on passage {block.index + 1}
                  <textarea
                    className="textarea textarea-bordered mt-2 w-full bg-base-100"
                    rows={2}
                    maxLength={1500}
                    disabled={disabled}
                    value={comment?.message ?? ""}
                    placeholder="What should change in this passage, and why?"
                    onChange={(e) =>
                      onChange([
                        ...comments.filter((c) => c.blockIndex !== block.index),
                        ...(e.target.value
                          ? [
                              {
                                blockIndex: block.index,
                                quote: block.quote,
                                message: e.target.value,
                              },
                            ]
                          : []),
                      ])
                    }
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs mt-1"
                  disabled={disabled}
                  onClick={() => {
                    onChange(
                      comments.filter((c) => c.blockIndex !== block.index),
                    );
                    setOpen(null);
                  }}
                >
                  Remove comment
                </button>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
