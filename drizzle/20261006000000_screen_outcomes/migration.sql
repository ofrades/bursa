CREATE TABLE `screen_outcome` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `symbol` text NOT NULL,
  `strict` integer DEFAULT false NOT NULL,
  `horizon_days` integer NOT NULL,
  `price_at_run` real NOT NULL,
  `price_at_end` real NOT NULL,
  `return_pct` real NOT NULL,
  `benchmark_return_pct` real NOT NULL,
  `excess_return_pct` real NOT NULL,
  `computed_at` integer NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `screen_run`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_screen_outcome` ON `screen_outcome` (`run_id`,`symbol`,`horizon_days`);
--> statement-breakpoint
CREATE INDEX `idx_screen_outcome_run` ON `screen_outcome` (`run_id`);
