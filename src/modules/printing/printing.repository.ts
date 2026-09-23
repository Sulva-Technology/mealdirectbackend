import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DatabaseService } from '../../database/database.service.js';
import type {
  AuthenticatedPrinter,
  PaperWidth,
  PrintJob,
  PrintJobKind,
  PrintJobListFilters,
  PrintJobStatus,
  PrintingRepositoryContract,
  Receipt,
  ReceiptItem,
  VendorPrinter
} from './printing.types.js';

const printerColumns = sql`
  id::text as "id",
  vendor_id::text as "vendorId",
  name,
  mac_address as "macAddress",
  paper_width_chars as "paperWidthChars",
  last_seen_at::text as "lastSeenAt",
  last_status_code as "lastStatusCode",
  coalesce(last_seen_at > now() - interval '2 minutes', false) as "online",
  created_at::text as "createdAt"
`;

const jobColumns = sql`
  j.id::text as "id",
  j.vendor_id::text as "vendorId",
  j.order_id::text as "orderId",
  o.order_number as "orderNumber",
  j.kind,
  j.status,
  j.print_after::text as "printAfter",
  j.attempts,
  j.printed_at::text as "printedAt",
  j.last_error as "lastError",
  j.created_at::text as "createdAt"
`;

@Injectable()
export class PrintingRepository implements PrintingRepositoryContract {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async listPrinters(vendorId: string): Promise<VendorPrinter[]> {
    const result = await sql<VendorPrinter>`
      select ${printerColumns}
      from public.vendor_printers
      where vendor_id = ${vendorId}::uuid and revoked_at is null
      order by created_at
    `.execute(this.database.db);
    return result.rows;
  }

  async findPrinter(vendorId: string, printerId: string): Promise<VendorPrinter | undefined> {
    const result = await sql<VendorPrinter>`
      select ${printerColumns}
      from public.vendor_printers
      where vendor_id = ${vendorId}::uuid and id = ${printerId}::uuid and revoked_at is null
    `.execute(this.database.db);
    return result.rows[0];
  }

  async insertPrinter(input: {
    vendorId: string;
    name: string;
    macAddress: string;
    paperWidthChars: PaperWidth;
    keyHash: string;
    createdBy: string;
  }): Promise<VendorPrinter> {
    const result = await sql<VendorPrinter>`
      insert into public.vendor_printers (vendor_id, name, mac_address, paper_width_chars, key_hash, created_by)
      values (
        ${input.vendorId}::uuid,
        ${input.name},
        ${input.macAddress},
        ${input.paperWidthChars},
        ${input.keyHash},
        ${input.createdBy}::uuid
      )
      returning ${printerColumns}
    `.execute(this.database.db);
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('Printer insert did not return a row.');
    }
    return row;
  }

  async revokePrinter(vendorId: string, printerId: string): Promise<VendorPrinter | undefined> {
    const result = await sql<VendorPrinter>`
      update public.vendor_printers
      set revoked_at = now()
      where vendor_id = ${vendorId}::uuid and id = ${printerId}::uuid and revoked_at is null
      returning ${printerColumns}
    `.execute(this.database.db);
    return result.rows[0];
  }

  async rotatePrinterKey(
    vendorId: string,
    printerId: string,
    keyHash: string
  ): Promise<VendorPrinter | undefined> {
    const result = await sql<VendorPrinter>`
      update public.vendor_printers
      set key_hash = ${keyHash}
      where vendor_id = ${vendorId}::uuid and id = ${printerId}::uuid and revoked_at is null
      returning ${printerColumns}
    `.execute(this.database.db);
    return result.rows[0];
  }

  async findLivePrinterByKeyHash(keyHash: string): Promise<AuthenticatedPrinter | undefined> {
    const result = await sql<AuthenticatedPrinter>`
      select
        id::text as "id",
        vendor_id::text as "vendorId",
        mac_address as "macAddress",
        paper_width_chars as "paperWidthChars"
      from public.vendor_printers
      where key_hash = ${keyHash} and revoked_at is null
    `.execute(this.database.db);
    return result.rows[0];
  }

  async recordPrinterSeen(printerId: string, statusCode: string | null): Promise<void> {
    await sql`
      update public.vendor_printers
      set last_seen_at = now(), last_status_code = ${statusCode}
      where id = ${printerId}::uuid
    `.execute(this.database.db);
  }

  async listJobs(vendorId: string, filters: PrintJobListFilters): Promise<PrintJob[]> {
    const result = await sql<PrintJob>`
      select ${jobColumns}
      from public.print_jobs j
      left join public.orders o on o.id = j.order_id
      where j.vendor_id = ${vendorId}::uuid
        and (${filters.status ?? null}::text is null or j.status = ${filters.status ?? null}::text)
      order by j.print_after desc, j.created_at desc
      limit ${filters.limit}
    `.execute(this.database.db);
    return result.rows;
  }

  async insertTestJob(vendorId: string): Promise<PrintJob> {
    const result = await sql<PrintJob>`
      with inserted as (
        insert into public.print_jobs (vendor_id, kind, print_after)
        values (${vendorId}::uuid, 'test', now())
        returning *
      )
      select ${jobColumns}
      from inserted j
      left join public.orders o on o.id = j.order_id
    `.execute(this.database.db);
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('Test print job insert did not return a row.');
    }
    return row;
  }

  async requeueOrderJob(vendorId: string, orderId: string): Promise<PrintJob> {
    // Reprint: reuse the order's single job row (order_id is unique), resetting it to print now.
    const result = await sql<PrintJob>`
      with upserted as (
        insert into public.print_jobs (vendor_id, order_id, kind, print_after)
        values (${vendorId}::uuid, ${orderId}::uuid, 'order', now())
        on conflict (order_id) do update
          set status = 'pending',
              print_after = now(),
              attempts = 0,
              leased_at = null,
              leased_printer_id = null,
              last_error = null
        returning *
      )
      select ${jobColumns}
      from upserted j
      left join public.orders o on o.id = j.order_id
    `.execute(this.database.db);
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('Reprint upsert did not return a row.');
    }
    return row;
  }

  async claimJob(
    printerId: string,
    leaseSeconds: number,
    windowHours: number
  ): Promise<string | null> {
    const result = await sql<{ jobId: string | null }>`
      select public.claim_print_job(${printerId}::uuid, ${leaseSeconds}, ${windowHours})::text as "jobId"
    `.execute(this.database.db);
    return result.rows[0]?.jobId ?? null;
  }

  async findCurrentLease(printerId: string, leaseSeconds: number): Promise<string | null> {
    const result = await sql<{ id: string }>`
      select id::text as "id"
      from public.print_jobs
      where leased_printer_id = ${printerId}::uuid
        and status = 'printing'
        and leased_at > now() - make_interval(secs => ${leaseSeconds})
      order by leased_at
      limit 1
    `.execute(this.database.db);
    return result.rows[0]?.id ?? null;
  }

  async findLeasedJob(
    printerId: string,
    jobId: string
  ): Promise<{ id: string; kind: PrintJobKind; orderId: string | null } | undefined> {
    const result = await sql<{ id: string; kind: PrintJobKind; orderId: string | null }>`
      select id::text as "id", kind, order_id::text as "orderId"
      from public.print_jobs
      where id = ${jobId}::uuid
        and leased_printer_id = ${printerId}::uuid
        and status = 'printing'
    `.execute(this.database.db);
    return result.rows[0];
  }

  async completeJob(
    jobId: string,
    printerId: string,
    success: boolean,
    error: string | null,
    maxAttempts: number
  ): Promise<PrintJobStatus | null> {
    const result = await sql<{ status: PrintJobStatus | null }>`
      select public.complete_print_job(
        ${jobId}::uuid, ${printerId}::uuid, ${success}, ${error}, ${maxAttempts}
      ) as "status"
    `.execute(this.database.db);
    return result.rows[0]?.status ?? null;
  }

  async findReceipt(vendorId: string, orderId: string): Promise<Receipt | undefined> {
    const orderResult = await sql<Omit<Receipt, 'items'>>`
      select
        o.id::text as "orderId",
        o.order_number as "orderNumber",
        v.display_name as "vendorDisplayName",
        o.service_date::text as "serviceDate",
        to_char(ds.delivery_time, 'HH24:MI') as "deliveryTime",
        ds.name as "deliverySlotName",
        c.timezone as "campusTimezone",
        coalesce(p.display_name, 'Customer') as "customerName",
        p.phone_number as "customerPhone",
        cl.name as "locationName",
        o.room_number as "roomNumber",
        o.delivery_mode::text as "deliveryMode",
        o.special_instructions as "specialInstructions",
        o.food_subtotal_kobo as "foodSubtotalKobo",
        o.paid_at::text as "paidAt"
      from public.orders o
      join public.vendors v on v.id = o.vendor_id
      join public.delivery_slots ds on ds.id = o.delivery_slot_id
      join public.campuses c on c.id = o.campus_id
      join public.campus_locations cl on cl.id = o.location_id
      left join public.profiles p on p.id = o.customer_id
      where o.vendor_id = ${vendorId}::uuid
        and o.id = ${orderId}::uuid
        and o.paid_at is not null
    `.execute(this.database.db);

    const order = orderResult.rows[0];
    if (order === undefined) return undefined;

    const itemsResult = await sql<ReceiptItem>`
      select
        oi.item_name as "itemName",
        oi.quantity,
        oi.unit_price_kobo as "unitPriceKobo",
        oi.line_total_kobo as "lineTotalKobo",
        oi.unit_type as "unitType",
        so.name as "soupName",
        oi.customization
      from public.order_items oi
      left join public.vendor_soup_options so on so.id = oi.soup_option_id
      where oi.order_id = ${orderId}::uuid
      order by oi.created_at
    `.execute(this.database.db);

    return { ...order, items: itemsResult.rows };
  }

  async findVendorDisplayName(vendorId: string): Promise<string | undefined> {
    const result = await sql<{ displayName: string }>`
      select display_name as "displayName" from public.vendors where id = ${vendorId}::uuid
    `.execute(this.database.db);
    return result.rows[0]?.displayName;
  }

  async hasVendorAccess(vendorId: string, userId: string): Promise<boolean> {
    const result = await sql<{ hasAccess: boolean }>`
      select public.has_vendor_access(${vendorId}::uuid, ${userId}::uuid) as "hasAccess"
    `.execute(this.database.db);
    return result.rows[0]?.hasAccess ?? false;
  }
}
