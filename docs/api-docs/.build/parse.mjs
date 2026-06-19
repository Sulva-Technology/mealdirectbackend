// Parse controllers + DTOs to extract request/query bodies, join with openapi.json
// for the authoritative endpoint list, params, descriptions, auth.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..'); // mealdirectbackend
const SRC = path.join(ROOT, 'src');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const files = walk(SRC);
const ctrlFiles = files.filter((f) => f.endsWith('.controller.ts'));
const dtoFiles = files.filter((f) => f.endsWith('.dto.ts'));

// ---- Parse DTO classes -> field list ----
const dtoClasses = {}; // name -> [{name, type, optional, enum}]

function parseDtoFields(body) {
  const fields = [];
  // split into property declarations: look for lines like `name!: type;` or `name?: type;`
  // collect preceding decorators for enum/optional detection
  const lines = body.split('\n');
  let pending = []; // decorators accumulated
  for (let raw of lines) {
    const line = raw.trim();
    if (line.startsWith('@')) {
      pending.push(line);
      continue;
    }
    // property?  name(!|?): Type;  (Type may span — take until ; on same line)
    const m = line.match(/^([a-zA-Z0-9_]+)(\?|!)?\s*:\s*([^;]+);/);
    if (m) {
      const fname = m[1];
      const optional = m[2] === '?' || pending.some((d) => d.startsWith('@IsOptional'));
      let type = m[3].trim();
      // enum from @IsIn([...]) or @ApiProperty enum
      const inDec = pending.find((d) => d.startsWith('@IsIn('));
      let enumVals = null;
      if (inDec) {
        const em = inDec.match(/\[([^\]]+)\]/);
        if (em) enumVals = em[1].replace(/['"\s]/g, '');
      }
      fields.push({ name: fname, type, optional, enum: enumVals });
      pending = [];
      continue;
    }
    if (line && !line.startsWith('//') && !line.startsWith('*') && !line.startsWith('/*'))
      pending = []; // reset on non-decorator, non-field
  }
  return fields;
}

const enums = {}; // constName -> 'a | b | c'
for (const f of dtoFiles) {
  const txt = fs.readFileSync(f, 'utf8');
  const enre = /const\s+(\w+)\s*=\s*\[([^\]]+)\]\s*as const/g;
  let en;
  while ((en = enre.exec(txt))) {
    enums[en[1]] = en[2].replace(/['"\s]/g, '').split(',').filter(Boolean).join(' | ');
  }
}

for (const f of dtoFiles) {
  const txt = fs.readFileSync(f, 'utf8');
  const re = /export class (\w+)[^{]*\{/g;
  let m;
  while ((m = re.exec(txt))) {
    const name = m[1];
    // find matching closing brace
    let i = re.lastIndex - 1;
    let depth = 0;
    let start = i;
    for (; i < txt.length; i++) {
      if (txt[i] === '{') depth++;
      else if (txt[i] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    const bodyTxt = txt.slice(start + 1, i);
    dtoClasses[name] = parseDtoFields(bodyTxt);
  }
}

// ---- Parse controllers -> route -> body/query DTO ----
const HTTP = ['Get', 'Post', 'Put', 'Patch', 'Delete'];
const routeInfo = {}; // `${method} ${fullpath}` -> { bodyDto, queryDto, roles }

function joinPath(base, sub) {
  let parts = ['/v1'];
  if (base) parts.push(base.replace(/^\/|\/$/g, ''));
  if (sub) parts.push(sub.replace(/^\/|\/$/g, ''));
  let p = parts.filter(Boolean).join('/').replace(/\/+/g, '/');
  // convert :param -> {param}
  p = p.replace(/:([a-zA-Z0-9_]+)/g, '{$1}');
  if (p.length > 3 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

for (const f of ctrlFiles) {
  const txt = fs.readFileSync(f, 'utf8');
  // split by @Controller to handle multiple controllers per file
  const ctrlRe = /@Controller\((?:'([^']*)'|`([^`]*)`)?\)/g;
  const ctrls = [];
  let cm;
  while ((cm = ctrlRe.exec(txt))) ctrls.push({ base: cm[1] || cm[2] || '', idx: cm.index });
  for (let ci = 0; ci < ctrls.length; ci++) {
    const base = ctrls[ci].base;
    const segStart = ctrls[ci].idx;
    const segEnd = ci + 1 < ctrls.length ? ctrls[ci + 1].idx : txt.length;
    const seg = txt.slice(segStart, segEnd);
    const classRoles = [...seg.matchAll(/@RequireRoles\(([^)]*)\)/g)];
    // class-level roles = first RequireRoles before any method http decorator
    // method scan
    const methodRe = new RegExp(`@(${HTTP.join('|')})\\((?:'([^']*)'|\`([^\`]*)\`)?\\)`, 'g');
    let mm;
    const decos = [];
    while ((mm = methodRe.exec(seg))) {
      decos.push({ http: mm[1], sub: mm[2] || mm[3] || '', idx: mm.index });
    }
    for (let k = 0; k < decos.length; k++) {
      const d = decos[k];
      const nextIdx = k + 1 < decos.length ? decos[k + 1].idx : seg.length;
      const block = seg.slice(d.idx, Math.min(nextIdx, d.idx + 600));
      const bodyM = block.match(/@Body\(\)\s*\w+\s*:\s*(\w+)/);
      const queryM = block.match(/@Query\(\)\s*\w+\s*:\s*(\w+)/);
      const roleM = block.match(/@RequireRoles\(([^)]*)\)/);
      const full = joinPath(base, d.sub);
      const key = `${d.http.toUpperCase()} ${full}`;
      routeInfo[key] = {
        bodyDto: bodyM ? bodyM[1] : null,
        queryDto: queryM ? queryM[1] : null,
        roles: roleM ? roleM[1].replace(/['"\s]/g, '') : null
      };
    }
  }
}

export { dtoClasses, routeInfo, ROOT, enums };

if (process.argv.includes('--debug')) {
  console.log('DTO classes:', Object.keys(dtoClasses).length);
  console.log('routes parsed:', Object.keys(routeInfo).length);
  console.log(JSON.stringify(routeInfo['POST /v1/orders'], null, 2));
  console.log(JSON.stringify(dtoClasses['CreateOrderDto'] || 'none', null, 2));
}
