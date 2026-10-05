ALTER TABLE `screen_stock` ADD `eps_growth_fy1` real;
--> statement-breakpoint
ALTER TABLE `screen_stock` ADD `roe_fwd` real;
--> statement-breakpoint
ALTER TABLE `screen_stock` ADD `fcf_yield` real;
--> statement-breakpoint
ALTER TABLE `screen_stock` ADD `fcf_conversion` real;
--> statement-breakpoint
ALTER TABLE `screen_stock` ADD `pass_expectations` integer DEFAULT false NOT NULL;
