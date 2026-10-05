CREATE TABLE `screen_run` (
  `id` text PRIMARY KEY NOT NULL,
  `run_at` integer NOT NULL,
  `status` text DEFAULT 'running' NOT NULL,
  `params` text NOT NULL,
  `fx_rates` text,
  `universe_count` integer DEFAULT 0 NOT NULL,
  `processed_count` integer DEFAULT 0 NOT NULL,
  `passed_universe` integer DEFAULT 0 NOT NULL,
  `passed_revision` integer DEFAULT 0 NOT NULL,
  `survivor_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_screen_run_run_at` ON `screen_run` (`run_at`);
--> statement-breakpoint
CREATE TABLE `screen_stock` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `symbol` text NOT NULL,
  `name` text NOT NULL,
  `region` text NOT NULL,
  `country` text,
  `sector` text,
  `currency` text,
  `mcap_eur` real,
  `adv_eur` real,
  `analysts` real,
  `fy1_rev` real,
  `fy2_rev` real,
  `rev_avg` real,
  `breadth` real,
  `sue` real,
  `roic` real,
  `nd_ebitda` real,
  `fscore` real,
  `mom_121` real,
  `fwd_pe` real,
  `up_last_30d` real,
  `down_last_30d` real,
  `composite` real,
  `pass_universe` integer DEFAULT false NOT NULL,
  `pass_revision` integer DEFAULT false NOT NULL,
  `pass_quality` integer DEFAULT false NOT NULL,
  `strict` integer DEFAULT false NOT NULL,
  `weight` real,
  `processed` integer DEFAULT false NOT NULL,
  `error` text,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `screen_run`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `idx_screen_stock_run` ON `screen_stock` (`run_id`);
--> statement-breakpoint
CREATE INDEX `idx_screen_stock_symbol` ON `screen_stock` (`symbol`);
