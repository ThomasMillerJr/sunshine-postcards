CREATE TABLE `postcard_images` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`postcard_id` integer NOT NULL,
	`side` text NOT NULL,
	`file_path` text NOT NULL,
	`original_filename` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`postcard_id`) REFERENCES `postcards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `postcards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`category` text DEFAULT '' NOT NULL,
	`era` text DEFAULT '' NOT NULL,
	`condition` text DEFAULT '' NOT NULL,
	`location_depicted` text,
	`publisher` text,
	`estimated_value` real,
	`notes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `research_results` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`postcard_id` integer NOT NULL,
	`source` text NOT NULL,
	`data` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`postcard_id`) REFERENCES `postcards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`postcard_id` integer NOT NULL,
	`status` text DEFAULT 'listed' NOT NULL,
	`platform` text DEFAULT 'ebay' NOT NULL,
	`listing_price` real,
	`sold_price` real,
	`fees` real,
	`profit` real,
	`listing_url` text,
	`listed_at` text,
	`sold_at` text,
	`notes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`postcard_id`) REFERENCES `postcards`(`id`) ON UPDATE no action ON DELETE cascade
);
