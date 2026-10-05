/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS test harness loads transpiled server modules with explicit mocks. */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
// Most Leads page tests check the lead data itself, so they run in legacy mode
// (all rows sent). Server-paged tests switch this on explicitly.
process.env.CRM_SERVER_PAGED_LEADS = '0'
// Lead data tests use the v3/original paths unless a test opts into compact rows.
process.env.CRM_COMPACT_LEAD_RPC = '0'
function loadTs(file, mocks = {}) {
  const filename = path.resolve(root, file)
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: filename,
  })
  const loadedModule = { exports: {} }
  const localRequire = (name) => {
    if (Object.hasOwn(mocks, name)) return mocks[name]
    if (name.startsWith('.')) {
      const resolved = path.resolve(path.dirname(filename), name)
      for (const ext of ['.ts', '.tsx']) if (fs.existsSync(resolved + ext)) return loadTs(resolved + ext, mocks)
    }
    return require(name)
  }
  vm.runInThisContext(`(function(require,module,exports){${outputText}\n})`, { filename })(localRequire, loadedModule, loadedModule.exports)
  return loadedModule.exports
}

const { mapConcurrent, chunks } = loadTs('lib/query-utils.ts')
const { classifyReminderAttention, getReminderNotificationSlot } = loadTs('lib/reminder-utils.ts')
const { parseCsv } = loadTs('lib/csv.ts')
const { normalizeWorksheetImportRows } = loadTs('lib/worksheet-import.ts')
test('worksheet CSV import preserves source columns and normalizes identity fields', () => {
  const source = '\uFEFFCompany Name,Agent Name ,T-Z,NPI,Follow up,Latest call,Notes,Provider\'s Name,Custom Field\r\n"A1 Healthcare"," Subhan ",EST,1234567890,9/24/2026,9/23/2026,"Called, follow up",Dr Test,keep me\r\n'
  const parsed = parseCsv(source)
  const result = normalizeWorksheetImportRows(parsed)
  assert.deepEqual(result.errors, [])
  assert.equal(result.rows[0].company_name, 'A1 Healthcare')
  assert.equal(result.rows[0].agent_name, 'Subhan')
  assert.equal(result.rows[0].timezone, 'Eastern')
  assert.equal(result.rows[0].callback_date, '2026-09-24')
  assert.equal(result.rows[0].notes, 'Called, follow up')
  assert.equal(result.rows[0].raw_data['Custom Field'], 'keep me')
})

test('worksheet CSV validation rejects the whole file for invalid rows and duplicates', () => {
  const rows = parseCsv('Company Name,Agent Name,NPI,Notes\nA,User,1234567890,ok\nA,User,1234567890,ok\nA,,bad,\n')
  const result = normalizeWorksheetImportRows(rows)
  assert.ok(result.errors.some(error => /duplicate/.test(error)))
  assert.ok(result.errors.some(error => /Agent Name/.test(error)))
  assert.ok(result.errors.some(error => /exactly 10 digits/.test(error)))
})
test('database batches preserve order and bound concurrent work', async () => {
  let active = 0, peak = 0
  const result = await mapConcurrent([0, 1, 2, 3, 4, 5], 2, async (n) => {
    peak = Math.max(peak, ++active)
    await new Promise((resolve) => setTimeout(resolve, n % 2 ? 1 : 5))
    active--
    return n * 2
  })
  assert.deepEqual(result, [0, 2, 4, 6, 8, 10])
  assert.equal(peak, 2)
  assert.deepEqual(await mapConcurrent([], 2, async () => assert.fail()), [])
  assert.deepEqual(chunks([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
  await assert.rejects(mapConcurrent([1], 0, async () => 1), RangeError)
  await assert.rejects(mapConcurrent([1], 1, async () => { throw Error('query failed') }), /query failed/)
})

test('reminder attention starts eight hours before and creates one slot per remaining hour', () => {
  const now = Date.parse('2026-09-24T12:00:00Z')
  const reminder = (id, minutes, done = false) => ({ id, done, remindAt: new Date(now + minutes * 60000).toISOString() })
  const result = classifyReminderAttention([
    reminder('overdue', -1), reminder('boundary', 480), reminder('later', 481), reminder('complete', 5, true),
  ], now)
  assert.deepEqual(result.overdue.map(r => r.id), ['overdue'])
  assert.deepEqual(result.nearDue.map(r => r.id), ['boundary'])
  assert.deepEqual(result.upcoming.map(r => r.id), ['complete', 'boundary', 'later'].filter(id => id !== 'complete'))
  assert.equal(getReminderNotificationSlot(new Date(now + 8 * 3600000).toISOString(), now), 'hour-8')
  assert.equal(getReminderNotificationSlot(new Date(now + 7 * 3600000).toISOString(), now), 'hour-7')
  assert.equal(getReminderNotificationSlot(new Date(now + 3600000).toISOString(), now), 'hour-1')
  assert.equal(getReminderNotificationSlot(new Date(now + 8 * 3600000 + 1).toISOString(), now), null)
  assert.equal(getReminderNotificationSlot(new Date(now - 1).toISOString(), now), null)
})

test('proxy refreshes cookies without a duplicate user lookup or trusting an identity', async () => {
  const { NextRequest } = require('next/server')
  let refreshed = 0
  const { proxy } = loadTs('proxy.ts', {
    '@supabase/ssr': { createServerClient: (_url, _key, options) => ({ auth: {
      getUser: () => assert.fail('Proxy must not repeat the page authentication request'),
      getSession: async () => {
        refreshed++
        options.cookies.setAll([{ name: 'test-session', value: 'renewed', options: { path: '/', httpOnly: true } }])
        return { data: { session: { user: { id: 'untrusted' } } }, error: null }
      },
    } }) },
  })
  const request = new NextRequest('http://localhost/dashboard', { headers: { 'x-user-id': 'spoofed' } })
  const response = await proxy(request)
  assert.equal(refreshed, 1)
  assert.equal(request.cookies.get('test-session').value, 'renewed')
  assert.equal(response.cookies.get('test-session').value, 'renewed')
  assert.match(response.headers.get('x-middleware-request-cookie'), /test-session=renewed/)
})

test('identity helper verifies with Auth and ignores arbitrary request headers', async () => {
  let verified = 0
  const result = { data: { user: { id: 'verified-user' } }, error: null }
  const server = loadTs('lib/supabase-server.ts', {
    react: { cache: (fn) => fn }, // no render dispatcher: exercise the uncached action path
    'next/headers': { cookies: async () => ({ getAll: () => [], set: () => {} }),
      headers: () => assert.fail('Identity must not be taken from headers') },
    '@supabase/ssr': { createServerClient: () => ({ auth: {
      getUser: async () => { verified++; return result },
      getSession: () => assert.fail('A stored session is not verified identity'),
    } }) },
  })
  assert.equal((await server.getCurrentUser()).data.user.id, 'verified-user')
  const helper = loadTs('lib/verified-user.ts', { './supabase-server': server })
  assert.equal(await helper.getVerifiedUserId(), 'verified-user')
  assert.equal(verified, 2)
  result.data.user = null
  assert.equal(await helper.getVerifiedUserId(), null)
  result.error = new (require('@supabase/supabase-js').AuthRetryableFetchError)('temporary outage', 503)
  await assert.rejects(server.getCurrentUser(), /temporary outage/)
})

// The Leads page sends rows packed ({ keys, rows }); unpack them so tests can
// assert on plain lead objects exactly as before.
function withPractices(props) {
  if (!props.packedPractices) return props
  const { unpackRows } = loadTs('lib/lead-pack.ts')
  const { packedPractices, ...rest } = props
  return { ...rest, practices: unpackRows(packedPractices) }
}

function database(tables, calls, failures = {}) {
  return { rpc(name, payload) {
    calls.push({ table: `rpc:${name}`, operation: 'rpc', payload })
    return Promise.resolve({ data: name === 'save_company_worksheet' ? { claimed: ['Interested','Meeting','Qualified','Follow Up','Proposal','Sold'].includes(payload.p_disposition) } : true,
      error: failures[`rpc:${name}`] ?? null })
  }, from(table) {
    const filters = []
    let operation = 'select', payload, single = false, range, sort, limit
    const query = {
      select() { return query },
      eq(key, value) { if (!key.startsWith('assigned_away.')) filters.push((row) => row[key] === value); return query },
      neq(key, value) { filters.push((row) => row[key] != null && row[key] !== value); return query },
      is(key, value) { filters.push((row) => (row[key] ?? null) === value); return query },
      in(key, values) { filters.push((row) => values.includes(row[key])); return query },
      order(key, options) { if (!options?.referencedTable) sort = [key, options?.ascending !== false]; return query },
      range(from, to) { range = [from, to]; return query },
      limit(n, options) { if (!options?.referencedTable) limit = n; return query },
      single() { single = true; return query },
      maybeSingle() { single = true; return query },
      update(value) { operation = 'update'; payload = value; return query },
      insert(value) { operation = 'insert'; payload = value; return query },
      then(resolve, reject) {
        calls.push({ table, operation, payload })
        let rows = (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)))
        if (sort) rows.sort((a, b) => String(a[sort[0]]).localeCompare(String(b[sort[0]])) * (sort[1] ? 1 : -1))
        if (range) rows = rows.slice(range[0], range[1] + 1)
        if (limit) rows = rows.slice(0, limit)
        return Promise.resolve({ data: single ? rows[0] ?? null : rows,
          error: failures[`${table}:${operation}`] ?? null }).then(resolve, reject)
      },
    }
    return query
  } }
}

function homeFixture(role) {
  const me = { id: 'me', auth_id: 'auth-me', full_name: 'Me', tenant_id: 'a', roles: { key: role, level: 2 }, tenants: { name: 'A' } }
  const practice = (id, owner, extra = {}) => ({ id, practice_code: `PR-${id}`, name: id,
    owner_tenant_id: owner, is_roster: false, deleted_at: null, state: 'NY', specialty: 'Family',
    created_at: '2026-09-21T00:00:00Z', practice_providers: [],
    lead_activity: id === 'p1' ? [{ created_at: '2026-09-21T01:00:00Z' }] : [],
    assigned_away: id === 'p1' ? [{ users: {full_name:'Junior',roles:{key:'agent'}} }] : [], ...extra })
  const practices = [practice('p1', 'a'), practice('p2', 'platform'), practice('p3', 'platform'),
    practice('p4', 'a', { is_roster: true }), practice('p5', 'a'),
    practice('p6', 'a', { ws_updated_by: 'me' })]
  const assignment = (pid, user, tenant = 'a', by = 'boss') => ({ practice_id: pid, assigned_to: user,
    tenant_id: tenant, assigned_by: by, status: 'active', assigned_at: '2026-09-20T00:00:00Z', current_status: 'Interested',
    master_practices: { practice_code: `PR-${pid}` }, users: { full_name: 'Junior', roles: { key: 'agent' } } })
  return { me, tables: {
    users: [me, { id: 'junior', full_name: 'Junior', tenant_id: 'a', roles: { key: 'agent', level: 4 } }],
    tenants: [{ id: 'a', name: 'A', slug: 'a', is_platform: false }],
    master_practices: practices,
    lead_assignments: [assignment('p1', 'me'), assignment('p5', 'me'), assignment('p6', 'me'), assignment('p5', 'other', 'b'), assignment('p1', 'junior', 'a', 'me')],
    lead_allocations: [{ practice_id: 'p2', tenant_id: 'a', status: 'active', master_practices: { practice_code: 'PR-p2' }, tenants: { name: 'A' } },
      { practice_id: 'p3', tenant_id: 'b', status: 'active', master_practices: { practice_code: 'PR-p3' }, tenants: { name: 'B' } }],
    lead_transfers: [{ practice_id: 'p2', to_user_id: 'me', created_at: '2026-09-20T01:00:00Z' }],
    lead_activity: [{ practice_id: 'p1', created_at: '2026-09-21T01:00:00Z' }],
    lead_company_claims: [],
    lead_worksheets: [{ practice_id: 'p6', tenant_id: 'a', updated_by: 'me', disposition: 'Interested', updated_at: '2026-09-21T02:00:00Z' }],
  } }
}

const expected = {
  super_admin: ['PR-p1', 'PR-p2', 'PR-p3', 'PR-p5', 'PR-p6'],
  company_admin: ['PR-p1', 'PR-p5', 'PR-p6', 'PR-p2'],
  manager: ['PR-p1', 'PR-p5', 'PR-p6'], team_lead: ['PR-p1', 'PR-p5', 'PR-p6'], agent: ['PR-p1', 'PR-p5'], closer: ['PR-p1', 'PR-p2', 'PR-p5'],
}
for (const [role, codes] of Object.entries(expected)) {
  test(`lead batching preserves ${role} scope, metadata and assignments`, async () => {
    const { me, tables } = homeFixture(role), calls = []
    const db = database(tables, calls)
    const { default: Home } = loadTs('app/page.tsx', {
      '../lib/supabase-server': { createSupabaseServer: async () => db,
        getCurrentUser: async () => ({ data: { user: { id: 'auth-me' } } }),
        getCurrentProfile: async (id) => { assert.equal(id, 'auth-me'); return { data: me } } },
      './PracticesTable': 'PracticesTable', './UploadLeadsButton': 'UploadLeadsButton', './AppShell': 'AppShell',
      'next/navigation': { redirect: () => { throw Error('unexpected redirect') } },
    })
    const view = await Home(), props = withPractices(view.props.children.props)
    assert.equal(props.viewerRole, role)
    assert.equal(props.completedWorksheetCount, ['agent', 'closer'].includes(role) ? 1 : undefined)
    assert.deepEqual(props.practices.map((p) => p.practiceCode), codes)
    assert.equal(props.practices.find((p) => p.practiceCode === 'PR-p1').lastDialed, '2026-09-21T01:00:00Z')
    assert.deepEqual(props.workedLeadCodes, ['PR-p1'])
    assert.equal(calls.filter((c) => c.table === 'lead_allocations').length, 1)
    assert.equal(calls.filter((c) => c.table === 'lead_activity').length, 0)
    assert.equal(calls.filter((c) => c.table === 'users' || c.table === 'tenants').length, 0)
    if (role === 'closer') assert.equal(props.practices.find((p) => p.practiceCode === 'PR-p2').status, 'Transferred')
    if (['manager', 'team_lead', 'company_admin'].includes(role)) {
      assert.equal(props.practices.find((p) => p.practiceCode === 'PR-p1').assignedAwayTo.name, 'Junior')
      assert.deepEqual(props.myAssignedCodes, ['PR-p1', 'PR-p5', 'PR-p6'])
    }
  })
}

const worksheet = { callDetails: 'Called the practice', additionalPhone: '', email: '', concernedPerson: '', directLine: '', callbackAt: '', timezone: 'Eastern', disposition: 'Interested' }
function loadWorksheet({ recipient = null, signedIn = true, failures = {} } = {}) {
  const calls = []
  const db = database({ master_practices: [{ id: 'p1', practice_code: 'PR-p1', deleted_at: null, practice_providers: [] }],
    lead_assignments: [{ practice_id: 'p1', assigned_to: 'me', status: 'active' }],
    lead_transfers: recipient ? [{ practice_id: 'p1', to_user_id: recipient }] : [] }, calls, failures)
  let authCalls = 0
  const actions = loadTs('app/worksheet-actions.ts', { '../lib/supabase-server': {
    createSupabaseServer: async () => db,
    getCurrentUser: async () => { authCalls++; return { data: { user: signedIn ? { id: 'auth-me' } : null } } },
    getCurrentProfile: async () => ({ data: { id: 'me', tenant_id: 'a', roles: { key: 'agent' } } }),
  } })
  return { calls, save: actions.saveWorksheet, authCalls: () => authCalls }
}
test('one worksheet request uses one atomic RPC with one auth verification', async () => {
  const run = loadWorksheet()
  assert.equal((await run.save('PR-p1', worksheet)).ok, true)
  assert.equal(run.authCalls(), 1)
  assert.equal(run.calls.filter((c) => c.table === 'rpc:save_company_worksheet').length, 1)
  assert.equal(run.calls.find((c) => c.table === 'rpc:save_company_worksheet').payload.p_disposition, 'Interested')
})
test('worksheet transfer lock and signed-out rejection still prevent writes', async () => {
  for (const options of [{ recipient: 'someone-else' }, { signedIn: false }]) {
    const run = loadWorksheet(options)
    assert.equal((await run.save('PR-p1', worksheet)).ok, false)
    assert.equal(run.calls.filter((c) => c.operation !== 'select').length, 0)
  }
})
test('New disposition and callback are sent through the atomic worksheet RPC', async () => {
  const run = loadWorksheet()
  await run.save('PR-p1', { ...worksheet, disposition: 'New', callbackAt: '2026-09-22T12:00:00Z' })
  const call = run.calls.find((c) => c.table === 'rpc:save_company_worksheet')
  assert.equal(call.payload.p_disposition, 'New')
  assert.equal(call.payload.p_callback_at, '2026-09-22T12:00:00.000Z')
})
test('atomic worksheet failure is reported without partial client writes', async () => {
  const run = loadWorksheet({ failures: { 'rpc:save_company_worksheet': { message: 'unavailable' } } })
  const result = await run.save('PR-p1', worksheet)
  assert.match(result.message, /Save failed: unavailable/)
  assert.equal(run.calls.filter((c) => c.operation === 'update' || c.operation === 'insert').length, 0)
})

for (const [role, assigned, transferred, allowed] of [
  ['agent', true, false, true], ['agent', false, false, false],
  ['closer', false, true, true], ['closer', false, false, false],
]) {
  test(`practice permissions: ${role}, assigned=${assigned}, transferred=${transferred}`, async () => {
    const calls = []
    const db = database({
      master_practices: [{ id: 'p1', practice_code: 'PR-p1', name: 'Practice', owner_tenant_id: 'other', practice_providers: [] }],
      lead_assignments: assigned ? [{ practice_id: 'p1', assigned_to: 'me', status: 'active' }] : [],
      lead_transfers: transferred ? [{ practice_id: 'p1', to_user_id: 'me' }] : [],
    }, calls)
    const { default: Page } = loadTs('app/practice/[code]/page.tsx', {
      '../../../lib/supabase-server': { createSupabaseServer: async () => db,
        getCurrentUser: async () => ({ data: { user: { id: 'auth-me' } } }),
        getCurrentProfile: async () => ({ data: { id: 'me', tenant_id: 'a', roles: { key: role } } }) },
      '../../AppShell': 'AppShell', '../../OrgRoster': 'OrgRoster', '../../Worksheet': 'Worksheet', '../../SectionTabs': 'SectionTabs',
      'next/link': 'a',
    })
    const view = await Page({ params: Promise.resolve({ code: 'PR-p1' }), searchParams: Promise.resolve({}) })
    assert.equal(view.props.title, allowed ? 'Practice Detail' : 'Practice not found')
    assert.equal(calls.filter(c => c.table === 'lead_assignments').length, 1)
  })
}

for (const [role, expectedScope] of [['super_admin', 'all'], ['manager', 'company'], ['agent', 'mine']]) {
  test(`joined reminders preserve ${role} scope and deleted-lead display`, async () => {
    const calls = []
    const row = (id, tenant, agent, practice) => ({ id, tenant_id: tenant, agent_id: agent,
      remind_at: '2026-09-22T10:00:00Z', done: false, completed_at: id === 'mine' ? '2026-09-22T11:00:00Z' : null, note: 'Call back', master_practices: practice,
      users: { full_name: agent }, tenants: { name: tenant } })
    const db = database({ lead_reminders: [
      row('mine', 'a', 'me', {practice_code: 'PR-1', name: 'Practice'}),
      row('deleted', 'a', 'me', null), row('team', 'a', 'other', null), row('outside', 'b', 'someone', null),
    ] }, calls)
    const actions = loadTs('app/reminders-actions.ts', { '../lib/supabase-server': {
      createSupabaseServer: async () => db,
      getCurrentUser: async () => ({ data: { user: {id: 'auth-me'} } }),
      getCurrentProfile: async () => ({ data: {id: 'me', tenant_id: 'a', roles: {key: role}} }),
    } })
    const result = await actions.getReminders()
    assert.equal(result.scope, expectedScope)
    assert.equal(result.reminders.length, role === 'super_admin' ? 4 : role === 'manager' ? 3 : 2)
    assert.equal(result.reminders.find(r=>r.id==='deleted').practiceDeleted, true)
    assert.equal(result.reminders.find(r=>r.id==='mine').practiceName, 'Practice')
    assert.equal(result.reminders.find(r=>r.id==='mine').agentName, role === 'agent' ? null : 'me')
    assert.equal(result.reminders.find(r=>r.id==='mine').companyName, role === 'super_admin' ? 'a' : null)
    assert.equal(result.reminders.find(r=>r.id==='mine').completedAt, '2026-09-22T11:00:00Z')
    assert.deepEqual(calls.map(c=>c.table), ['lead_reminders'])
  })
}

test('roster gets editor names without a separate users query', async () => {
  const calls = []
  const db = database({ master_practices: [
    {id:'p1',practice_code:'PR-1'}, {id:'p2',practice_code:'PR-2'},
  ], lead_worksheets: [{practice_id:'p1',updated_at:'2026-09-22',users:{full_name:'Editor'}}] }, calls)
  db.rpc = async () => ({ data: [
    {npi:'1',org_pac_id:'org',org_name:'Organization',is_clicked:true},
    {npi:'2',org_pac_id:'org',org_name:'Organization',is_clicked:false},
  ], error: null })
  const {getOrgRoster} = loadTs('app/roster-actions.ts', {'../lib/supabase-server':{createSupabaseServer:async()=>db}})
  const result = await getOrgRoster('1')
  assert.equal(result.hasOrg,true)
  assert.equal(result.members[0].workedBy,'Editor')
  assert.equal(result.members[1].workedBy,null)
  assert.deepEqual(calls.map(c=>c.table),['master_practices','lead_worksheets'])
})

for (const [role, expectedCodes] of Object.entries(expected)) {
  test(`practice counter uses the ${role} lead scope`, async () => {
    const {tables} = homeFixture(role)
    const {getPracticeNavigation} = loadTs('lib/practice-navigation.ts')
    const codes = await getPracticeNavigation(database(tables, []), {role, userId:'me', tenantId:'a'})
    assert.deepEqual([...codes].sort(), [...expectedCodes].sort())
  })
}

test('marking a reminder done persists and returns its completion time', async () => {
  const calls = []
  const db = database({ lead_reminders: [{ id: 'r1', tenant_id: 'a', agent_id: 'me', done: false }] }, calls)
  const actions = loadTs('app/reminders-actions.ts', { '../lib/supabase-server': {
    createSupabaseServer: async () => db,
    getCurrentUser: async () => ({ data: { user: {id: 'auth-me'} } }),
    getCurrentProfile: async () => ({ data: {id: 'me', tenant_id: 'a', roles: {key: 'agent'}} }),
  } })
  const result = await actions.markReminderDone('r1')
  assert.equal(result.ok, true)
  assert.ok(Number.isFinite(Date.parse(result.completedAt)))
  const update = calls.find(call => call.table === 'lead_reminders' && call.operation === 'update')
  assert.equal(update.payload.done, true)
  assert.equal(update.payload.completed_at, result.completedAt)
})
test('practice counter includes assigned leads beyond the first 1000 rows', async () => {
  const records = Array.from({length:1205}, (_, i)=>({id:String(i),practice_code:'PR-'+i,name:String(i).padStart(5,'0'),is_roster:false}))
  const db = database({master_practices:records,lead_assignments:records.map(p=>({practice_id:p.id,assigned_to:'me',status:'active'}))},[])
  const {getPracticeNavigation} = loadTs('lib/practice-navigation.ts')
  const codes = await getPracticeNavigation(db,{role:'agent',userId:'me',tenantId:'a'})
  assert.equal(codes.length,1205)
  assert.ok(codes.includes('PR-1204'))
})
for (const role of ['manager','super_admin','agent','signed_out']) {
  test(`lazy lead options enforce ${role} permissions`, async () => {
    const calls=[]
    const db=database({users:[{id:'junior',tenant_id:'a',status:'active',full_name:'Junior',roles:{key:'agent',level:4}},{id:'outsider',tenant_id:'b',status:'active',roles:{key:'agent',level:4}}],tenants:[{slug:'a',name:'A',is_platform:false}]},calls)
    const {GET}=loadTs('app/api/lead-options/route.ts',{'../../../lib/supabase-server':{
      createSupabaseServer:async()=>db,getCurrentUser:async()=>({data:{user:role==='signed_out'?null:{id:'auth-me'}}}),
      getCurrentProfile:async()=>({data:{id:'me',tenant_id:'a',roles:{key:role,level:2}}}),
    }})
    const response=await GET(), payload=await response.json()
    assert.equal(response.headers.get('cache-control'),'private, no-store')
    assert.equal(response.status,role==='signed_out'?401:role==='agent'?403:200)
    if(role==='manager') assert.deepEqual(payload.agents.map(p=>p.id),['junior'])
    if(role==='super_admin') assert.deepEqual(payload.companies.map(p=>p.slug),['a'])
    if(role==='agent'||role==='signed_out') assert.equal(calls.length,0)
  })
}

for (const role of ['super_admin', 'company_admin', 'agent', null]) {
  test(`allocation history authorizes ${role ?? 'signed_out'} before reading data`, async () => {
    const calls = []
    const db = database({ lead_allocations: [{ allocated_at: '2026-09-22T00:00:00Z', status: 'active', tenants: { name: 'A' }, master_practices: { name: 'Practice' } }] }, calls)
    const { getAllocationHistory } = loadTs('app/admin/allocation-history-actions.ts', {
      '../../lib/supabase-server': {
        createSupabaseServer: async () => db,
        getCurrentUser: async () => ({ data: { user: role ? { id: 'verified' } : null } }),
        getCurrentProfile: async () => ({ data: { roles: { key: role } } }),
      },
    })
    if (role === 'super_admin') {
      const rows = await getAllocationHistory()
      assert.equal(rows.length, 1)
      assert.equal(rows[0].company, 'A')
      assert.equal(rows[0].practice, 'Practice')
      assert.equal(calls.length, 1)
    } else {
      await assert.rejects(getAllocationHistory(), /Not allowed|Not signed in/)
      assert.equal(calls.length, 0)
    }
  })
}


function deletionFixture({ role = 'super_admin', platform = false, authFailure = null, profileFailure = null, tenantFailure = null, businessDataFailure = null, memberRole = 'agent', size = 1, shared = false } = {}) {
  const calls = []
  let members = Array.from({ length: size }, (_, i) => ({ id: `member-${i}`, auth_id: `login-${i}`, tenant_id: 'target', roles: { key: memberRole } }))
  if (shared) members.push({ id: 'outside', auth_id: 'login-0', tenant_id: 'other', roles: { key: 'agent' } })
  const admin = {
    auth: { admin: { deleteUser: async id => { calls.push(`auth:${id}`); return { error: authFailure } } } },
    from(table) {
      const filters = []; let operation = 'read', single = false, range = null, countOnly = false, max = null
      const query = {
        select(_fields, options) { countOnly = options?.head; return query },
        eq(key, value) { filters.push(row => row[key] === value); return query },
        neq(key, value) { filters.push(row => row[key] !== value); return query },
        in(key, values) { filters.push(row => values.includes(row[key])); return query },
        order() { return query }, range(from, to) { range = [from, to]; return query },
        limit(n) { max = n; return query }, overrideTypes() { return query },
        maybeSingle() { single = true; return query }, delete() { operation = 'delete'; return query },
        update() { operation = 'update'; return query },
        then(resolve, reject) {
          let rows
          if (table === 'users') rows = members
          else if (table === 'tenants') rows = [{ id: 'target', is_platform: platform }]
          else rows = [] // business-data cleanup tables: nothing to clean up in these fixtures by default
          rows = rows.filter(row => filters.every(fn => fn(row)))
          let error = null
          if (operation === 'delete') {
            calls.push(`delete:${table}`)
            if (table === 'users') error = profileFailure
            else if (table === 'tenants') error = tenantFailure
            else error = businessDataFailure
            if (!error && table === 'users') members = members.filter(row => !rows.includes(row))
          }
          const count = rows.length
          if (range) rows = rows.slice(range[0], range[1] + 1)
          if (max !== null) rows = rows.slice(0, max)
          return Promise.resolve({ data: countOnly ? null : single ? rows[0] ?? null : rows, count, error }).then(resolve, reject)
        },
      }
      return query
    },
  }
  const { deleteCompany } = loadTs('app/admin-manage-actions.ts', {
    '../lib/supabase-server': {
      getCurrentUser: async () => ({ data: { user: role ? { id: 'admin-login' } : null } }),
      getCurrentProfile: async () => ({ data: { id: 'admin', tenant_id: 'platform', roles: { key: role } } }),
    },
    '../lib/supabase-admin': { createSupabaseAdmin: () => admin },
  })
  return { run: () => deleteCompany('target'), calls }
}

test('company and users delete through APIs without a SQL function', async () => {
  const run = deletionFixture()
  assert.equal((await run.run()).ok, true)
  assert.deepEqual(run.calls, [
    'delete:lead_activity', 'delete:lead_reminders', 'delete:lead_transfers', 'delete:lead_assignments',
    'delete:lead_worksheets', 'delete:lead_company_claims', 'delete:lead_allocations', 'delete:sales',
    'delete:client_ownership', 'auth:login-0', 'delete:users', 'delete:tenants',
  ])
})
test('company deletion protects roles, platform and shared logins', async () => {
  for (const options of [{ role: null }, { role: 'company_admin' }, { platform: true }, { memberRole: 'super_admin' }, { shared: true }]) {
    const run = deletionFixture(options)
    assert.equal((await run.run()).ok, false)
    assert.deepEqual(run.calls, [])
  }
})
test('Auth failure preserves the profile and stops company deletion', async () => {
  const run = deletionFixture({ authFailure: { code: 'bad_key', message: 'Unregistered API key' } })
  assert.equal((await run.run()).ok, false)
  assert.deepEqual(run.calls, [
    'delete:lead_activity', 'delete:lead_reminders', 'delete:lead_transfers', 'delete:lead_assignments',
    'delete:lead_worksheets', 'delete:lead_company_claims', 'delete:lead_allocations', 'delete:sales',
    'delete:client_ownership', 'auth:login-0',
  ])
})
test('already removed login can be retried', async () => {
  const run = deletionFixture({ authFailure: { code: 'user_not_found' } })
  assert.equal((await run.run()).ok, true)
})
test('partial failure is reported without claiming rollback', async () => {
  for (const options of [{ profileFailure: { message: 'Linked records' } }, { tenantFailure: { message: 'Linked records' } }]) {
    const run = deletionFixture(options)
    const result = await run.run()
    assert.equal(result.ok, false)
    assert.match(result.message, /Deletion is incomplete/)
    if (options.profileFailure) assert.ok(!run.calls.includes('delete:tenants'))
  }
})
test('company deletion removes tenant-scoped business data before touching users, and stops cleanly if that fails', async () => {
  const ok = await deletionFixture().run()
  assert.equal(ok.ok, true)
  const failedRun = deletionFixture({ businessDataFailure: { message: 'Linked records' } })
  const failed = await failedRun.run()
  assert.equal(failed.ok, false)
  assert.match(failed.message, /Nothing was deleted/) // fails on the very first cleanup table, before anything else ran
  assert.deepEqual(failedRun.calls, ['delete:lead_activity'])
})
test('company deletion loads team members beyond the API row limit', async () => {
  const run = deletionFixture({ size: 1001 })
  assert.equal((await run.run()).ok, true)
  assert.equal(run.calls.filter(call => call.startsWith('auth:')).length, 1001)
  assert.equal(run.calls.at(-1), 'delete:tenants')
})

test('worksheet import edits create tenant-scoped before-and-after audit history', () => {
  const sql = fs.readFileSync(path.join(root, 'database/worksheet-import-edit.sql'), 'utf8')
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.worksheet_import_updates/)
  assert.match(sql, /changed_fields jsonb NOT NULL/)
  assert.match(sql, /before_data jsonb NOT NULL/)
  assert.match(sql, /after_data jsonb NOT NULL/)
  assert.match(sql, /r\.key IN \('company_admin','manager','team_lead'\).*u\.tenant_id = worksheet_import_updates\.tenant_id/s)
  assert.match(sql, /INSERT INTO public\.worksheet_import_updates/)
  const updateBlock = sql.match(/UPDATE public\.lead_worksheets\s+SET([\s\S]*?)WHERE tenant_id = p_tenant_id/)
  assert.ok(updateBlock)
  assert.doesNotMatch(updateBlock[1], /updated_by\s*=/)
})

test('worksheet update history is hidden from agents and available to management roles', () => {
  const action = fs.readFileSync(path.join(root, 'app/worksheet-updates-actions.ts'), 'utf8')
  const shell = fs.readFileSync(path.join(root, 'app/AppShell.tsx'), 'utf8')
  assert.match(action, /\['super_admin', 'company_admin', 'manager', 'team_lead'\]\.includes\(roleKey\)/)
  assert.match(action, /query = query\.eq\('tenant_id', me\.tenant_id!\)/)
  assert.match(shell, /n\.href === '\/worksheet-updates'.*showAdmin \|\| canManageUsers/)
  assert.match(shell, /item\.href === '\/admin' \|\| item\.href === '\/worksheet-updates'/)
})

// One-round-trip RPC path must produce exactly what the original queries produce.
function withLeadRpcs(db, tables) {
  db.rpc = (name, a) => {
    const byName = (x, y) => String(x.name).localeCompare(String(y.name)) || String(x.id).localeCompare(String(y.id))
    if (name === 'crm_lead_rows') {
      let rows = tables.master_practices.filter(p => !p.is_roster)
      if (a.p_mode === 'all') rows = rows.filter(p => !p.deleted_at)
      else if (a.p_mode === 'owner') rows = rows.filter(p => p.owner_tenant_id === a.p_tenant)
      else if (a.p_mode === 'ids') rows = rows.filter(p => a.p_ids.includes(p.id))
      return Promise.resolve({ data: rows.slice().sort(byName).map(r => {
        const o = { ...r }; if (!a.p_assigned_by) delete o.assigned_away; return o }), error: null })
    }
    if (name === 'crm_active_allocations') return Promise.resolve({ data: tables.lead_allocations
      .filter(r => r.status === 'active' && (!a.p_tenant || r.tenant_id === a.p_tenant)), error: null })
    return Promise.resolve({ data: null, error: { code: 'PGRST202' } })
  }
  return db
}
for (const role of Object.keys(expected)) {
  test(`lead RPC path matches original queries for ${role}`, async () => {
    const run = async (rpc) => {
      const { me, tables } = homeFixture(role), calls = []
      let db = database(tables, calls); if (rpc) db = withLeadRpcs(db, tables)
      const { default: Home } = loadTs('app/page.tsx', {
        '../lib/supabase-server': { createSupabaseServer: async () => db,
          getCurrentUser: async () => ({ data: { user: { id: 'auth-me' } } }),
          getCurrentProfile: async () => ({ data: me }) },
        './PracticesTable': 'PracticesTable', './UploadLeadsButton': 'UploadLeadsButton', './AppShell': 'AppShell',
        'next/navigation': { redirect: () => { throw Error('unexpected redirect') } } })
      return { props: withPractices((await Home()).props.children.props), calls: calls.length }
    }
    const before = await run(false), after = await run(true)
    const norm = x => JSON.stringify({ ...x, practices: [...x.practices].sort((p, q) => p.practiceCode.localeCompare(q.practiceCode)) })
    assert.equal(norm(after.props), norm(before.props))
    assert.ok(after.calls < before.calls)
  })
}

test('compacted lead rows render the identical table', () => {
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server')
  const { compactRow } = loadTs('lib/query-utils.ts')
  const { default: Table } = loadTs('app/PracticesTable.tsx', {
    'next/link': ({ href, children, prefetch, ...rest }) => React.createElement('a', { href, ...rest }, children),
    'next/navigation': { useRouter: () => ({ refresh() {} }) },
    './actions': { allocatePractices() {}, softDeleteLeads() {} }, './assign-actions': { assignLeadsToAgent() {} }, './leads-page-actions': { queryLeadPage: async () => ({ ok: false, message: 'not used' }) },
  })
  const row = (i) => ({ practiceCode: 'PR-' + i, allocatedOn: i % 2 ? '2026-01-01T00:00:00Z' : null, status: i % 3 ? null : 'Qualified',
    assignedAwayTo: i % 4 ? null : { name: 'Ann', role: 'Agent' }, source: i % 2 ? 'Allocated' : 'Uploaded',
    allocatedTo: i % 2 ? 'Acme' : null, allocatedCompanies: i % 2 ? [{ id: 't', name: 'Acme' }] : [], name: 'Name ' + i,
    state: i % 5 ? 'NY' : null, specialty: null, sex: null, orgName: i % 2 ? 'Org' : null, risk: null, npiFound: i % 2 === 0,
    entityType: null, enumerationDate: null, lastUpdated: null, paymentAdj: i % 3 ? null : 0, lastDialed: null,
    ccm: i % 2 === 0, pcm: false, awv: false, tcm: false, bhi: false, rpm: false, rcmFit: i % 3 === 0, mipsByYear: i % 2 ? { 2026: 'Group' } : {} })
  const full = Array.from({ length: 40 }, (_, i) => row(i))
  const compact = full.map(r => ({ ...compactRow(r), practiceCode: r.practiceCode, name: r.name }))
  for (const props of [{ isSuperAdmin: true }, { canAssign: true, viewerRole: 'manager' }, { viewerRole: 'agent' }]) {
    assert.equal(renderToStaticMarkup(React.createElement(Table, { practices: compact, lazyOptions: true, ...props })),
      renderToStaticMarkup(React.createElement(Table, { practices: full, lazyOptions: true, ...props })))
  }
})

test('company allocation summary counts in the database and matches a full row count', async () => {
  const tenants = [
    { id: 't1', name: 'Acme', is_platform: false, status: 'active' },
    { id: 't2', name: 'Beta', is_platform: false, status: 'active' },
    { id: 't3', name: 'Empty', is_platform: false, status: 'active' },
    { id: 'tp', name: 'Platform', is_platform: true, status: 'active' },
  ]
  const lead_allocations = [
    ...Array.from({ length: 2503 }, (_, i) => ({ practice_id: 'a' + i, tenant_id: 't1', status: 'active' })),
    ...Array.from({ length: 7 }, (_, i) => ({ practice_id: 'b' + i, tenant_id: 't2', status: 'active' })),
    ...Array.from({ length: 40 }, (_, i) => ({ practice_id: 'c' + i, tenant_id: 't2', status: 'released' })),
  ]
  const tables = { tenants, lead_allocations }
  let requests = 0, downloadedRows = 0
  const db = { from(table) {
    requests++
    const filters = []; let head = false
    const run = () => {
      const rows = tables[table].filter(row => filters.every(f => f(row)))
      if (!head) downloadedRows += rows.length
      return head ? { data: null, count: rows.length, error: null } : { data: rows, error: null }
    }
    const q = {
      select(_cols, opts) { head = !!opts?.head; return q },
      eq(k, v) { filters.push(r => r[k] === v); return q },
      order() { return q },
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject) },
    }
    return q
  } }
  const { getCompanyAllocationSummary } = loadTs('app/manage-assignments-actions.ts', {
    '../lib/supabase-server': {
      createSupabaseServer: async () => db,
      getCurrentUser: async () => ({ data: { user: { id: 'u' } } }),
      getCurrentProfile: async () => ({ data: { id: 'me', tenant_id: null, roles: { key: 'super_admin' } } }),
    },
  })
  const result = await getCompanyAllocationSummary()
  assert.equal(result.ok, true)
  assert.deepEqual(result.companies, [
    { id: 't1', name: 'Acme', count: 2503 },
    { id: 't2', name: 'Beta', count: 7 },
    { id: 't3', name: 'Empty', count: 0 },
    { id: 'tp', name: 'Platform', count: 0 },
  ].filter(c => c.id !== 'tp'))
  assert.equal(downloadedRows, 3) // only the tenant list; no allocation rows downloaded
  assert.equal(requests, 4)       // 1 tenant list + 1 count per company
})

test('packed lead rows round-trip exactly and render the identical table', () => {
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server')
  const { compactRow } = loadTs('lib/query-utils.ts')
  const { packRows, unpackRows } = loadTs('lib/lead-pack.ts')
  const { default: Table } = loadTs('app/PracticesTable.tsx', {
    'next/link': ({ href, children, prefetch, ...rest }) => React.createElement('a', { href, ...rest }, children),
    'next/navigation': { useRouter: () => ({ refresh() {} }) },
    './actions': { allocatePractices() {}, softDeleteLeads() {} }, './assign-actions': { assignLeadsToAgent() {} }, './leads-page-actions': { queryLeadPage: async () => ({ ok: false, message: 'not used' }) },
  })
  const row = (i) => ({ practiceCode: 'PR-' + i, allocatedOn: i % 2 ? '2026-01-01T00:00:00Z' : null, status: i % 3 ? null : 'Qualified',
    assignedAwayTo: i % 4 ? null : { name: 'Ann', role: 'Agent' }, source: i % 2 ? 'Allocated' : 'Uploaded',
    allocatedTo: i % 2 ? 'Acme' : null, allocatedCompanies: i % 2 ? [{ id: 't', name: 'Acme' }] : [], name: i === 7 ? null : 'Name ' + i,
    state: i % 5 ? 'NY' : null, specialty: null, sex: null, orgName: i % 2 ? 'Org' : null, risk: null, npiFound: i % 2 === 0,
    entityType: null, enumerationDate: null, lastUpdated: null, paymentAdj: i % 3 ? null : 0, lastDialed: null,
    ccm: i % 2 === 0, pcm: false, awv: false, tcm: false, bhi: false, rpm: false, rcmFit: i % 3 === 0, mipsByYear: i % 2 ? { 2026: 'Group' } : {} })
  const compact = Array.from({ length: 40 }, (_, i) => row(i)).map(r => ({ ...compactRow(r), practiceCode: r.practiceCode, name: r.name }))
  const packed = JSON.parse(JSON.stringify(packRows(compact)))   // exactly what crosses the network
  assert.deepEqual(unpackRows(packed), JSON.parse(JSON.stringify(compact)))
  assert.ok(JSON.stringify(packed).length < JSON.stringify(compact).length)
  for (const props of [{ isSuperAdmin: true }, { canAssign: true, viewerRole: 'manager' }, { viewerRole: 'agent' }]) {
    assert.equal(renderToStaticMarkup(React.createElement(Table, { packedPractices: packed, lazyOptions: true, ...props })),
      renderToStaticMarkup(React.createElement(Table, { practices: compact, lazyOptions: true, ...props })))
  }
})

test('compact database rows decode to the nested lead shape', () => {
  const { decodeFlatLead } = loadTs('lib/lead-pack.ts')
  const lead = decodeFlatLead(['id1', 'PR-1', 'Name', 'NY', null, null, '2026-01-01T00:00:00+00:00', '2026-02-01T00:00:00+00:00',
    ['123', 'Org', 'F', null, 1.5, null, 'NPPES - Found', 'NPI-1', '2020-01-02', [true, false, null, false, false, true, true], [[2026, null, '2026 - Group']]],
    [['2026-03-01T00:00:00+00:00', ['Ann', 'agent']], [null, null]]])
  assert.deepEqual(lead, {
    id: 'id1', practice_code: 'PR-1', name: 'Name', state: 'NY', specialty: null, owner_tenant_id: null, created_at: '2026-01-01T00:00:00+00:00',
    lead_activity: [{ created_at: '2026-02-01T00:00:00+00:00' }],
    practice_providers: [{ providers: { npi: '123', org_name: 'Org', nppes_sex: 'F', nppes_last_updated: null, payment_adj_pct: 1.5, at_risk: null,
      record_source: 'NPPES - Found', entity_type: 'NPI-1', enumeration_date: '2020-01-02',
      provider_signals: { ccm: true, pcm: false, awv: null, tcm: false, bhi: false, rpm: true, rcm_fit: true },
      provider_mips: [{ performance_year: 2026, status: null, reporting_option: '2026 - Group' }] } }],
    assigned_away: [{ assigned_at: '2026-03-01T00:00:00+00:00', users: { full_name: 'Ann', roles: { key: 'agent' } } },
      { assigned_at: null, users: null }],
  })
  const bare = decodeFlatLead(['id2', 'PR-2', 'B', null, null, null, null, null, null, null])
  assert.deepEqual(bare.practice_providers, [])
  assert.deepEqual(bare.lead_activity, [])
  assert.equal('assigned_away' in bare, false)
})

for (const role of Object.keys(expected)) {
  test(`compact lead RPC path matches original queries for ${role}`, async () => {
    const encode = (p, by) => {
      const prov = p.practice_providers?.[0]?.providers
      const s = prov?.provider_signals
      return [p.id, p.practice_code, p.name, p.state ?? null, p.specialty ?? null, p.owner_tenant_id ?? null, p.created_at ?? null,
        p.lead_activity?.[0]?.created_at ?? null,
        prov ? [prov.npi ?? null, prov.org_name ?? null, prov.nppes_sex ?? null, prov.nppes_last_updated ?? null, prov.payment_adj_pct ?? null,
          prov.at_risk ?? null, prov.record_source ?? null, prov.entity_type ?? null, prov.enumeration_date ?? null,
          s ? [s.ccm ?? null, s.pcm ?? null, s.awv ?? null, s.tcm ?? null, s.bhi ?? null, s.rpm ?? null, s.rcm_fit ?? null] : null,
          (prov.provider_mips ?? []).map(m => [m.performance_year ?? null, m.status ?? null, m.reporting_option ?? null])] : null,
        by ? (p.assigned_away ?? []).map(a => [a.assigned_at ?? null, a.users ? [a.users.full_name ?? null, a.users.roles?.key ?? null] : null]) : null]
    }
    const run = async (compact) => {
      const { me, tables } = homeFixture(role), calls = []
      let db = database(tables, calls)
      if (compact) {
        db = withLeadRpcs(db, tables)
        const nested = db.rpc
        db.rpc = (name, a) => name === 'crm_lead_rows_flat'
          ? nested('crm_lead_rows', a).then(({ data }) => ({ data: data.map(p => encode(p, a.p_assigned_by)), error: null }))
          : nested(name, a)
      }
      const { default: Home } = loadTs('app/page.tsx', {
        '../lib/supabase-server': { createSupabaseServer: async () => db,
          getCurrentUser: async () => ({ data: { user: { id: 'auth-me' } } }),
          getCurrentProfile: async () => ({ data: me }) },
        './PracticesTable': 'PracticesTable', './UploadLeadsButton': 'UploadLeadsButton', './AppShell': 'AppShell',
        'next/navigation': { redirect: () => { throw Error('unexpected redirect') } } })
      return withPractices((await Home()).props.children.props)
    }
    const norm = x => JSON.stringify({ ...x, practices: [...x.practices].sort((p, q) => p.practiceCode.localeCompare(q.practiceCode)) })
    try {
      process.env.CRM_COMPACT_LEAD_RPC = '0'
      const original = norm(await run(false))
      delete process.env.CRM_COMPACT_LEAD_RPC          // default: compact path on
      assert.equal(norm(await run(true)), original)
    } finally {
      process.env.CRM_COMPACT_LEAD_RPC = '0'
    }
  })
}

test('compact lead function is used by default and skipped when switched off', async () => {
  const { me, tables } = homeFixture('super_admin'), calls = []
  const db = database(tables, calls)
  const { default: Home } = loadTs('app/page.tsx', {
    '../lib/supabase-server': { createSupabaseServer: async () => db,
      getCurrentUser: async () => ({ data: { user: { id: 'auth-me' } } }),
      getCurrentProfile: async () => ({ data: me }) },
    './PracticesTable': 'PracticesTable', './UploadLeadsButton': 'UploadLeadsButton', './AppShell': 'AppShell',
    'next/navigation': { redirect: () => { throw Error('unexpected redirect') } } })
  try {
    delete process.env.CRM_COMPACT_LEAD_RPC
    await Home()
    let rpcNames = calls.filter(c => c.operation === 'rpc').map(c => c.table)
    assert.equal(rpcNames[0], 'rpc:crm_lead_rows_flat')       // tried first by default
    assert.equal(rpcNames.includes('rpc:crm_lead_rows'), true) // safe fallback (mock has no flat function)
    calls.length = 0
    process.env.CRM_COMPACT_LEAD_RPC = '0'
    await Home()
    rpcNames = calls.filter(c => c.operation === 'rpc').map(c => c.table)
    assert.equal(rpcNames.includes('rpc:crm_lead_rows_flat'), false)
  } finally {
    process.env.CRM_COMPACT_LEAD_RPC = '0'
  }
})

// ---------------------------------------------------------------------------
// Server-paged Leads page: must give exactly the same results as the original
// browser-side filtering. The reference below is a verbatim copy of the
// original PracticesTable filter/sort and summary code.
// ---------------------------------------------------------------------------
function referenceFilter(practices, f, { isSuperAdmin, prioritySet, newLeadSet, workedLeadSet }) {
  const ZONE_BY_STATE = { CT: 'EST', DE: 'EST', FL: 'EST', GA: 'EST', ME: 'EST', MD: 'EST', MA: 'EST', NH: 'EST',
    NJ: 'EST', NY: 'EST', NC: 'EST', OH: 'EST', PA: 'EST', RI: 'EST', SC: 'EST', VT: 'EST', VA: 'EST', WV: 'EST', DC: 'EST', MI: 'EST', IN: 'EST', KY: 'EST',
    AL: 'CST', AR: 'CST', IL: 'CST', IA: 'CST', KS: 'CST', LA: 'CST', MN: 'CST', MS: 'CST', MO: 'CST', NE: 'CST', ND: 'CST', OK: 'CST', SD: 'CST', TN: 'CST', TX: 'CST', WI: 'CST',
    AZ: 'MST', CO: 'MST', ID: 'MST', MT: 'MST', NM: 'MST', UT: 'MST', WY: 'MST', CA: 'PST', NV: 'PST', OR: 'PST', WA: 'PST', AK: 'Other', HI: 'Other' }
  const isWithinDateRange = (value, from, to) => { if (!from && !to) return true; if (!value) return false; const date = value.trim().slice(0, 10); return (!from || date >= from) && (!to || date <= to) }
  const toLocalCalendarDate = (value) => { if (!value) return ''; const date = new Date(value); if (Number.isNaN(date.getTime())) return ''
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
  const hasRealMips = (p) => { const v = (p.mipsByYear?.[2026] ?? '').toString().trim().toLowerCase(); if (!v) return false
    if (v.includes('individual')) return true; if (v.includes('group')) return true; if (v.includes('apm')) return true; return false }
  const SIGNALS = [['ccm', p => !!p.ccm], ['pcm', p => !!p.pcm], ['awv', p => !!p.awv], ['tcm', p => !!p.tcm], ['bhi', p => !!p.bhi],
    ['rpm', p => !!p.rpm], ['rcmFit', p => !!p.rcmFit], ['mips', p => hasRealMips(p)]].map(([key, test]) => ({ key, test }))
  const { search, stateFilter, zoneFilter, specialtyFilter, dispositionFilter, catTab, sourceTab, poolTab, assignedView, companyFilter,
    enumTypeFilter, lastUpdatedFrom, lastUpdatedTo, enumDateFrom, enumDateTo, assignedDateFilter } = f
  const activeSignals = new Set(f.activeSignals), hasPriority = prioritySet.size > 0
  const rows = practices.filter((p) => {
    if (isSuperAdmin) {
      if (companyFilter === '__unassigned__' && (p.allocatedCompanies?.length ?? 0) > 0) return false
      if (companyFilter && companyFilter !== '__unassigned__' && !p.allocatedCompanies?.some(company => company.id === companyFilter)) return false
    }
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.practiceCode.toLowerCase().includes(search.toLowerCase())) return false
    if (stateFilter && p.state !== stateFilter) return false
    if (zoneFilter) { const practiceZone = p.state ? (ZONE_BY_STATE[p.state] ?? 'Other') : 'Other'; if (practiceZone !== zoneFilter) return false }
    if (specialtyFilter && p.specialty !== specialtyFilter) return false
    if (catTab === 'MIPS' && !hasRealMips(p)) return false
    if (catTab === 'RCM' && !p.rcmFit) return false
    if (catTab === 'CCM' && !p.ccm) return false
    if (catTab === 'Credentialing' && !p.npiFound) return false
    if (catTab === 'Credentialing') {
      if (enumTypeFilter && (p.entityType ?? '') !== enumTypeFilter) return false
      if (!isWithinDateRange(p.lastUpdated, lastUpdatedFrom, lastUpdatedTo)) return false
      if (!isWithinDateRange(p.enumerationDate, enumDateFrom, enumDateTo)) return false
    }
    if (dispositionFilter && p.status !== dispositionFilter) return false
    for (const key of activeSignals) { const sig = SIGNALS.find((s) => s.key === key); if (sig && !sig.test(p)) return false }
    if (sourceTab !== 'All') { const src = (p.source ?? '').toLowerCase(); const isAllocated = src.includes('alloc')
      if (sourceTab === 'Allocated' && !isAllocated) return false; if (sourceTab === 'Uploaded' && isAllocated) return false }
    if (poolTab === 'New Leads' && !newLeadSet.has(p.practiceCode)) return false
    if (poolTab === 'Worked Leads' && !workedLeadSet.has(p.practiceCode)) return false
    if (assignedView === 'mine' && !prioritySet.has(p.practiceCode)) return false
    if (assignedDateFilter && toLocalCalendarDate(p.allocatedOn) !== assignedDateFilter) return false
    return true
  })
  if (hasPriority && assignedView === 'all') {
    rows.sort((a, b) => { const pa = prioritySet.has(a.practiceCode) ? 0 : 1, pb = prioritySet.has(b.practiceCode) ? 0 : 1
      if (pa !== pb) return pa - pb; return a.name.localeCompare(b.name) })
  }
  return rows
}

function randomLeads(count, seed = 7) {
  let x = seed; const rnd = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
  return Array.from({ length: count }, (_, i) => ({
    practiceCode: 'PR-' + (1000 + i), name: pick(['Alpha Care', 'beta clinic', 'Gamma Health', 'Délta Med', 'alpha care', 'Zeta']) + ' ' + (i % 13),
    state: pick(['NY', 'TX', 'CA', 'AK', 'ZZ', null]), specialty: pick(['Cardiology', 'Family', null]),
    ccm: rnd() < .5, pcm: rnd() < .3, awv: rnd() < .2, tcm: rnd() < .2, bhi: rnd() < .2, rpm: rnd() < .2, rcmFit: rnd() < .4,
    npiFound: rnd() < .5, entityType: pick(['NPI-1', 'NPI-2', null]), enumerationDate: pick(['2015-03-04', '2020-12-31', null]),
    lastUpdated: pick(['2024-01-10', '2025-06-30', null]), mipsByYear: pick([{ 2026: 'Group' }, { 2026: 'Excluded' }, { 2025: 'Individual' }, {}]),
    allocatedOn: pick(['2026-09-14T22:30:00Z', '2026-09-15T02:00:00Z', '2026-09-15T19:30:00+00:00', null, 'bad-date']),
    status: pick(['Qualified', 'Follow Up', 'Call back later', 'Transferred', null]), source: pick(['Allocated', 'Uploaded']),
    allocatedCompanies: pick([[], [{ id: 't1', name: 'Acme' }], [{ id: 't2', name: 'Beta' }, { id: 't1', name: 'Acme' }]]),
    assignedAwayTo: rnd() < .2 ? { name: 'Ann', role: 'Agent' } : null,
  }))
}
function randomFilters(rnd, pick) {
  const maybe = (v, p = .3) => (rnd() < p ? v : undefined)
  return {
    search: maybe(pick(['alpha', 'PR-10', 'é', 'zzz', 'CARE'])) ?? '', stateFilter: maybe(pick(['NY', 'TX', 'ZZ'])) ?? '',
    zoneFilter: maybe(pick(['EST', 'CST', 'PST', 'Other'])) ?? '', specialtyFilter: maybe(pick(['Cardiology', 'Family'])) ?? '',
    dispositionFilter: maybe(pick(['Qualified', 'Follow Up'])) ?? '', activeSignals: rnd() < .4 ? ['ccm', 'mips', 'rcmFit', 'pcm'].filter(() => rnd() < .4) : [],
    catTab: pick(['All Categories', 'All Categories', 'MIPS', 'RCM', 'CCM', 'Credentialing']), sourceTab: pick(['All', 'All', 'Allocated', 'Uploaded']),
    poolTab: pick(['All Leads', 'All Leads', 'New Leads', 'Worked Leads']), assignedView: pick(['all', 'all', 'mine']),
    companyFilter: maybe(pick(['__unassigned__', 't1', 't2'])) ?? '', enumTypeFilter: maybe(pick(['NPI-1', 'NPI-2'])) ?? '',
    lastUpdatedFrom: maybe('2024-06-01') ?? '', lastUpdatedTo: maybe('2025-12-31') ?? '', enumDateFrom: maybe('2016-01-01') ?? '', enumDateTo: maybe('2021-01-01') ?? '',
    assignedDateFilter: maybe(pick(['2026-09-14', '2026-09-15', '2026-09-16'])) ?? '',
  }
}

test('shared lead filter matches the original browser filter for 3,000 random filter combinations', () => {
  const lf = loadTs('lib/lead-filters.ts')
  const leads = randomLeads(400)
  let x = 99; const rnd = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
  for (let i = 0; i < 3000; i++) {
    const ctx = { isSuperAdmin: rnd() < .5, prioritySet: new Set(rnd() < .5 ? leads.filter(() => rnd() < .2).map(l => l.practiceCode) : []),
      newLeadSet: new Set(leads.filter(() => rnd() < .3).map(l => l.practiceCode)), workedLeadSet: new Set(leads.filter(() => rnd() < .3).map(l => l.practiceCode)) }
    const f = randomFilters(rnd, pick)
    const expected = referenceFilter(leads, f, ctx).map(p => p.practiceCode)
    assert.deepEqual(lf.filterLeads(leads, lf.sanitizeLeadFilters(f), ctx).map(p => p.practiceCode), expected, JSON.stringify(f))
  }
})

test('shared lead overview matches the original summary and dropdown logic', () => {
  const { leadOverview } = loadTs('lib/lead-filters.ts')
  const leads = randomLeads(300, 3)
  for (const isSuperAdmin of [true, false]) for (const completedWorksheetCount of [undefined, 5]) {
    const newLeadSet = new Set(leads.slice(0, 40).map(l => l.practiceCode)), workedLeadSet = new Set(leads.slice(20, 90).map(l => l.practiceCode).concat(['GONE']))
    const o = leadOverview(leads, { isSuperAdmin, newLeadSet, workedLeadSet, completedWorksheetCount })
    assert.deepEqual(o.states, Array.from(new Set(leads.map(p => p.state).filter(Boolean))).sort())
    assert.deepEqual(o.specialties, Array.from(new Set(leads.map(p => p.specialty).filter(Boolean))).sort())
    assert.deepEqual(o.dispositions, Array.from(new Set(leads.map(p => p.status).filter(Boolean))).sort())
    assert.equal(o.summaryCounts.total, leads.length)
    assert.equal(o.summaryCounts.unassigned, leads.filter(p => isSuperAdmin ? (p.allocatedCompanies?.length ?? 0) === 0 : !p.assignedAwayTo).length)
    assert.equal(o.summaryCounts.worked, completedWorksheetCount ?? leads.filter(p => workedLeadSet.has(p.practiceCode)).length)
    assert.equal(o.summaryCounts.followUp, leads.filter(p => { const s = (p.status ?? '').toLowerCase(); return s.includes('follow') || s.includes('call back') || s.includes('callback') }).length)
    assert.equal(o.newCount, newLeadSet.size); assert.equal(o.workedCount, workedLeadSet.size)
    assert.equal(Object.values(o.zoneCounts).reduce((a, b) => a + b, 0), leads.length)
  }
})

test('"Assigned on" date uses the browser time zone on the server', () => {
  const { calendarDateIn, toLocalCalendarDate } = loadTs('lib/lead-filters.ts')
  const saved = process.env.TZ
  try {
    for (const tz of ['Asia/Karachi', 'America/New_York', 'UTC', 'Pacific/Kiritimati']) {
      process.env.TZ = tz
      for (const value of ['2026-09-14T22:30:00Z', '2026-09-15T19:30:00+00:00', '2026-03-08T07:30:00Z', null, '', 'bad-date'])
        assert.equal(calendarDateIn(tz)(value), toLocalCalendarDate(value), `${tz} ${value}`)
    }
    assert.equal(calendarDateIn('Not/AZone')('2026-09-14T22:30:00Z'), toLocalCalendarDate('2026-09-14T22:30:00Z'))
  } finally {
    if (saved === undefined) delete process.env.TZ; else process.env.TZ = saved
  }
})

for (const role of Object.keys(expected)) {
  test(`server-paged Leads page returns the same leads, pages and counts as before for ${role}`, async () => {
    const lf = loadTs('lib/lead-filters.ts')
    const render = async (paged) => {
      process.env.CRM_SERVER_PAGED_LEADS = paged ? '1' : '0'
      const { me, tables } = homeFixture(role)
      const snapshots = loadTs('lib/lead-snapshots.ts')
      const { default: Home } = loadTs('app/page.tsx', {
        '../lib/supabase-server': { createSupabaseServer: async () => database(tables, []),
          getCurrentUser: async () => ({ data: { user: { id: 'auth-me' } } }),
          getCurrentProfile: async () => ({ data: me }) },
        './PracticesTable': 'PracticesTable', './UploadLeadsButton': 'UploadLeadsButton', './AppShell': 'AppShell',
        'next/navigation': { redirect: () => { throw Error('unexpected redirect') } } })
      return { props: (await Home()).props.children.props, snapshots }
    }
    try {
      const legacy = withPractices((await render(false)).props)
      const { props, snapshots } = await render(true)
      assert.equal(props.practices, undefined); assert.equal(props.packedPractices, undefined)
      const ctx = { isSuperAdmin: legacy.isSuperAdmin, prioritySet: new Set(legacy.myAssignedCodes ?? []),
        newLeadSet: new Set(legacy.newLeadCodes ?? []), workedLeadSet: new Set(legacy.workedLeadCodes ?? []) }
      // Same counts and dropdowns as the browser computed from the full list.
      assert.deepEqual(props.serverPaging.overview, lf.leadOverview(legacy.practices, { ...ctx, completedWorksheetCount: legacy.completedWorksheetCount }))
      const snap = snapshots.getLeadSnapshot(props.serverPaging.snapshotId, 'auth-me')
      assert.ok(snap)
      assert.equal(snapshots.getLeadSnapshot(props.serverPaging.snapshotId, 'someone-else'), null)
      let x = 5; const rnd = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648
      const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
      for (let i = 0; i < 60; i++) {
        const f = lf.sanitizeLeadFilters(i === 0 ? {} : randomFilters(rnd, pick))
        const want = lf.filterLeads(legacy.practices, f, ctx)
        const pageSize = pick([1, 2, 8, 20])
        const first = snapshots.queryLeadSnapshot(snap, f, null, 1, pageSize, true)
        assert.deepEqual(first.codes, want.map(p => p.practiceCode))
        const pages = []
        for (let pg = 1; pg <= Math.max(1, Math.ceil(want.length / pageSize)); pg++)
          pages.push(...snapshots.queryLeadSnapshot(snap, f, null, pg, pageSize, false).rows)
        assert.deepEqual(JSON.parse(JSON.stringify(pages)), JSON.parse(JSON.stringify(want)))
      }
      assert.deepEqual(props.serverPaging.codes, lf.filterLeads(legacy.practices, lf.DEFAULT_LEAD_FILTERS, ctx).map(p => p.practiceCode))
    } finally {
      process.env.CRM_SERVER_PAGED_LEADS = '0'
    }
  })
}

test('server-paged table renders the identical first screen', () => {
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server')
  const lf = loadTs('lib/lead-filters.ts')
  const { default: Table } = loadTs('app/PracticesTable.tsx', {
    'next/link': ({ href, children, prefetch, ...rest }) => React.createElement('a', { href, ...rest }, children),
    'next/navigation': { useRouter: () => ({ refresh() {} }) },
    './actions': { allocatePractices() {}, softDeleteLeads() {} }, './assign-actions': { assignLeadsToAgent() {} },
    './leads-page-actions': { queryLeadPage: async () => assert.fail('first screen must not need a request') },
  })
  const leads = randomLeads(57, 11)
  for (const [props, pageSize] of [[{ isSuperAdmin: true }, 20], [{ canAssign: true, viewerRole: 'manager', myAssignedCodes: ['PR-1003', 'PR-1040'] }, 8], [{ viewerRole: 'agent', completedWorksheetCount: 2 }, 8]]) {
    const newLeadCodes = leads.slice(0, 5).map(l => l.practiceCode), workedLeadCodes = leads.slice(3, 12).map(l => l.practiceCode)
    const ctx = { isSuperAdmin: !!props.isSuperAdmin, prioritySet: new Set(props.myAssignedCodes ?? []), newLeadSet: new Set(newLeadCodes), workedLeadSet: new Set(workedLeadCodes) }
    const all = lf.filterLeads(leads, lf.DEFAULT_LEAD_FILTERS, ctx)
    const serverPaging = { snapshotId: 's1', overview: lf.leadOverview(leads, { ...ctx, completedWorksheetCount: props.completedWorksheetCount }),
      rows: all.slice(0, pageSize), codes: all.map(p => p.practiceCode), pageSize }
    const legacy = renderToStaticMarkup(React.createElement(Table, { practices: leads, newLeadCodes, workedLeadCodes, lazyOptions: true, ...props }))
    const paged = renderToStaticMarkup(React.createElement(Table, { serverPaging, lazyOptions: true, ...props }))
    assert.equal(paged, legacy)
  }
})

test('lead page action: signed-in check, per-user snapshots, rebuild when missing', async () => {
  process.env.CRM_SERVER_PAGED_LEADS = '1'
  try {
    const { me, tables } = homeFixture('super_admin')
    let authUser = { id: 'auth-me' }, loads = 0
    const supabaseServer = {
      createSupabaseServer: async () => { loads++; return database(tables, []) },
      getCurrentUser: async () => ({ data: { user: authUser } }),
      getCurrentProfile: async () => ({ data: me }),
    }
    const mocks = { '../lib/supabase-server': supabaseServer, 'next/navigation': { redirect: () => { throw Error('redirect') } } }
    const snapshots = loadTs('lib/lead-snapshots.ts', mocks)
    const { queryLeadPage } = loadTs('app/leads-page-actions.ts', { ...mocks, '../lib/lead-snapshots': snapshots })
    const lf = loadTs('lib/lead-filters.ts')
    const { loadLeadsData } = loadTs('lib/leads-data.ts', mocks)

    // Signed out: nothing returned.
    authUser = null
    const out = await queryLeadPage({ snapshotId: 'x', filters: {}, page: 1, pageSize: 20, wantCodes: true })
    assert.equal(out.ok, false); assert.equal(loads, 0)

    // Missing snapshot: rebuilt for the signed-in user, with codes + overview.
    authUser = { id: 'auth-me' }
    const first = await queryLeadPage({ snapshotId: 'does-not-exist', filters: {}, page: 1, pageSize: 2, wantCodes: false })
    assert.equal(first.ok, true); assert.ok(first.overview); assert.ok(Array.isArray(first.codes)); assert.equal(loads, 1)
    const data = await loadLeadsData()
    const ctx = { isSuperAdmin: true, prioritySet: new Set(data.myAssignedCodes), newLeadSet: new Set(data.newLeadCodes), workedLeadSet: new Set(data.workedLeadCodes) }
    assert.deepEqual(first.codes, lf.filterLeads(data.practices, lf.DEFAULT_LEAD_FILTERS, ctx).map(p => p.practiceCode))

    // Existing snapshot: reused, no database work.
    loads = 0
    const again = await queryLeadPage({ snapshotId: first.snapshotId, filters: { search: 'p' }, page: 1, pageSize: 2, wantCodes: true })
    assert.equal(again.ok, true); assert.equal(again.snapshotId, first.snapshotId); assert.equal(again.overview, undefined); assert.equal(loads, 0)

    // Another user cannot read that snapshot: they get their own, rebuilt.
    authUser = { id: 'someone-else' }
    const other = await queryLeadPage({ snapshotId: first.snapshotId, filters: {}, page: 1, pageSize: 2, wantCodes: false })
    assert.equal(other.ok, true)
    assert.notEqual(other.snapshotId, first.snapshotId)   // never the first user's snapshot
    assert.ok(other.overview)                              // rebuilt with their own sign-in
    assert.equal(snapshots.getLeadSnapshot(other.snapshotId, 'auth-me'), null)
    assert.equal(snapshots.getLeadSnapshot(first.snapshotId, 'someone-else'), null)

    // Bad input is cleaned up rather than trusted.
    authUser = { id: 'auth-me' }
    const odd = await queryLeadPage({ snapshotId: first.snapshotId, filters: { zoneFilter: 'DROP', activeSignals: ['nope', 'ccm'], sourceTab: 1 }, page: -5, pageSize: 99999, wantCodes: true })
    assert.equal(odd.ok, true); assert.equal(odd.page, 1); assert.equal(odd.pageSize, 200)
  } finally {
    process.env.CRM_SERVER_PAGED_LEADS = '0'
  }
})

test('lead snapshots stay bounded: newest 3 per user', () => {
  const snapshots = loadTs('lib/lead-snapshots.ts')
  const data = { isSuperAdmin: false, myAssignedCodes: [], newLeadCodes: [], workedLeadCodes: [], practices: [], completedWorksheetCount: undefined }
  const ids = Array.from({ length: 5 }, () => snapshots.saveLeadSnapshot('bounded-user', data).id)
  assert.equal(ids.filter(id => snapshots.getLeadSnapshot(id, 'bounded-user')).length, 3)
  assert.ok(snapshots.getLeadSnapshot(ids[4], 'bounded-user'))
  assert.equal(snapshots.getLeadSnapshot(ids[0], 'bounded-user'), null)
})

// ---------------------------------------------------------------------------
// Company Admin: remove a team member (soft delete).
// ---------------------------------------------------------------------------
function removeUserHarness({ meRole = 'company_admin', meLevel = 2, target, banError = null, releaseError = null, released = [{ practice_id: 'p1' }, { practice_id: 'p2' }] } = {}) {
  const log = []
  const table = (name) => {
    const q = { op: 'select', filters: {}, values: null }
    const api = {
      select(cols) { if (q.op === 'select') q.cols = cols; else q.returning = cols; return api },
      update(v) { q.op = 'update'; q.values = v; return api },
      delete() { q.op = 'delete'; return api },
      eq(k, v) { q.filters[k] = v; return api },
      maybeSingle() { log.push({ table: name, ...q }); return Promise.resolve({ data: target, error: null }) },
      then(res, rej) {
        log.push({ table: name, ...q })
        const out = name === 'lead_assignments' && q.op === 'delete'
          ? { data: releaseError ? null : released, error: releaseError } : { data: null, error: null }
        return Promise.resolve(out).then(res, rej)
      },
    }
    return api
  }
  const bans = []
  const admin = { from: table, auth: { admin: { updateUserById: async (id, attrs) => { bans.push({ id, attrs }); return { error: banError } } } } }
  const { removeCompanyUser } = loadTs('app/admin-manage-actions.ts', {
    '../lib/supabase-server': {
      createSupabaseServer: async () => ({}),
      getCurrentUser: async () => ({ data: { user: { id: 'auth-me' } } }),
      getCurrentProfile: async () => ({ data: { id: 'me', tenant_id: 'T1', roles: { key: meRole, level: meLevel } } }),
    },
    '../lib/supabase-admin': { createSupabaseAdmin: () => admin },
  })
  return { removeCompanyUser, log, bans }
}
const agent = (over = {}) => ({ id: 'u9', auth_id: 'auth-u9', tenant_id: 'T1', status: 'active', full_name: 'Acme Agent', roles: { key: 'agent', level: 5 }, ...over })

test('remove user: company admin removes an agent safely', async () => {
  const h = removeUserHarness({ target: agent() })
  const res = await h.removeCompanyUser('u9')
  assert.equal(res.ok, true)
  assert.match(res.message, /Acme Agent was removed.*2 assigned leads returned to the pool/)
  const writes = h.log.filter(e => e.op !== 'select')
  assert.deepEqual(writes.map(w => [w.table, w.op]), [['users', 'update'], ['lead_assignments', 'delete']])
  assert.deepEqual(writes[0].values, { status: 'suspended' })
  assert.deepEqual(writes[0].filters, { id: 'u9', tenant_id: 'T1', status: 'active' })
  assert.deepEqual(writes[1].filters, { assigned_to: 'u9', tenant_id: 'T1', status: 'active' })   // only their ACTIVE leads, only in my company
  assert.deepEqual(h.bans, [{ id: 'auth-u9', attrs: { ban_duration: '876000h' } }])
  // History tables are never touched.
  assert.equal(h.log.some(e => ['lead_worksheets', 'lead_activity', 'sales', 'lead_transfers'].includes(e.table)), false)
})

for (const [label, opts, id, pattern] of [
  ['manager cannot remove (company admin only)', { meRole: 'manager', meLevel: 3, target: agent() }, 'u9', /Only a Company Admin/],
  ['cannot remove yourself', { target: agent({ id: 'me' }) }, 'me', /your own account/],
  ['cannot remove another company\'s user', { target: agent({ tenant_id: 'OTHER' }) }, 'u9', /own company/],
  ['cannot remove a super admin', { target: agent({ roles: { key: 'super_admin', level: 1 } }) }, 'u9', /own company/],
  ['cannot remove an equal role (another company admin)', { target: agent({ roles: { key: 'company_admin', level: 2 } }) }, 'u9', /more junior role/],
  ['cannot remove an already removed user', { target: agent({ status: 'suspended' }) }, 'u9', /already been removed/],
  ['unknown user', { target: null }, 'u9', /own company/],
]) {
  test(`remove user: ${label}`, async () => {
    const h = removeUserHarness(opts)
    const res = await h.removeCompanyUser(id)
    assert.equal(res.ok, false); assert.match(res.message, pattern)
    assert.equal(h.log.some(e => e.op !== 'select'), false)   // nothing written
    assert.equal(h.bans.length, 0)
  })
}

test('remove user: if login cannot be revoked, the profile is restored and no leads are released', async () => {
  const h = removeUserHarness({ target: agent(), banError: { message: 'auth down' } })
  const res = await h.removeCompanyUser('u9')
  assert.equal(res.ok, false); assert.match(res.message, /nothing was changed/)
  const writes = h.log.filter(e => e.op !== 'select')
  assert.deepEqual(writes.map(w => [w.table, w.op, w.values]), [['users', 'update', { status: 'suspended' }], ['users', 'update', { status: 'active' }]])
})

test('remove user: if releasing leads fails, the user is still removed and the admin is told', async () => {
  const h = removeUserHarness({ target: agent(), releaseError: { message: 'timeout' } })
  const res = await h.removeCompanyUser('u9')
  assert.equal(res.ok, true); assert.match(res.message, /could not be released.*Manage Assignments/)
})

test('removed teammates are hidden from "Assign to…" and cannot be assigned leads', async () => {
  const people = [
    { id: 'a1', full_name: 'Active Agent', tenant_id: 'T1', status: 'active', roles: { key: 'agent', level: 5 } },
    { id: 'a2', full_name: 'Removed Agent', tenant_id: 'T1', status: 'suspended', roles: { key: 'agent', level: 5 } },
  ]
  const me = { id: 'me', tenant_id: 'T1', roles: { key: 'company_admin', level: 2 } }
  const server = (tables) => ({ createSupabaseServer: async () => database(tables, []),
    getCurrentUser: async () => ({ data: { user: { id: 'auth-me' } } }), getCurrentProfile: async () => ({ data: me }) })
  const { GET } = loadTs('app/api/lead-options/route.ts', { '../../../lib/supabase-server': server({ users: people }) })
  const body = await (await GET()).json()
  assert.deepEqual(body.agents.map(a => a.full_name), ['Active Agent'])
  const { assignLeadsToAgent } = loadTs('app/assign-actions.ts', { '../lib/supabase-server': server({ users: people, master_practices: [] }) })
  const res = await assignLeadsToAgent(['PR-1'], 'a2')
  assert.equal(res.ok, false); assert.match(res.message, /removed from your team/)
})
