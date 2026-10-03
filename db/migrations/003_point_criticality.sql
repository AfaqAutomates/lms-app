-- Adds a Criticality field to Lubrication Points (High/Medium/Low), matching
-- the same concept already on Equipment and Components.
alter table lubrication_points add column if not exists criticality text;
