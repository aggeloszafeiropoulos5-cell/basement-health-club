create index nutrition_ai_settings_updated_by_idx on public.nutrition_ai_settings(updated_by) where updated_by is not null;
create index nutrition_ai_generations_measurement_idx on public.nutrition_ai_generations(measurement_id) where measurement_id is not null;
create index nutrition_plan_versions_member_idx on public.nutrition_plan_versions(member_id);
create index nutrition_plan_versions_changed_by_idx on public.nutrition_plan_versions(changed_by) where changed_by is not null;
