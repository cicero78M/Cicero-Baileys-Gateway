-- Drop cron_job_config table and related objects
DROP TRIGGER IF EXISTS cron_job_config_set_updated_at ON cron_job_config;
DROP FUNCTION IF EXISTS set_cron_job_config_updated_at();
DROP TABLE IF EXISTS cron_job_config;
