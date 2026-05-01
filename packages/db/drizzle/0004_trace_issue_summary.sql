ALTER TABLE `traces` ADD `has_issues` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `traces` ADD `issues` text DEFAULT '[]' NOT NULL;
