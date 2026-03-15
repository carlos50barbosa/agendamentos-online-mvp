-- Migration: prepare wa_accounts for manual assisted Meta Cloud API connection

ALTER TABLE wa_accounts
  MODIFY COLUMN status ENUM('connected','disconnected','error','connecting','validating') NOT NULL DEFAULT 'disconnected';
