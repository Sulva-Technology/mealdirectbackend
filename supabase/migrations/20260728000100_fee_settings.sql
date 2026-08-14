begin;

insert into public.platform_settings (key, value, description)
values
  ('fee_delivery_base_kobo', to_jsonb(30000), 'Base customer delivery fee in kobo (₦300).'),
  ('fee_point_surcharge_kobo', to_jsonb(10000), 'Extra charged for point delivery (hostel room / classroom), in kobo (₦100).'),
  ('share_rider_ontime_kobo', to_jsonb(10000), 'Rider delivery share when delivered on time (₦100).'),
  ('share_rider_late_kobo', to_jsonb(5000), 'Rider delivery share when delivered late (₦50); the ₦50 difference forfeits to the platform.'),
  ('share_vendor_ontime_kobo', to_jsonb(5000), 'Vendor cooking share when food is ready early enough (₦50); forfeits to platform otherwise.'),
  ('share_point_rider_kobo', to_jsonb(5000), 'Portion of the point surcharge paid to the fulfiller for the extra distance (₦50). Not timing-gated.'),
  ('vendor_ready_lead_minutes', to_jsonb(10), 'Minutes before the slot target the vendor must mark food ready to earn the cooking share.')
on conflict (key) do nothing;

comment on table public.platform_settings is 'Key/value platform configuration. Includes the v2 fee model (fee_delivery_base_kobo, fee_point_surcharge_kobo) and the delivery-share incentive split (share_rider_ontime_kobo, share_rider_late_kobo, share_vendor_ontime_kobo, share_point_rider_kobo, vendor_ready_lead_minutes).';

commit;
