CREATE TABLE `usage_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`symbol` text NOT NULL,
	`model` text NOT NULL,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`total_tokens` integer,
	`provider_cost_usd` real,
	`cost_cents` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_usage_log_user` ON `usage_log` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_usage_log_symbol` ON `usage_log` (`symbol`);--> statement-breakpoint
ALTER TABLE `stock_analysis` ADD `thesis_json` text;--> statement-breakpoint
ALTER TABLE `stock_analysis` ADD `thesis_version` text;--> statement-breakpoint
ALTER TABLE `stock_analysis` ADD `macro_thesis_json` text;--> statement-breakpoint
ALTER TABLE `stock_metrics` ADD `perf_day` real;--> statement-breakpoint
ALTER TABLE `user` ADD `wallet_balance` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `watchlist` ADD `is_saved` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `watchlist` ADD `is_watching` integer DEFAULT false NOT NULL;