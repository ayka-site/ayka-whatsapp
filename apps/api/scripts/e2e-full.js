require('dotenv').config();
const API = 'http://localhost:3000';
const DASH = 'http://localhost:3001';
const SA_EMAIL = process.env.E2E_SUPERADMIN_EMAIL || 'superadmin@ayka.in';
const SA_PASSWORD = process.env.E2E_SUPERADMIN_PASSWORD || '';
const RESELLER_EMAIL = process.env.E2E_RESELLER_EMAIL || 'admin@welltechup.com';
const RESELLER_PASSWORD = process.env.E2E_RESELLER_PASSWORD || '';
const CLIENT_EMAIL = process.env.E2E_CLIENT_EMAIL || 'admin@santpathik.in';
const CLIENT_PASSWORD = process.env.E2E_CLIENT_PASSWORD || '';

async function j(url, opts) {
  const r = await fetch(url, opts);
  const t = await r.text();
  try { return JSON.parse(t); }
  catch (e) { return { __html: true, status: r.status, body: t.slice(0, 80) }; }
}

async function test() {
  if (!SA_PASSWORD || !RESELLER_PASSWORD || !CLIENT_PASSWORD) {
    throw new Error('Set E2E_SUPERADMIN_PASSWORD, E2E_RESELLER_PASSWORD, and E2E_CLIENT_PASSWORD before running this script.');
  }

  const R = [];

  // ── Health ──
  const h = await j(API + '/health');
  R.push(['Health', h.status === 'ok' ? '✅' : '❌']);

  // ── Superadmin ──
  const sa = await j(API + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: SA_EMAIL, password: SA_PASSWORD }) });
  R.push(['SA Login', sa.token ? '✅' : '❌']);

  const H1 = { Authorization: 'Bearer ' + sa.token };
  const sas = await j(API + '/api/superadmin/stats', { headers: H1 });
  R.push(['SA Stats', typeof sas.totalResellers?.value === 'number' ? '✅ resellers=' + sas.totalResellers.value : '❌']);
  const sac = await j(API + '/api/superadmin/clients', { headers: H1 });
  R.push(['SA Clients', Array.isArray(sac) ? '✅ count=' + sac.length : '❌']);
  const sar = await j(API + '/api/superadmin/resellers', { headers: H1 });
  R.push(['SA Resellers', Array.isArray(sar) ? '✅ count=' + sar.length : '❌']);
  const sal = await j(API + '/api/superadmin/leads', { headers: H1 });
  R.push(['SA Leads', Array.isArray(sal.leads) ? '✅ count=' + sal.leads.length + ' total=' + sal.total : '❌']);
  const sah = await j(API + '/api/superadmin/system/health', { headers: H1 });
  R.push(['SA System Health', sah.mongodb ? '✅ uptime=' + Math.round(sah.uptime) + 's' : '❌']);
  const sau = await j(API + '/api/superadmin/system/api-usage', { headers: H1 });
  R.push(['SA API Usage', sau.groq?.totalCalls !== undefined ? '✅ calls=' + sau.groq.totalCalls + ' keys=' + sau.groq.keyCount : '❌']);
  const saU = await j(API + '/api/superadmin/users', { headers: H1 });
  R.push(['SA Users', Array.isArray(saU) ? '✅ count=' + saU.length : '❌']);

  // ── Admin / Reseller ──
  const ad = await j(API + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: RESELLER_EMAIL, password: RESELLER_PASSWORD }) });
  R.push(['Admin Login', ad.token ? '✅' : '❌']);

  const H2 = { Authorization: 'Bearer ' + ad.token };
  const ads = await j(API + '/api/admin/stats', { headers: H2 });
  R.push(['Admin Stats', typeof ads.activeClients?.value === 'number' ? '✅ clients=' + ads.activeClients.value : '❌']);
  const adcl = await j(API + '/api/admin/clients', { headers: H2 });
  R.push(['Admin Clients', Array.isArray(adcl) ? '✅ count=' + adcl.length : '❌']);
  const adld = await j(API + '/api/admin/leads', { headers: H2 });
  R.push(['Admin Leads', Array.isArray(adld.leads) ? '✅ count=' + adld.leads.length : '❌']);
  const adcv = await j(API + '/api/admin/conversations', { headers: H2 });
  R.push(['Admin Convs', Array.isArray(adcv.conversations) ? '✅ count=' + adcv.conversations.length : '❌']);
  const adac = await j(API + '/api/admin/activity', { headers: H2 });
  R.push(['Admin Activity', Array.isArray(adac) ? '✅ count=' + adac.length : '❌']);

  // Individual chart endpoints
  for (const ep of ['leads-per-client', 'portfolio-score', 'platform-volume', 'top-clients', 'monthly-growth', 'conversion-funnel', 'message-by-day']) {
    const d = await j(API + '/api/admin/charts/' + ep, { headers: H2 });
    const ok = d.__html !== true;
    R.push(['Chart ' + ep.slice(0, 12), ok ? '✅' : '❌ ' + d.status]);
  }

  // ── Client ──
  const cl = await j(API + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: CLIENT_EMAIL, password: CLIENT_PASSWORD }) });
  R.push(['Client Login', cl.token ? '✅' : '❌']);

  const H3 = { Authorization: 'Bearer ' + cl.token };
  const cls = await j(API + '/api/client/stats', { headers: H3 });
  R.push(['Client Stats', typeof cls.totalLeads?.value === 'number' ? '✅ leads=' + cls.totalLeads.value : '❌']);
  const clld = await j(API + '/api/client/leads', { headers: H3 });
  R.push(['Client Leads', Array.isArray(clld.leads) ? '✅ count=' + clld.leads.length : '❌']);
  const clcv = await j(API + '/api/client/conversations', { headers: H3 });
  R.push(['Client Convs', Array.isArray(clcv.conversations) ? '✅ count=' + clcv.conversations.length : '❌']);
  const clst = await j(API + '/api/client/settings', { headers: H3 });
  R.push(['Client Settings', clst.school?.name ? '✅ ' + clst.school.name : '❌']);
  // Client charts
  for (const ep of ['charts/volume', 'charts/score-distribution', 'charts/messages-by-day', 'charts/leads-today', 'charts/funnel']) {
    const d = await j(API + '/api/client/' + ep, { headers: H3 });
    const ok = d.__html !== true;
    R.push(['CL ' + ep.split('/')[1].slice(0, 12), ok ? '✅' : '❌ ' + d.status]);
  }

  // ── Widget ──
  const wc = await j(API + '/widget/config/69a305f398f94563b73c6ef3');
  R.push(['Widget Config', wc.brandName ? '✅ ' + wc.brandName : '❌']);
  const wi = await j(API + '/widget/init', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ businessId: '69a305f398f94563b73c6ef3', visitorId: 'e2e-' + Date.now() }) });
  R.push(['Widget Init', wi.visitorId ? '✅' : '❌']);

  // ── Dashboard Pages ──
  for (const p of ['/login', '/superadmin/dashboard', '/superadmin/clients', '/superadmin/resellers', '/superadmin/users', '/superadmin/leads', '/superadmin/system', '/admin/dashboard', '/admin/clients', '/admin/leads', '/admin/conversations', '/admin/appointments', '/admin/analytics', '/admin/widget', '/admin/settings', '/client/dashboard', '/client/leads', '/client/conversations', '/client/appointments', '/client/settings']) {
    const status = await fetch(DASH + p).then(r => r.status);
    R.push(['Page ' + p.split('/').slice(-1)[0].padEnd(13), status === 200 ? '✅' : '❌ ' + status]);
  }

  // ── Report ──
  console.log('\n════════════════ AYKA E2E REPORT ════════════════');
  let pass = 0, fail = 0;
  for (const [n, r] of R) {
    const ok = r.startsWith('✅');
    if (ok) pass++; else fail++;
    console.log(ok ? '  ✅' : '  ❌', n.padEnd(25), r);
  }
  console.log('══════════════════════════════════════════════════');
  console.log('  PASS:', pass, ' FAIL:', fail, ' TOTAL:', pass + fail);
  console.log('  PASS RATE: ' + Math.round(pass / (pass + fail) * 100) + '%');
  console.log('══════════════════════════════════════════════════');
}

test().catch(e => console.error('FATAL:', e.message));
