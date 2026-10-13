import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DatabaseService } from '../../database/database.service.js';
import type {
  AnalyticsRepositoryContract,
  CampusFunnelRow,
  FunnelQuery,
  FunnelStepCounts,
  RecordFunnelEventInput
} from './analytics.types.js';

@Injectable()
export class AnalyticsRepository implements AnalyticsRepositoryContract {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async recordEvent(input: RecordFunnelEventInput): Promise<void> {
    const campusId = input.campusId ?? null;
    const campusSlug = input.campusSlug ?? null;
    const userId = input.userId ?? null;

    // Campus and user are resolved by lookup rather than inserted directly, so an unknown
    // campus slug/id or a user whose profile row does not exist yet records the step with
    // a null reference instead of failing the request on a foreign key.
    await sql`
      insert into public.funnel_events (event, anonymous_id, user_id, campus_id)
      values (
        ${input.event},
        ${input.anonymousId}::uuid,
        (select p.id from public.profiles p where p.id = ${userId}::uuid),
        (
          select c.id
          from public.campuses c
          where c.id = ${campusId}::uuid or c.slug = ${campusSlug}
          limit 1
        )
      )
    `.execute(this.database.db);
  }

  async getStepCounts(query: FunnelQuery): Promise<FunnelStepCounts> {
    const campusId = query.campusId ?? null;
    const from = query.dateFrom ?? null;
    const to = query.dateTo ?? null;

    // Pre-signup steps are counted per device (anonymous_id); once the visitor is signed in
    // they are counted per user so a student switching phones is still one person.
    // Onboarding and first order come from profiles/orders, the source of truth.
    const result = await sql<FunnelStepCounts>`
      with events as (
        select event, anonymous_id, user_id
        from public.funnel_events
        where (${campusId}::uuid is null or campus_id = ${campusId}::uuid)
          and (${from}::date is null or occurred_at >= ${from}::date)
          and (${to}::date is null or occurred_at < (${to}::date + interval '1 day'))
      ),
      first_order_per_customer as (
        select distinct on (o.customer_id) o.customer_id, o.campus_id, o.paid_at as first_paid_at
        from public.orders o
        where o.paid_at is not null
          and o.order_status <> 'refunded'
        order by o.customer_id, o.paid_at
      )
      select
        (select count(distinct anonymous_id) from events where event = 'campus_link_opened')::integer
          as "campus_link_opened",
        (select count(distinct anonymous_id) from events where event = 'signup_started')::integer
          as "signup_started",
        (select count(distinct coalesce(user_id, anonymous_id)) from events where event = 'signup_completed')::integer
          as "signup_completed",
        (select count(distinct coalesce(user_id, anonymous_id)) from events where event = 'campus_selected')::integer
          as "campus_selected",
        (select count(distinct coalesce(user_id, anonymous_id)) from events where event = 'location_selected')::integer
          as "location_selected",
        (
          select count(*)
          from public.profiles p
          where p.onboarding_completed_at is not null
            and (${campusId}::uuid is null or p.default_campus_id = ${campusId}::uuid)
            and (${from}::date is null or p.onboarding_completed_at >= ${from}::date)
            and (${to}::date is null or p.onboarding_completed_at < (${to}::date + interval '1 day'))
        )::integer as "onboarding_completed",
        (
          select count(*)
          from first_order_per_customer f
          where (${campusId}::uuid is null or f.campus_id = ${campusId}::uuid)
            and (${from}::date is null or f.first_paid_at >= ${from}::date)
            and (${to}::date is null or f.first_paid_at < (${to}::date + interval '1 day'))
        )::integer as "first_order"
    `.execute(this.database.db);

    return (
      result.rows[0] ?? {
        campus_link_opened: 0,
        signup_started: 0,
        signup_completed: 0,
        campus_selected: 0,
        location_selected: 0,
        onboarding_completed: 0,
        first_order: 0
      }
    );
  }

  async getCampusBreakdown(query: FunnelQuery): Promise<CampusFunnelRow[]> {
    const campusId = query.campusId ?? null;
    const from = query.dateFrom ?? null;
    const to = query.dateTo ?? null;

    const result = await sql<CampusFunnelRow>`
      with events as (
        select
          campus_id,
          count(distinct anonymous_id) filter (where event = 'campus_link_opened') as link_opened,
          count(distinct coalesce(user_id, anonymous_id)) filter (where event = 'campus_selected')
            as campus_selected,
          count(distinct coalesce(user_id, anonymous_id)) filter (where event = 'location_selected')
            as location_selected
        from public.funnel_events
        where campus_id is not null
          and (${from}::date is null or occurred_at >= ${from}::date)
          and (${to}::date is null or occurred_at < (${to}::date + interval '1 day'))
        group by campus_id
      ),
      onboarded as (
        select p.default_campus_id as campus_id, count(*) as onboarding_completed
        from public.profiles p
        where p.onboarding_completed_at is not null
          and p.default_campus_id is not null
          and (${from}::date is null or p.onboarding_completed_at >= ${from}::date)
          and (${to}::date is null or p.onboarding_completed_at < (${to}::date + interval '1 day'))
        group by p.default_campus_id
      ),
      first_order_per_customer as (
        select distinct on (o.customer_id) o.customer_id, o.campus_id, o.paid_at as first_paid_at
        from public.orders o
        where o.paid_at is not null
          and o.order_status <> 'refunded'
        order by o.customer_id, o.paid_at
      ),
      first_ordered as (
        select f.campus_id, count(*) as first_order
        from first_order_per_customer f
        where (${from}::date is null or f.first_paid_at >= ${from}::date)
          and (${to}::date is null or f.first_paid_at < (${to}::date + interval '1 day'))
        group by f.campus_id
      )
      select
        c.id::text as "campusId",
        c.name as "campusName",
        c.slug as "campusSlug",
        coalesce(e.link_opened, 0)::integer as "linkOpened",
        coalesce(e.campus_selected, 0)::integer as "campusSelected",
        coalesce(e.location_selected, 0)::integer as "locationSelected",
        coalesce(ob.onboarding_completed, 0)::integer as "onboardingCompleted",
        coalesce(fo.first_order, 0)::integer as "firstOrder"
      from public.campuses c
      left join events e on e.campus_id = c.id
      left join onboarded ob on ob.campus_id = c.id
      left join first_ordered fo on fo.campus_id = c.id
      where ${campusId}::uuid is null or c.id = ${campusId}::uuid
      order by "firstOrder" desc, "onboardingCompleted" desc, c.name
    `.execute(this.database.db);

    return result.rows;
  }
}
