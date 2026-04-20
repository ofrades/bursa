CREATE TABLE `daily_signal` (
	`id` text PRIMARY KEY NOT NULL,
	`stock_analysis_id` text NOT NULL,
	`symbol` text NOT NULL,
	`date` text NOT NULL,
	`signal` text NOT NULL,
	`cycle` text,
	`note` text,
	`price_at_update` real,
	`signal_changed` integer DEFAULT false,
	`trigger` text DEFAULT 'manual' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`stock_analysis_id`) REFERENCES `stock_analysis`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_daily_signal_analysis` ON `daily_signal` (`stock_analysis_id`);--> statement-breakpoint
CREATE TABLE `oauth_state` (
	`state` text PRIMARY KEY NOT NULL,
	`code_verifier` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_oauth_state_created` ON `oauth_state` (`created_at`);--> statement-breakpoint
CREATE TABLE `stock` (
	`symbol` text PRIMARY KEY NOT NULL,
	`name` text,
	`exchange` text,
	`sector` text,
	`industry` text,
	`next_check_at` integer,
	`last_analyzed_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `stock_analysis` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`week_start` text NOT NULL,
	`week_end` text NOT NULL,
	`signal` text NOT NULL,
	`cycle` text,
	`cycle_timeframe` text,
	`cycle_strength` real,
	`confidence` real,
	`reasoning` text,
	`price_at_analysis` real,
	`last_triggered_by_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`symbol`) REFERENCES `stock`(`symbol`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`last_triggered_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_analysis_symbol` ON `stock_analysis` (`symbol`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_analysis_symbol_week` ON `stock_analysis` (`symbol`,`week_start`);--> statement-breakpoint
CREATE TABLE `stock_memory` (
	`symbol` text PRIMARY KEY NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`symbol`) REFERENCES `stock`(`symbol`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `stock_metrics` (
	`symbol` text PRIMARY KEY NOT NULL,
	`perf_wtd` real,
	`perf_last_week` real,
	`perf_mtd` real,
	`perf_last_month` real,
	`perf_ytd` real,
	`perf_last_year` real,
	`momentum_signal` text,
	`current_price` real,
	`sma20` real,
	`sma50` real,
	`sma200` real,
	`rsi14` real,
	`macd_line` real,
	`macd_signal` real,
	`macd_histogram` real,
	`atr14` real,
	`relative_volume` real,
	`pct_52w_high` real,
	`pct_52w_low` real,
	`pe_ratio` real,
	`forward_pe` real,
	`debt_to_equity` real,
	`profit_margin` real,
	`return_on_equity` real,
	`revenue_growth_yoy` real,
	`free_cashflow_yield` real,
	`market_cap` real,
	`next_earnings_date` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`symbol`) REFERENCES `stock`(`symbol`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `supervisor_alert` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`stock_analysis_id` text NOT NULL,
	`supervisor` text NOT NULL,
	`alert_type` text NOT NULL,
	`severity` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`symbol`) REFERENCES `stock`(`symbol`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`stock_analysis_id`) REFERENCES `stock_analysis`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_supervisor_alert_symbol` ON `supervisor_alert` (`symbol`);--> statement-breakpoint
CREATE INDEX `idx_supervisor_alert_analysis` ON `supervisor_alert` (`stock_analysis_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`image` text,
	`analysis_credits` integer DEFAULT 0 NOT NULL,
	`stripe_customer_id` text,
	`stripe_subscription_id` text,
	`stripe_price_id` text,
	`subscription_status` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `watchlist` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`symbol` text NOT NULL,
	`added_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`symbol`) REFERENCES `stock`(`symbol`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_watchlist_user_symbol` ON `watchlist` (`user_id`,`symbol`);