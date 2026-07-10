begin;

alter table public.orders
  add column room_number text;

comment on column public.orders.room_number is
  'Optional hostel room number supplied by the customer to reduce delivery mix-ups.';

alter table public.orders
  add constraint orders_room_number_length
  check (room_number is null or length(room_number) <= 32);

comment on column public.orders.delivery_code is
  'Short hand-off code the customer reads to the rider to confirm delivery. Assigned by the API when the order is created and checked only against the rider''s out-for-delivery orders.';

commit;
