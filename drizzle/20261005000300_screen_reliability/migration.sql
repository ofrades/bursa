ALTER TABLE screen_run ADD COLUMN methodology_version integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE screen_run ADD COLUMN lock_token text;
--> statement-breakpoint
ALTER TABLE screen_run ADD COLUMN lock_until integer;
--> statement-breakpoint
ALTER TABLE screen_stock ADD COLUMN data_issues text NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE screen_stock ADD COLUMN input_snapshot text;
--> statement-breakpoint
UPDATE screen_run SET status = 'failed' WHERE status = 'running';
--> statement-breakpoint
CREATE UNIQUE INDEX idx_screen_single_running ON screen_run(status) WHERE status = 'running';
--> statement-breakpoint
CREATE UNIQUE INDEX idx_screen_stock_run_symbol ON screen_stock(run_id, symbol);
