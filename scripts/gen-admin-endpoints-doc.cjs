const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, HeadingLevel, BorderStyle, WidthType, ShadingType,
  TableOfContents, PageNumber, Header, Footer, PageBreak, LevelFormat
} = require('docx');

const CONTENT_W = 9360;
const border = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const borders = { top: border, bottom: border, left: border, right: border };
const HEAD_FILL = 'D5E8F0';
const CODE_FILL = 'F2F2F2';
const cellMargins = { top: 80, bottom: 80, left: 120, right: 120 };

function txt(text, opts = {}) { return new TextRun({ text, ...opts }); }
function p(children, opts = {}) {
  return new Paragraph({ children: Array.isArray(children) ? children : [txt(String(children))], ...opts });
}
function mono(text) { return new TextRun({ text, font: 'Consolas', size: 20 }); }

function h1(text) { return new Paragraph({ heading: HeadingLevel.HEADING_1, children: [txt(text)] }); }
function h2(text) { return new Paragraph({ heading: HeadingLevel.HEADING_2, children: [txt(text)] }); }
function h3(text) { return new Paragraph({ heading: HeadingLevel.HEADING_3, children: [txt(text)] }); }

function cell(content, { w, fill, header = false } = {}) {
  const children = Array.isArray(content) ? content : [
    new Paragraph({ children: typeof content === 'string'
      ? [txt(content, header ? { bold: true } : {})]
      : [content] })
  ];
  return new TableCell({
    borders, width: { size: w, type: WidthType.DXA }, margins: cellMargins,
    ...(fill ? { shading: { fill, type: ShadingType.CLEAR } } : {}),
    children
  });
}

// generic table from header row + data rows; widths array sums to CONTENT_W
function table(widths, headerCells, rows) {
  const headRow = new TableRow({
    tableHeader: true,
    children: headerCells.map((c, i) => cell(c, { w: widths[i], fill: HEAD_FILL, header: true }))
  });
  const dataRows = rows.map(r => new TableRow({
    children: r.map((c, i) => {
      // allow {code:"..."} for monospace cell
      if (c && typeof c === 'object' && 'code' in c) {
        return cell([new Paragraph({ children: [mono(c.code)] })], { w: widths[i] });
      }
      return cell(String(c), { w: widths[i] });
    })
  }));
  return new Table({ width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: widths, rows: [headRow, ...dataRows] });
}

// params table: name | type | required | constraints / notes
function paramsTable(rows) {
  return table([2200, 1700, 1300, 4160],
    ['Field', 'Type', 'Required', 'Constraints / Notes'], rows);
}
// response field table
function fieldsTable(rows) {
  return table([2600, 1900, 4860], ['Field', 'Type', 'Description'], rows);
}

function spacer() { return new Paragraph({ children: [txt('')], spacing: { after: 60 } }); }

// endpoint header block
function endpoint(method, route, title) {
  return new Paragraph({
    spacing: { before: 200, after: 80 },
    heading: HeadingLevel.HEADING_3,
    children: [txt(`${method} `, { bold: true, color: '1F6FB2' }), mono(route)]
  });
}
function label(text) { return new Paragraph({ spacing: { before: 80, after: 20 }, children: [txt(text, { bold: true, size: 22 })] }); }
function note(text) { return new Paragraph({ spacing: { after: 40 }, children: [txt(text, { italics: true, size: 20 })] }); }

const children = [];

// ---- Title ----
children.push(new Paragraph({
  spacing: { before: 2400, after: 120 }, alignment: AlignmentType.CENTER,
  children: [txt('Meal Direct Backend', { bold: true, size: 56 })]
}));
children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 },
  children: [txt('Admin API — Endpoint Reference', { size: 36, color: '1F6FB2' })] }));
children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 },
  children: [txt('Request input, validation rules, and response schemas', { italics: true, size: 24 })] }));
children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 600 },
  children: [txt('Base path: ', { size: 22 }), mono('/v1/admin'), txt('   •   Generated 2026-06-23', { size: 22 })] }));
children.push(new Paragraph({ children: [new PageBreak()] }));

// ---- TOC ----
children.push(h1('Table of Contents'));
children.push(new TableOfContents('Table of Contents', { hyperlink: true, headingStyleRange: '1-2' }));
children.push(new Paragraph({ children: [new PageBreak()] }));

// ---- Conventions ----
children.push(h1('1. Conventions'));

children.push(h2('1.1 Authentication & authorization'));
children.push(p([txt('Every admin route requires a valid Supabase JWT in the '), mono('Authorization: Bearer <token>'),
  txt(' header. Guards: '), mono('JwtAuthGuard'), txt(' + '), mono('RolesGuard'), txt('.')]));
children.push(p([txt('Controller-level role gate: '), mono("@RequireRoles('campus_admin', 'super_admin')"), txt('.')]));
children.push(paramsTable([
  ['Role scope', 'n/a', 'yes', 'campus_admin → scoped to own campusId; super_admin → global, may pass any campusId.'],
  ['401 Unauthorized', 'n/a', 'n/a', 'Missing, invalid, or expired Supabase JWT.'],
  ['403 Forbidden', 'n/a', 'n/a', 'Admin role required; campus_admin requesting another campus; super-admin-only routes.'],
]));
children.push(note('Super-admin-only routes: user suspend/activate, all /admin-memberships routes.'));

children.push(h2('1.2 Response envelopes'));
children.push(p('Single-object responses are wrapped in a success envelope:'));
children.push(fieldsTable([
  [{ code: 'data' }, 'object', 'The resource record (shape varies per endpoint).'],
  [{ code: 'meta' }, 'object (optional)', 'Present only when extra metadata is attached.'],
]));
children.push(spacer());
children.push(p('List responses are wrapped in a list envelope:'));
children.push(fieldsTable([
  [{ code: 'data' }, 'array<object>', 'Array of resource records.'],
  [{ code: 'pagination' }, 'object', 'Cursor pagination metadata (see 1.3).'],
  [{ code: 'meta' }, 'object (optional)', 'Present only when extra metadata is attached.'],
]));

children.push(h2('1.3 Pagination metadata'));
children.push(note('pagination object on every list envelope:'));
children.push(fieldsTable([
  [{ code: 'hasMore' }, 'boolean', 'True when more rows exist beyond this page.'],
  [{ code: 'limit' }, 'number', 'Page size actually applied (default 20, max 100).'],
  [{ code: 'nextCursor' }, 'string (optional)', 'Opaque base64url cursor; omitted when hasMore is false. Note: cursor not emitted by current admin list queries (offset-style limit+1).'],
]));

children.push(h2('1.4 Cursor query params (shared by paginated lists)'));
children.push(paramsTable([
  ['cursor', 'string', 'no', 'Opaque pagination cursor.'],
  ['limit', 'number', 'no', 'Integer 1–100. Default 20.'],
]));

children.push(h2('1.5 Common value formats'));
children.push(fieldsTable([
  [{ code: 'date' }, 'string', 'ISO calendar date, pattern ^\\d{4}-\\d{2}-\\d{2}$ (e.g. 2026-06-23).'],
  [{ code: 'uuid' }, 'string', 'Database UUID.'],
  ['*Kobo', 'number (integer)', 'Money amount in kobo (1/100 NGN).'],
  ['timestamps', 'string', 'ISO-8601 datetime text (createdAt, updatedAt, etc.).'],
]));

children.push(h2('1.6 Error response shape'));
children.push(p('Errors return non-2xx with a JSON body:'));
children.push(fieldsTable([
  [{ code: 'code' }, 'string', 'e.g. FORBIDDEN, VALIDATION_FAILED, NOT_FOUND.'],
  [{ code: 'message' }, 'string', 'Human-readable detail.'],
]));

children.push(new Paragraph({ children: [new PageBreak()] }));

// ===================== Helpers to emit a full endpoint =====================
// opts: { method, route, title, roles, query[], params[], body[], resType, resFields[], notes[] }
function emit(opts) {
  children.push(endpoint(opts.method, '/v1/admin' + opts.route, opts.title));
  if (opts.title) children.push(note(opts.title));
  if (opts.roles) children.push(p([txt('Access: ', { bold: true, size: 20 }), txt(opts.roles, { size: 20 })]));
  if (opts.params && opts.params.length) { children.push(label('Path parameters')); children.push(paramsTable(opts.params)); }
  if (opts.query && opts.query.length) { children.push(label('Query parameters')); children.push(paramsTable(opts.query)); }
  if (opts.body && opts.body.length) { children.push(label('Request body (application/json)')); children.push(paramsTable(opts.body)); }
  if (opts.body && opts.body.length === 0) children.push(note('No request body.'));
  children.push(label(`Response — ${opts.resType || '200 OK, success envelope { data }'}`));
  if (opts.resFields && opts.resFields.length) children.push(fieldsTable(opts.resFields));
  if (opts.notes) opts.notes.forEach(n => children.push(note(n)));
  children.push(spacer());
}

// shared param defs
const P = {
  cursor: ['cursor', 'string', 'no', 'Pagination cursor.'],
  limit: ['limit', 'number', 'no', 'Integer 1–100, default 20.'],
  campusId: ['campusId', 'uuid', 'no', 'Filter by campus. campus_admin restricted to own campus.'],
};

// =========================================================================
// 2. SESSION & DASHBOARD
// =========================================================================
children.push(h1('2. Session & Dashboard'));

emit({
  method: 'GET', route: '/session', title: 'Authenticated admin session and scope.',
  roles: 'campus_admin, super_admin',
  resFields: [
    [{ code: 'userId' }, 'string', 'Authenticated admin user id.'],
    [{ code: 'role' }, 'string', "campus_admin or super_admin."],
    [{ code: 'campusId' }, 'string | null', 'Campus scope (null for global super admin).'],
    [{ code: 'email' }, 'string (optional)', 'Present when known from the token.'],
    [{ code: 'scopes' }, 'array<string>', "['admin:global'] for super_admin; ['admin:campus:<id>'] for campus_admin."],
  ],
});

emit({
  method: 'GET', route: '/dashboard', title: 'Admin operational dashboard for a service date.',
  roles: 'campus_admin, super_admin',
  query: [
    P.campusId,
    ['date', 'string', 'no', 'Service date (YYYY-MM-DD). Defaults to today.'],
  ],
  resFields: [
    [{ code: 'date' }, 'string', 'Service date used.'],
    [{ code: 'campusId' }, 'string | null', 'Campus scope applied.'],
    [{ code: 'orders' }, 'object', '{ total: number, paid: number }.'],
    [{ code: 'batches' }, 'object', '{ total: number, open: number }.'],
    [{ code: 'payments' }, 'object', '{ total: number, failed: number }.'],
    [{ code: 'escalations' }, 'object', '{ open: number }.'],
    [{ code: 'settlements' }, 'object', '{ payableKobo: number } (draft + approved).'],
    [{ code: 'alerts' }, 'array<object>', 'Currently always empty [].'],
  ],
});

// =========================================================================
// 3. ORDERS
// =========================================================================
children.push(h1('3. Orders'));

const orderListFields = [
  [{ code: 'id' }, 'string', 'Order id.'],
  [{ code: 'orderNumber' }, 'string', 'Human order number.'],
  [{ code: 'customerId' }, 'string', 'Customer profile id.'],
  [{ code: 'campusId' }, 'string', 'Campus id.'],
  [{ code: 'vendorId' }, 'string', 'Vendor id.'],
  [{ code: 'vendorDisplayName' }, 'string', 'Vendor display name.'],
  [{ code: 'serviceDate' }, 'string', 'Service date.'],
  [{ code: 'deliverySlotId' }, 'string', 'Delivery slot id.'],
  [{ code: 'locationId' }, 'string', 'Delivery location id.'],
  [{ code: 'orderStatus' }, 'string', 'Order status enum.'],
  [{ code: 'deliveryMode' }, 'string', 'Delivery mode.'],
  [{ code: 'totalKobo' }, 'number', 'Order total in kobo.'],
  [{ code: 'currency' }, 'string', 'Currency code.'],
  [{ code: 'createdAt' }, 'string', 'Created timestamp.'],
  [{ code: 'updatedAt' }, 'string', 'Updated timestamp.'],
];
const orderGetFields = [
  [{ code: 'id' }, 'string', 'Order id.'],
  [{ code: 'orderNumber' }, 'string', 'Human order number.'],
  [{ code: 'customerId' }, 'string', 'Customer profile id.'],
  [{ code: 'customerEmail' }, 'string | null', 'Customer email (left join).'],
  [{ code: 'campusId' }, 'string', 'Campus id.'],
  [{ code: 'vendorId' }, 'string', 'Vendor id.'],
  [{ code: 'vendorDisplayName' }, 'string', 'Vendor display name.'],
  [{ code: 'orderStatus' }, 'string', 'Order status enum.'],
  [{ code: 'deliveryMode' }, 'string', 'Delivery mode.'],
  [{ code: 'serviceDate' }, 'string', 'Service date.'],
  [{ code: 'totalKobo' }, 'number', 'Order total in kobo.'],
  [{ code: 'currency' }, 'string', 'Currency code.'],
  [{ code: 'createdAt' }, 'string', 'Created timestamp.'],
  [{ code: 'updatedAt' }, 'string', 'Updated timestamp.'],
];

emit({
  method: 'GET', route: '/orders', title: 'List orders (filtered, paginated).',
  query: [
    P.cursor, P.limit, P.campusId,
    ['status', 'string', 'no', 'One of: accepted, administratively_completed, cancelled, confirmed, delivered, expired, out_for_delivery, paid, pending_payment, preparing, ready, refunded.'],
    ['vendorId', 'uuid', 'no', 'Filter by vendor.'],
    ['slotId', 'uuid', 'no', 'Filter by delivery slot.'],
    ['date', 'string', 'no', 'Service date (YYYY-MM-DD).'],
    ['search', 'string', 'no', 'Max 120 chars; matches orderNumber (ilike).'],
  ],
  resType: '200 OK, list envelope { data[], pagination }',
  resFields: orderListFields,
});

emit({
  method: 'GET', route: '/orders/:orderId', title: 'Get a single order.',
  params: [['orderId', 'uuid', 'yes', 'Order id.']],
  resFields: orderGetFields,
  notes: ['404 NOT_FOUND if the order is not found / outside campus scope.'],
});

emit({
  method: 'POST', route: '/orders/:orderId/cancel', title: 'Cancel an order (admin).',
  params: [['orderId', 'uuid', 'yes', 'Order id.']],
  body: [['reason', 'string', 'no', 'Max 500 chars. Defaults to "Cancelled by admin." Drives a status transition to cancelled.']],
  resType: '200 OK, success envelope { data } (order record, see GET /orders/:orderId)',
  resFields: orderGetFields,
});

emit({
  method: 'POST', route: '/orders/:orderId/status-transition', title: 'Transition order status.',
  params: [['orderId', 'uuid', 'yes', 'Order id.']],
  body: [
    ['status', 'string', 'yes', 'Target order status (same enum as list status filter).'],
    ['reason', 'string', 'no', 'Max 500 chars.'],
  ],
  resType: '200 OK, success envelope { data } (order record)',
  resFields: orderGetFields,
  notes: ['400 VALIDATION_FAILED if the DB transition function rejects the change.'],
});

// =========================================================================
// 4. BATCHES
// =========================================================================
children.push(h1('4. Delivery Batches'));

const batchListFields = [
  [{ code: 'id' }, 'string', 'Batch id.'],
  [{ code: 'campusId' }, 'string', 'Campus id.'],
  [{ code: 'vendorId' }, 'string', 'Vendor id.'],
  [{ code: 'vendorDisplayName' }, 'string', 'Vendor display name.'],
  [{ code: 'serviceDate' }, 'string', 'Service date.'],
  [{ code: 'deliverySlotId' }, 'string', 'Delivery slot id.'],
  [{ code: 'zoneId' }, 'string', 'Zone id.'],
  [{ code: 'batchNumber' }, 'string', 'Batch number.'],
  [{ code: 'status' }, 'string', 'open, closed, assigned, in_progress, completed, cancelled.'],
  [{ code: 'deliveryMode' }, 'string', 'Delivery mode.'],
  [{ code: 'orderCount' }, 'number', 'Number of orders in batch.'],
  [{ code: 'deliveryEarningsKobo' }, 'number', 'Delivery earnings in kobo.'],
  [{ code: 'createdAt' }, 'string', 'Created timestamp.'],
  [{ code: 'updatedAt' }, 'string', 'Updated timestamp.'],
];
const batchGetFields = [
  [{ code: 'id' }, 'string', 'Batch id.'],
  [{ code: 'campusId' }, 'string', 'Campus id.'],
  [{ code: 'vendorId' }, 'string', 'Vendor id.'],
  [{ code: 'vendorDisplayName' }, 'string', 'Vendor display name.'],
  [{ code: 'serviceDate' }, 'string', 'Service date.'],
  [{ code: 'batchNumber' }, 'string', 'Batch number.'],
  [{ code: 'status' }, 'string', 'Batch status.'],
  [{ code: 'deliveryMode' }, 'string', 'Delivery mode.'],
  [{ code: 'orderCount' }, 'number', 'Number of orders.'],
  [{ code: 'deliveryEarningsKobo' }, 'number', 'Delivery earnings in kobo.'],
  [{ code: 'assignmentId' }, 'string | null', 'Delivery assignment id (left join).'],
  [{ code: 'riderId' }, 'string | null', 'Assigned rider id.'],
  [{ code: 'assignmentStatus' }, 'string | null', 'Assignment status.'],
  [{ code: 'createdAt' }, 'string', 'Created timestamp.'],
  [{ code: 'updatedAt' }, 'string', 'Updated timestamp.'],
];

emit({
  method: 'GET', route: '/batches', title: 'List delivery batches.',
  query: [
    P.cursor, P.limit, P.campusId,
    ['date', 'string', 'no', 'Service date (YYYY-MM-DD).'],
    ['status', 'string', 'no', 'open, closed, assigned, in_progress, completed, cancelled.'],
    ['vendorId', 'uuid', 'no', 'Filter by vendor.'],
    ['zoneId', 'uuid', 'no', 'Filter by zone.'],
  ],
  resType: '200 OK, list envelope { data[], pagination }',
  resFields: batchListFields,
});

emit({ method: 'GET', route: '/batches/:batchId', title: 'Get a single batch (with assignment).',
  params: [['batchId', 'uuid', 'yes', 'Batch id.']], resFields: batchGetFields,
  notes: ['404 NOT_FOUND if not found / outside scope.'] });

emit({ method: 'POST', route: '/batches/:batchId/close', title: 'Close a batch.',
  params: [['batchId', 'uuid', 'yes', 'Batch id.']], body: [],
  resType: '200 OK, success envelope { data } (batch record)', resFields: batchGetFields });

emit({ method: 'POST', route: '/batches/:batchId/assign-rider', title: 'Assign a rider to a batch.',
  params: [['batchId', 'uuid', 'yes', 'Batch id.']],
  body: [['riderId', 'uuid', 'yes', 'Rider to assign.']],
  resType: '200 OK, success envelope { data } (batch record)', resFields: batchGetFields });

emit({ method: 'POST', route: '/batches/:batchId/assign-vendor-delivery', title: 'Assign vendor self-delivery to a batch.',
  params: [['batchId', 'uuid', 'yes', 'Batch id.']],
  body: [['vendorId', 'uuid', 'yes', 'Vendor that will self-deliver.']],
  resType: '200 OK, success envelope { data } (batch record)', resFields: batchGetFields });

emit({ method: 'POST', route: '/batches/:batchId/reassign-rider', title: 'Reassign batch to a different rider.',
  params: [['batchId', 'uuid', 'yes', 'Batch id.']],
  body: [['riderId', 'uuid', 'yes', 'New rider.']],
  resType: '200 OK, success envelope { data } (batch record)', resFields: batchGetFields });

emit({ method: 'POST', route: '/batches/:batchId/cancel-assignment', title: 'Cancel the current batch assignment.',
  params: [['batchId', 'uuid', 'yes', 'Batch id.']], body: [],
  resType: '200 OK, success envelope { data } (batch record)', resFields: batchGetFields });

// =========================================================================
// 5. VENDORS
// =========================================================================
children.push(h1('5. Vendors'));

const vendorListFields = [
  [{ code: 'id' }, 'string', 'Vendor id.'],
  [{ code: 'campusId' }, 'string', 'Campus id.'],
  [{ code: 'legalName' }, 'string', 'Legal name.'],
  [{ code: 'displayName' }, 'string', 'Display name.'],
  [{ code: 'slug' }, 'string', 'URL slug.'],
  [{ code: 'status' }, 'string', 'approved, deactivated, pending, suspended.'],
  [{ code: 'active' }, 'boolean', 'Active flag.'],
  [{ code: 'phone' }, 'string | null', 'Phone.'],
  [{ code: 'email' }, 'string | null', 'Email.'],
  [{ code: 'createdAt' }, 'string', 'Created timestamp.'],
  [{ code: 'updatedAt' }, 'string', 'Updated timestamp.'],
];
const vendorGetFields = [
  [{ code: 'id' }, 'string', 'Vendor id.'],
  [{ code: 'campusId' }, 'string', 'Campus id.'],
  [{ code: 'legalName' }, 'string', 'Legal name.'],
  [{ code: 'displayName' }, 'string', 'Display name.'],
  [{ code: 'slug' }, 'string', 'URL slug.'],
  [{ code: 'description' }, 'string | null', 'Description.'],
  [{ code: 'phone' }, 'string | null', 'Phone.'],
  [{ code: 'email' }, 'string | null', 'Email.'],
  [{ code: 'status' }, 'string', 'Vendor status.'],
  [{ code: 'active' }, 'boolean', 'Active flag.'],
  [{ code: 'createdAt' }, 'string', 'Created timestamp.'],
  [{ code: 'updatedAt' }, 'string', 'Updated timestamp.'],
];

emit({ method: 'GET', route: '/vendors', title: 'List vendors.',
  query: [P.cursor, P.limit, P.campusId,
    ['search', 'string', 'no', 'Max 120 chars; matches displayName or legalName.'],
    ['status', 'string', 'no', 'approved, deactivated, pending, suspended.']],
  resType: '200 OK, list envelope { data[], pagination }', resFields: vendorListFields });

emit({ method: 'POST', route: '/vendors', title: 'Create a vendor.',
  body: [
    ['campusId', 'uuid', 'yes', 'Owning campus.'],
    ['legalName', 'string', 'yes', '2–160 chars.'],
    ['displayName', 'string', 'yes', '2–120 chars.'],
    ['slug', 'string', 'yes', 'Lowercase slug, pattern ^[a-z0-9]+(?:-[a-z0-9]+)*$.'],
  ],
  resType: '201 Created, success envelope { data }',
  resFields: [
    [{ code: 'id' }, 'string', 'New vendor id.'],
    [{ code: 'campusId' }, 'string', 'Campus id.'],
    [{ code: 'legalName' }, 'string', 'Legal name.'],
    [{ code: 'displayName' }, 'string', 'Display name.'],
    [{ code: 'slug' }, 'string', 'Slug.'],
    [{ code: 'status' }, 'string', 'Initial status.'],
    [{ code: 'active' }, 'boolean', 'Active flag.'],
  ] });

emit({ method: 'GET', route: '/vendors/:vendorId', title: 'Get a vendor.',
  params: [['vendorId', 'uuid', 'yes', 'Vendor id.']], resFields: vendorGetFields });

emit({ method: 'PATCH', route: '/vendors/:vendorId', title: 'Update vendor fields.',
  params: [['vendorId', 'uuid', 'yes', 'Vendor id.']],
  body: [
    ['displayName', 'string', 'no', 'Max 120 chars.'],
    ['description', 'string', 'no', 'Max 1000 chars.'],
    ['phone', 'string', 'no', 'Phone.'],
    ['active', 'boolean', 'no', 'Active flag.'],
  ],
  resType: '200 OK, success envelope { data } (vendor record)', resFields: vendorGetFields });

emit({ method: 'POST', route: '/vendors/:vendorId/approve', title: 'Approve a vendor (status=approved, active=true).',
  params: [['vendorId', 'uuid', 'yes', 'Vendor id.']], body: [],
  resType: '200 OK, success envelope { data } (vendor record)', resFields: vendorGetFields });

emit({ method: 'POST', route: '/vendors/:vendorId/suspend', title: 'Suspend a vendor (status=suspended).',
  params: [['vendorId', 'uuid', 'yes', 'Vendor id.']], body: [],
  resType: '200 OK, success envelope { data } (vendor record)', resFields: vendorGetFields });

emit({ method: 'POST', route: '/vendors/:vendorId/activate', title: 'Activate a vendor (alias of approve).',
  params: [['vendorId', 'uuid', 'yes', 'Vendor id.']], body: [],
  resType: '200 OK, success envelope { data } (vendor record)', resFields: vendorGetFields });

emit({ method: 'POST', route: '/vendors/:vendorId/users', title: 'Add or upsert a vendor user.',
  params: [['vendorId', 'uuid', 'yes', 'Vendor id.']],
  body: [
    ['userId', 'uuid', 'yes', 'User to attach.'],
    ['role', 'string', 'yes', "owner or staff."],
  ],
  resType: '201 Created, success envelope { data }',
  resFields: [
    [{ code: 'id' }, 'string', 'Vendor-user id.'],
    [{ code: 'vendorId' }, 'string', 'Vendor id.'],
    [{ code: 'userId' }, 'string', 'User id.'],
    [{ code: 'role' }, 'string', 'owner or staff.'],
    [{ code: 'active' }, 'boolean', 'Active flag.'],
  ] });

emit({ method: 'GET', route: '/vendors/:vendorId/performance', title: 'Vendor performance summary.',
  params: [['vendorId', 'uuid', 'yes', 'Vendor id.']],
  resFields: [
    [{ code: 'orderCount' }, 'number', 'Total orders.'],
    [{ code: 'grossSalesKobo' }, 'number', 'Gross sales in kobo.'],
    [{ code: 'reviewCount' }, 'number', 'Number of reviews.'],
    [{ code: 'averageVendorRating' }, 'number | null', 'Average vendor rating.'],
  ],
  notes: ['Returns {} if the vendor has no aggregate row.'] });

// =========================================================================
// 6. RIDERS
// =========================================================================
children.push(h1('6. Riders'));

const riderFields = [
  [{ code: 'id' }, 'string', 'Rider id.'],
  [{ code: 'campusId' }, 'string', 'Campus id.'],
  [{ code: 'userId' }, 'string', 'Linked user id.'],
  [{ code: 'displayName' }, 'string', 'Display name.'],
  [{ code: 'phone' }, 'string | null', 'Phone.'],
  [{ code: 'status' }, 'string', 'deactivated, pending, suspended, verified.'],
  [{ code: 'active' }, 'boolean', 'Active flag.'],
  [{ code: 'verifiedAt' }, 'string | null', 'Verification timestamp.'],
  [{ code: 'createdAt' }, 'string', 'Created timestamp.'],
];
const riderGetFields = riderFields.concat([[{ code: 'updatedAt' }, 'string', 'Updated timestamp.']]);

emit({ method: 'GET', route: '/riders', title: 'List riders.',
  query: [P.cursor, P.limit, P.campusId,
    ['search', 'string', 'no', 'Max 120 chars; matches displayName.'],
    ['status', 'string', 'no', 'deactivated, pending, suspended, verified.']],
  resType: '200 OK, list envelope { data[], pagination }', resFields: riderFields });

emit({ method: 'GET', route: '/riders/:riderId', title: 'Get a rider.',
  params: [['riderId', 'uuid', 'yes', 'Rider id.']], resFields: riderGetFields });

emit({ method: 'GET', route: '/riders/:riderId/assignments', title: 'List a rider’s delivery assignments (max 100).',
  params: [['riderId', 'uuid', 'yes', 'Rider id.']],
  resType: '200 OK, list envelope { data[], pagination } (hasMore=false, limit=count)',
  resFields: [
    [{ code: 'id' }, 'string', 'Assignment id.'],
    [{ code: 'batchId' }, 'string', 'Batch id.'],
    [{ code: 'riderId' }, 'string', 'Rider id.'],
    [{ code: 'status' }, 'string', 'Assignment status.'],
    [{ code: 'assignedAt' }, 'string | null', 'Assigned timestamp.'],
    [{ code: 'acceptedAt' }, 'string | null', 'Accepted timestamp.'],
    [{ code: 'pickedUpAt' }, 'string | null', 'Picked-up timestamp.'],
    [{ code: 'completedAt' }, 'string | null', 'Completed timestamp.'],
    [{ code: 'campusId' }, 'string', 'Campus id.'],
    [{ code: 'vendorId' }, 'string', 'Vendor id.'],
    [{ code: 'vendorDisplayName' }, 'string', 'Vendor display name.'],
    [{ code: 'serviceDate' }, 'string', 'Service date.'],
    [{ code: 'batchNumber' }, 'string', 'Batch number.'],
    [{ code: 'orderCount' }, 'number', 'Orders in batch.'],
  ] });

emit({ method: 'GET', route: '/riders/:riderId/settlements', title: 'List a rider’s settlements (max 100).',
  params: [['riderId', 'uuid', 'yes', 'Rider id.']],
  resType: '200 OK, list envelope { data[], pagination } (hasMore=false)',
  resFields: [
    [{ code: 'id' }, 'string', 'Settlement id.'],
    [{ code: 'campusId' }, 'string', 'Campus id.'],
    [{ code: 'riderId' }, 'string', 'Rider id.'],
    [{ code: 'settlementDate' }, 'string', 'Settlement date.'],
    [{ code: 'status' }, 'string', 'draft, approved, paid, cancelled.'],
    [{ code: 'deliveryEarningsKobo' }, 'number', 'Delivery earnings in kobo.'],
    [{ code: 'adjustmentsKobo' }, 'number', 'Adjustments in kobo.'],
    [{ code: 'payableKobo' }, 'number', 'Payable in kobo.'],
    [{ code: 'paidAt' }, 'string | null', 'Paid timestamp.'],
    [{ code: 'externalReference' }, 'string | null', 'External payment reference.'],
    [{ code: 'createdAt' }, 'string', 'Created timestamp.'],
  ] });

emit({ method: 'POST', route: '/riders/:riderId/verify', title: 'Verify a rider (status=verified, active=true).',
  params: [['riderId', 'uuid', 'yes', 'Rider id.']], body: [],
  resType: '200 OK, success envelope { data } (rider record)', resFields: riderGetFields });

emit({ method: 'POST', route: '/riders/:riderId/suspend', title: 'Suspend a rider (status=suspended).',
  params: [['riderId', 'uuid', 'yes', 'Rider id.']], body: [],
  resType: '200 OK, success envelope { data } (rider record)', resFields: riderGetFields });

emit({ method: 'POST', route: '/riders/:riderId/activate', title: 'Activate a rider (alias of verify).',
  params: [['riderId', 'uuid', 'yes', 'Rider id.']], body: [],
  resType: '200 OK, success envelope { data } (rider record)', resFields: riderGetFields });

// =========================================================================
// 7. INVENTORY
// =========================================================================
children.push(h1('7. Inventory'));

emit({ method: 'GET', route: '/inventory', title: 'List menu item inventory (max 100).',
  query: [P.campusId,
    ['date', 'string', 'no', 'Service date (YYYY-MM-DD).'],
    ['slotId', 'uuid', 'no', 'Filter by delivery slot.'],
    ['vendorId', 'uuid', 'no', 'Filter by vendor.'],
    ['state', 'string', 'no', 'available (remaining>5), low (1–5), sold_out (<=0).']],
  resType: '200 OK, list envelope { data[], pagination } (hasMore=false)',
  resFields: [
    [{ code: 'id' }, 'string', 'Inventory row id.'],
    [{ code: 'vendorId' }, 'string', 'Vendor id.'],
    [{ code: 'campusId' }, 'string', 'Campus id.'],
    [{ code: 'menuItemName' }, 'string', 'Menu item name.'],
    [{ code: 'serviceDate' }, 'string', 'Service date.'],
    [{ code: 'deliverySlotId' }, 'string', 'Delivery slot id.'],
    [{ code: 'quantityTotal' }, 'number', 'Total quantity.'],
    [{ code: 'quantityReserved' }, 'number', 'Reserved quantity.'],
    [{ code: 'quantitySold' }, 'number', 'Sold quantity.'],
    [{ code: 'quantityAdjusted' }, 'number', 'Adjusted quantity.'],
    [{ code: 'remainingQuantity' }, 'number', 'total + adjusted - reserved - sold.'],
  ] });

emit({ method: 'POST', route: '/inventory/:inventoryId/adjustments', title: 'Record an inventory adjustment.',
  params: [['inventoryId', 'uuid', 'yes', 'Inventory row id.']],
  body: [
    ['delta', 'number (integer)', 'yes', 'Signed adjustment amount.'],
    ['reason', 'string', 'yes', '3–200 chars.'],
  ],
  resType: '201 Created, success envelope { data }',
  resFields: [[{ code: 'adjustmentId' }, 'string', 'Created adjustment id (record_inventory_adjustment).']] });

// =========================================================================
// 8. ESCALATIONS
// =========================================================================
children.push(h1('8. Escalations'));

const escListFields = [
  [{ code: 'id' }, 'string', 'Escalation id.'],
  [{ code: 'orderId' }, 'string', 'Order id.'],
  [{ code: 'campusId' }, 'string', 'Campus id.'],
  [{ code: 'openedBy' }, 'string', 'User who opened it.'],
  [{ code: 'category' }, 'string', 'Category.'],
  [{ code: 'description' }, 'string', 'Description.'],
  [{ code: 'status' }, 'string', 'open, investigating, resolved, rejected.'],
  [{ code: 'assignedAdminId' }, 'string | null', 'Assigned admin id.'],
  [{ code: 'openedAt' }, 'string', 'Opened timestamp.'],
];
const escGetFields = [
  [{ code: 'id' }, 'string', 'Escalation id.'],
  [{ code: 'orderId' }, 'string', 'Order id.'],
  [{ code: 'campusId' }, 'string', 'Campus id.'],
  [{ code: 'category' }, 'string', 'Category.'],
  [{ code: 'description' }, 'string', 'Description.'],
  [{ code: 'status' }, 'string', 'Escalation status.'],
  [{ code: 'resolution' }, 'string | null', 'Resolution text.'],
  [{ code: 'assignedAdminId' }, 'string | null', 'Assigned admin id.'],
  [{ code: 'refundId' }, 'string | null', 'Linked refund id.'],
  [{ code: 'openedAt' }, 'string', 'Opened timestamp.'],
  [{ code: 'resolvedAt' }, 'string | null', 'Resolved timestamp.'],
];

emit({ method: 'GET', route: '/escalations', title: 'List escalations.',
  query: [P.cursor, P.limit, P.campusId,
    ['status', 'string', 'no', 'open, investigating, resolved, rejected.'],
    ['category', 'string', 'no', 'Filter by category.'],
    ['assignee', 'string', 'no', 'Filter by assignee (accepted; see note).']],
  resType: '200 OK, list envelope { data[], pagination }', resFields: escListFields,
  notes: ['assignee query param is accepted/validated but not applied in the current query.'] });

emit({ method: 'GET', route: '/escalations/:id', title: 'Get an escalation.',
  params: [['id', 'uuid', 'yes', 'Escalation id.']], resFields: escGetFields });

emit({ method: 'POST', route: '/escalations/:id/assign', title: 'Assign escalation to an admin (status→investigating).',
  params: [['id', 'uuid', 'yes', 'Escalation id.']],
  body: [['adminUserId', 'uuid', 'yes', 'Admin user to assign.']],
  resType: '200 OK, success envelope { data } (escalation record)', resFields: escGetFields });

emit({ method: 'POST', route: '/escalations/:id/request-evidence', title: 'Request evidence (status→investigating).',
  params: [['id', 'uuid', 'yes', 'Escalation id.']], body: [],
  resType: '200 OK, success envelope { data } (escalation record)', resFields: escGetFields });

emit({ method: 'POST', route: '/escalations/:id/resolve', title: 'Resolve escalation (status→resolved).',
  params: [['id', 'uuid', 'yes', 'Escalation id.']],
  body: [['resolution', 'string', 'yes', '3–1000 chars.']],
  resType: '200 OK, success envelope { data } (escalation record)', resFields: escGetFields });

emit({ method: 'POST', route: '/escalations/:id/refunds', title: 'Mark escalation refunded (status→resolved).',
  params: [['id', 'uuid', 'yes', 'Escalation id.']], body: [],
  resType: '201 Created, success envelope { data } (escalation record)', resFields: escGetFields });

// =========================================================================
// 9. SETTLEMENTS
// =========================================================================
children.push(h1('9. Settlements'));

const settlementListFields = [
  [{ code: 'id' }, 'string', 'Settlement id.'],
  [{ code: 'campusId' }, 'string', 'Campus id.'],
  [{ code: 'vendorId' }, 'string | null', 'Vendor id (vendor settlement).'],
  [{ code: 'riderId' }, 'string | null', 'Rider id (rider settlement).'],
  [{ code: 'settlementDate' }, 'string', 'Settlement date.'],
  [{ code: 'status' }, 'string', 'draft, approved, paid, cancelled.'],
  [{ code: 'payableKobo' }, 'number', 'Payable in kobo.'],
  [{ code: 'paidAt' }, 'string | null', 'Paid timestamp.'],
  [{ code: 'externalReference' }, 'string | null', 'External payment reference.'],
  [{ code: 'createdAt' }, 'string', 'Created timestamp.'],
];
const settlementGetFields = [
  [{ code: 'id' }, 'string', 'Settlement id.'],
  [{ code: 'campusId' }, 'string', 'Campus id.'],
  [{ code: 'vendorId' }, 'string | null', 'Vendor id.'],
  [{ code: 'riderId' }, 'string | null', 'Rider id.'],
  [{ code: 'settlementDate' }, 'string', 'Settlement date.'],
  [{ code: 'status' }, 'string', 'Settlement status.'],
  [{ code: 'grossFoodAmountKobo' }, 'number', 'Gross food amount in kobo.'],
  [{ code: 'deliveryEarningsKobo' }, 'number', 'Delivery earnings in kobo.'],
  [{ code: 'refundsKobo' }, 'number', 'Refunds in kobo.'],
  [{ code: 'adjustmentsKobo' }, 'number', 'Adjustments in kobo.'],
  [{ code: 'payableKobo' }, 'number', 'Payable in kobo.'],
  [{ code: 'paidAt' }, 'string | null', 'Paid timestamp.'],
  [{ code: 'externalReference' }, 'string | null', 'External payment reference.'],
];

emit({ method: 'GET', route: '/settlements', title: 'List settlements.',
  query: [P.cursor, P.limit, P.campusId,
    ['date', 'string', 'no', 'Settlement date (YYYY-MM-DD).'],
    ['status', 'string', 'no', 'approved, cancelled, draft, paid.'],
    ['beneficiaryType', 'string', 'no', 'rider or vendor.']],
  resType: '200 OK, list envelope { data[], pagination }', resFields: settlementListFields });

emit({ method: 'POST', route: '/settlements/preview', title: 'Preview a settlement (no write).',
  body: [
    ['beneficiaryType', 'string', 'yes', 'rider or vendor.'],
    ['beneficiaryId', 'uuid', 'yes', 'Vendor or rider id.'],
    ['settlementDate', 'string', 'yes', 'Date (YYYY-MM-DD).'],
  ],
  resType: '200 OK, success envelope { data }',
  resFields: [
    [{ code: 'beneficiaryType' }, 'string', 'Echoed type.'],
    [{ code: 'beneficiaryId' }, 'string', 'Echoed id.'],
    [{ code: 'settlementDate' }, 'string', 'Echoed date.'],
    [{ code: 'grossFoodAmountKobo' }, 'number', 'Vendor only: gross food amount.'],
    [{ code: 'deliveryEarningsKobo' }, 'number', 'Delivery earnings in kobo.'],
    [{ code: 'refundsKobo' }, 'number', 'Vendor only: refunds in kobo.'],
    [{ code: 'estimatedPayableKobo' }, 'number', 'Estimated payable in kobo.'],
  ],
  notes: ['Rider preview returns beneficiaryType/Id/Date, deliveryEarningsKobo, estimatedPayableKobo.',
          'Returns {} if no aggregate row.'] });

emit({ method: 'POST', route: '/settlements/generate', title: 'Generate (persist) a settlement.',
  body: [
    ['beneficiaryType', 'string', 'yes', 'rider or vendor.'],
    ['beneficiaryId', 'uuid', 'yes', 'Vendor or rider id.'],
    ['settlementDate', 'string', 'yes', 'Date (YYYY-MM-DD).'],
  ],
  resType: '201 Created, success envelope { data }',
  resFields: [[{ code: 'settlementId' }, 'string', 'Created settlement id (produce_*_daily_settlement).']] });

emit({ method: 'GET', route: '/settlements/:id', title: 'Get a settlement.',
  params: [['id', 'uuid', 'yes', 'Settlement id.']], resFields: settlementGetFields });

emit({ method: 'POST', route: '/settlements/:id/approve', title: 'Approve a settlement (status=approved).',
  params: [['id', 'uuid', 'yes', 'Settlement id.']], body: [],
  resType: '200 OK, success envelope { data } (settlement record)', resFields: settlementGetFields });

emit({ method: 'POST', route: '/settlements/:id/mark-paid', title: 'Mark settlement paid.',
  params: [['id', 'uuid', 'yes', 'Settlement id.']],
  body: [['externalReference', 'string', 'yes', '3–120 chars; external payment reference.']],
  resType: '200 OK, success envelope { data } (settlement record)', resFields: settlementGetFields });

emit({ method: 'POST', route: '/settlements/:id/adjustments', title: 'Add a settlement adjustment line.',
  params: [['id', 'uuid', 'yes', 'Settlement id.']],
  body: [
    ['amountKobo', 'number (integer)', 'yes', 'Signed adjustment amount in kobo.'],
    ['description', 'string', 'yes', '3–200 chars.'],
  ],
  resType: '201 Created, success envelope { data } (settlement record)', resFields: settlementGetFields });

// =========================================================================
// 10. REVIEWS
// =========================================================================
children.push(h1('10. Reviews'));

emit({ method: 'GET', route: '/reviews', title: 'List reviews.',
  query: [P.cursor, P.limit, P.campusId,
    ['status', 'string', 'no', 'approved, pending, rejected.'],
    ['rating', 'number', 'no', 'Integer 1–5; matches food/vendor/delivery rating.'],
    ['vendorId', 'uuid', 'no', 'Filter by vendor.']],
  resType: '200 OK, list envelope { data[], pagination }',
  resFields: [
    [{ code: 'id' }, 'string', 'Review id.'],
    [{ code: 'orderId' }, 'string', 'Order id.'],
    [{ code: 'campusId' }, 'string', 'Campus id.'],
    [{ code: 'vendorId' }, 'string', 'Vendor id.'],
    [{ code: 'foodRating' }, 'number | null', 'Food rating.'],
    [{ code: 'vendorRating' }, 'number | null', 'Vendor rating.'],
    [{ code: 'deliveryRating' }, 'number | null', 'Delivery rating.'],
    [{ code: 'comment' }, 'string | null', 'Comment.'],
    [{ code: 'moderationStatus' }, 'string', 'approved, pending, rejected.'],
    [{ code: 'createdAt' }, 'string', 'Created timestamp.'],
  ] });

emit({ method: 'POST', route: '/reviews/:reviewId/moderate', title: 'Moderate a review.',
  params: [['reviewId', 'uuid', 'yes', 'Review id.']],
  body: [['status', 'string', 'yes', 'approved, pending, rejected.']],
  resType: '201 Created, success envelope { data }',
  resFields: [
    [{ code: 'id' }, 'string', 'Review id.'],
    [{ code: 'moderationStatus' }, 'string', 'New moderation status.'],
  ] });

// =========================================================================
// 11. USERS
// =========================================================================
children.push(h1('11. Users'));

const userFields = [
  [{ code: 'id' }, 'string', 'User/profile id.'],
  [{ code: 'displayName' }, 'string', 'Display name.'],
  [{ code: 'email' }, 'string | null', 'Email.'],
  [{ code: 'phoneNumber' }, 'string | null', 'Phone number.'],
  [{ code: 'accountStatus' }, 'string', 'active, suspended, deactivated.'],
  [{ code: 'defaultCampusId' }, 'string | null', 'Default campus id.'],
  [{ code: 'createdAt' }, 'string', 'Created timestamp.'],
];

emit({ method: 'GET', route: '/users', title: 'List users.',
  query: [P.cursor, P.limit, P.campusId,
    ['search', 'string', 'no', 'Max 120 chars; matches email or displayName.'],
    ['status', 'string', 'no', 'active, suspended, deactivated.']],
  resType: '200 OK, list envelope { data[], pagination }', resFields: userFields });

emit({ method: 'GET', route: '/users/:userId', title: 'Get a user.',
  params: [['userId', 'uuid', 'yes', 'User id.']], resFields: userFields });

emit({ method: 'POST', route: '/users/:userId/suspend', title: 'Suspend a user. (super_admin only)',
  roles: 'super_admin only',
  params: [['userId', 'uuid', 'yes', 'User id.']], body: [],
  resType: '200 OK, success envelope { data } (user record)', resFields: userFields });

emit({ method: 'POST', route: '/users/:userId/activate', title: 'Activate a user. (super_admin only)',
  roles: 'super_admin only',
  params: [['userId', 'uuid', 'yes', 'User id.']], body: [],
  resType: '200 OK, success envelope { data } (user record)', resFields: userFields });

// =========================================================================
// 12. ADMIN MEMBERSHIPS  (super admin only)
// =========================================================================
children.push(h1('12. Admin Memberships'));
children.push(note('All routes in this section require super_admin.'));

const membershipFields = [
  [{ code: 'id' }, 'string', 'Membership id.'],
  [{ code: 'userId' }, 'string', 'User id.'],
  [{ code: 'campusId' }, 'string | null', 'Campus id (null for super_admin).'],
  [{ code: 'role' }, 'string', 'campus_admin or super_admin.'],
  [{ code: 'active' }, 'boolean', 'Active flag.'],
];

emit({ method: 'GET', route: '/admin-memberships', title: 'List all admin memberships.',
  roles: 'super_admin only',
  resType: '200 OK, list envelope { data[], pagination } (hasMore=false)',
  resFields: membershipFields.concat([
    [{ code: 'grantedAt' }, 'string', 'Granted timestamp.'],
    [{ code: 'revokedAt' }, 'string | null', 'Revoked timestamp.'],
  ]) });

emit({ method: 'POST', route: '/admin-memberships', title: 'Create an admin membership.',
  roles: 'super_admin only',
  body: [
    ['userId', 'uuid', 'yes', 'User to grant.'],
    ['role', 'string', 'yes', 'campus_admin or super_admin.'],
    ['campusId', 'uuid', 'no', 'Required when role = campus_admin (else 400 VALIDATION_FAILED).'],
  ],
  resType: '201 Created, success envelope { data }', resFields: membershipFields });

emit({ method: 'POST', route: '/admin-memberships/:id/revoke', title: 'Revoke a membership (active=false).',
  roles: 'super_admin only',
  params: [['id', 'uuid', 'yes', 'Membership id.']], body: [],
  resType: '200 OK, success envelope { data }', resFields: membershipFields });

emit({ method: 'POST', route: '/admin-memberships/:id/activate', title: 'Re-activate a membership (active=true).',
  roles: 'super_admin only',
  params: [['id', 'uuid', 'yes', 'Membership id.']], body: [],
  resType: '200 OK, success envelope { data }', resFields: membershipFields });

// =========================================================================
// 13. ANALYTICS & AUDIT LOGS
// =========================================================================
children.push(h1('13. Analytics & Audit Logs'));

emit({ method: 'GET', route: '/analytics', title: 'Aggregate order analytics.',
  query: [P.campusId,
    ['dateFrom', 'string', 'no', 'Start service date (YYYY-MM-DD).'],
    ['dateTo', 'string', 'no', 'End service date (YYYY-MM-DD).'],
    ['granularity', 'string', 'no', 'day, week, month (accepted; not applied in current query).']],
  resType: '200 OK, success envelope { data }',
  resFields: [
    [{ code: 'orderCount' }, 'number', 'Order count in range.'],
    [{ code: 'grossSalesKobo' }, 'number', 'Gross sales in kobo.'],
    [{ code: 'activeVendorCount' }, 'number', 'Distinct vendors with orders.'],
  ],
  notes: ['Returns {} if no rows.'] });

emit({ method: 'GET', route: '/audit-logs', title: 'List audit logs.',
  query: [P.cursor, P.limit, P.campusId,
    ['actorId', 'uuid', 'no', 'Filter by acting user.'],
    ['action', 'string', 'no', 'Filter by action.'],
    ['entityType', 'string', 'no', 'Filter by entity type.'],
    ['entityId', 'uuid', 'no', 'Filter by entity id.'],
    ['requestId', 'string', 'no', 'Filter by request id.']],
  resType: '200 OK, list envelope { data[], pagination }',
  resFields: [
    [{ code: 'id' }, 'string', 'Audit log id.'],
    [{ code: 'actorUserId' }, 'string | null', 'Acting user id.'],
    [{ code: 'campusId' }, 'string | null', 'Campus id.'],
    [{ code: 'action' }, 'string', 'Action name.'],
    [{ code: 'entityType' }, 'string', 'Entity type.'],
    [{ code: 'entityId' }, 'string | null', 'Entity id.'],
    [{ code: 'requestId' }, 'string | null', 'Request id.'],
    [{ code: 'createdAt' }, 'string', 'Created timestamp.'],
  ] });

// =========================================================================
// Build document
// =========================================================================
const doc = new Document({
  creator: 'Meal Direct',
  title: 'Admin API Endpoint Reference',
  styles: {
    default: { document: { run: { font: 'Arial', size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 32, bold: true, color: '1F4E79', font: 'Arial' },
        paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 26, bold: true, color: '2E75B6', font: 'Arial' },
        paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 22, bold: true, font: 'Arial' },
        paragraph: { spacing: { before: 160, after: 60 }, outlineLevel: 2 } },
    ],
  },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
    headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT,
      children: [txt('Meal Direct — Admin API', { size: 16, color: '888888' })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER,
      children: [txt('Page ', { size: 16, color: '888888' }),
        new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '888888' }),
        txt(' of ', { size: 16, color: '888888' }),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: '888888' })] })] }) },
    children,
  }],
});

const out = path.join('C:', 'sulvatech', 'mealdirectbackend', 'docs', 'admin-endpoints.docx');
Packer.toBuffer(doc).then(buf => { fs.writeFileSync(out, buf); console.log('WROTE', out, buf.length, 'bytes'); });
