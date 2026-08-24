ALTER TABLE `user` ADD `session_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `active_analysis_id` text;--> statement-breakpoint
ALTER TABLE `user` ADD `analysis_reserved_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `analysis_started_at` integer;--> statement-breakpoint
ALTER TABLE `user` ADD `last_analysis_at` integer;--> statement-breakpoint
ALTER TABLE `oauth_state` ADD `browser_binding_hash` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `usage_log` ADD `reservation_id` text;--> statement-breakpoint
ALTER TABLE `usage_log` ADD `usage_reported` integer DEFAULT true NOT NULL;--> statement-breakpoint
UPDATE `usage_log` SET `reservation_id` = `id` WHERE `reservation_id` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_usage_log_reservation` ON `usage_log` (`reservation_id`);--> statement-breakpoint
