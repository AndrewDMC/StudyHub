ALTER TABLE "reviews" ADD COLUMN "confidence" integer;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_confidence_range" CHECK ("confidence" IS NULL OR "confidence" BETWEEN 1 AND 3);
