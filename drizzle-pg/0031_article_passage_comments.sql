CREATE TABLE "article_passage_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"feedback_id" text NOT NULL,
	"block_index" integer NOT NULL,
	"quote" text NOT NULL,
	"message" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "article_passage_comments" ADD CONSTRAINT "article_passage_comments_feedback_id_article_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."article_feedback"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "article_passage_feedback_block_idx" ON "article_passage_comments" USING btree ("feedback_id","block_index");