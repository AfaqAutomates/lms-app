-- 003_master_form_controls.sql
-- Controlled master-data values and lubrication-point criticality.

alter table lubrication_points
  add column if not exists criticality text;

-- Existing free-text values are left untouched so this migration is non-destructive.
-- New/edited records are controlled by the application UI.
