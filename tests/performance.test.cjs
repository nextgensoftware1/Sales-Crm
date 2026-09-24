/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS test harness loads transpiled server modules with explicit mocks. */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
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
})

function database(tables, calls, failures = {}) {
  return { from(table) {
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
  } }
}

const expected = {
  super_admin: ['PR-p1', 'PR-p2', 'PR-p3', 'PR-p5', 'PR-p6'],
  company_admin: ['PR-p1', 'PR-p5', 'PR-p6', 'PR-p2'],
  manager: ['PR-p1', 'PR-p6'], team_lead: ['PR-p1', 'PR-p6'], agent: ['PR-p1', 'PR-p5'], closer: ['PR-p1', 'PR-p2', 'PR-p5'],
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
    const view = await Home(), props = view.props.children.props
    assert.equal(props.viewerRole, role)
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
test('one worksheet request logs one activity with one auth verification', async () => {
  const run = loadWorksheet()
  assert.equal((await run.save('PR-p1', worksheet)).ok, true)
  assert.equal(run.authCalls(), 1)
  assert.equal(run.calls.filter((c) => c.table === 'lead_activity' && c.operation === 'insert').length, 1)
  assert.equal(run.calls.find((c) => c.table === 'lead_activity').payload.agent_id, 'me')
  assert.equal(run.calls.filter((c) => c.table === 'lead_reminders').length, 0)
})
test('worksheet transfer lock and signed-out rejection still prevent writes', async () => {
  for (const options of [{ recipient: 'someone-else' }, { signedIn: false }]) {
    const run = loadWorksheet(options)
    assert.equal((await run.save('PR-p1', worksheet)).ok, false)
    assert.equal(run.calls.filter((c) => c.operation !== 'select').length, 0)
  }
})
test('New disposition does not create activity; callback is created once', async () => {
  const run = loadWorksheet()
  await run.save('PR-p1', { ...worksheet, disposition: 'New', callbackAt: '2026-09-22T12:00:00Z' })
  assert.equal(run.calls.filter((c) => c.table === 'lead_activity').length, 0)
  assert.equal(run.calls.filter((c) => c.table === 'lead_reminders').length, 1)
})
test('activity failure is reported and does not write a misleading assignment status', async () => {
  const run = loadWorksheet({ failures: { 'lead_activity:insert': { message: 'unavailable' } } })
  const result = await run.save('PR-p1', worksheet)
  assert.match(result.message, /activity log could not be saved/)
  assert.equal(run.calls.filter((c) => c.table === 'lead_assignments' && c.operation === 'update').length, 0)
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
      remind_at: '2026-09-22T10:00:00Z', done: false, note: 'Call back', master_practices: practice,
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
    assert.deepEqual(calls.map(c=>c.table), ['lead_reminders'])
  })
}

test('roster gets editor names without a separate users query', async () => {
  const calls = []
  const db = database({ master_practices: [
    {practice_code:'PR-1',users:{full_name:'Editor'}}, {practice_code:'PR-2',users:null},
  ] }, calls)
  db.rpc = async () => ({ data: [
    {npi:'1',org_pac_id:'org',org_name:'Organization',is_clicked:true},
    {npi:'2',org_pac_id:'org',org_name:'Organization',is_clicked:false},
  ], error: null })
  const {getOrgRoster} = loadTs('app/roster-actions.ts', {'../lib/supabase-server':{createSupabaseServer:async()=>db}})
  const result = await getOrgRoster('1')
  assert.equal(result.hasOrg,true)
  assert.equal(result.members[0].workedBy,'Editor')
  assert.equal(result.members[1].workedBy,null)
  assert.deepEqual(calls.map(c=>c.table),['master_practices'])
})

for (const [role, expectedCodes] of Object.entries(expected)) {
  test(`practice counter uses the ${role} lead scope`, async () => {
    const {tables} = homeFixture(role)
    const {getPracticeNavigation} = loadTs('lib/practice-navigation.ts')
    const codes = await getPracticeNavigation(database(tables, []), {role, userId:'me', tenantId:'a'})
    assert.deepEqual([...codes].sort(), [...expectedCodes].sort())
  })
}
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
    const db=database({users:[{id:'junior',tenant_id:'a',full_name:'Junior',roles:{key:'agent',level:4}},{id:'outsider',tenant_id:'b',roles:{key:'agent',level:4}}],tenants:[{slug:'a',name:'A',is_platform:false}]},calls)
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


function deletionFixture({ role = 'super_admin', platform = false, authFailure = null, profileFailure = null, tenantFailure = null, memberRole = 'agent', size = 1, shared = false } = {}) {
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
        order() { return query }, range(from, to) { range = [from, to]; return query },
        limit(n) { max = n; return query }, overrideTypes() { return query },
        maybeSingle() { single = true; return query }, delete() { operation = 'delete'; return query },
        then(resolve, reject) {
          let rows = (table === 'users' ? members : [{ id: 'target', is_platform: platform }]).filter(row => filters.every(fn => fn(row)))
          let error = null
          if (operation === 'delete') {
            calls.push(`delete:${table}`)
            error = table === 'users' ? profileFailure : tenantFailure
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
  assert.deepEqual(run.calls, ['auth:login-0', 'delete:users', 'delete:tenants'])
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
  assert.deepEqual(run.calls, ['auth:login-0'])
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
test('company deletion loads team members beyond the API row limit', async () => {
  const run = deletionFixture({ size: 1001 })
  assert.equal((await run.run()).ok, true)
  assert.equal(run.calls.filter(call => call.startsWith('auth:')).length, 1001)
  assert.equal(run.calls.at(-1), 'delete:tenants')
})
