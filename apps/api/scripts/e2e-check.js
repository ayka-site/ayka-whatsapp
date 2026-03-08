require('dotenv').config();
const API = 'http://localhost:3000';
const SA_EMAIL = process.env.E2E_SUPERADMIN_EMAIL || 'superadmin@ayka.in';
const SA_PASSWORD = process.env.E2E_SUPERADMIN_PASSWORD || '';
const RESELLER_EMAIL = process.env.E2E_RESELLER_EMAIL || 'admin@welltechup.com';
const RESELLER_PASSWORD = process.env.E2E_RESELLER_PASSWORD || '';
const CLIENT_EMAIL = process.env.E2E_CLIENT_EMAIL || 'admin@santpathik.in';
const CLIENT_PASSWORD = process.env.E2E_CLIENT_PASSWORD || '';

async function j(url, opts) {
  const r = await fetch(url, opts);
  return r.text();
}

async function main() {
  if (!SA_PASSWORD || !RESELLER_PASSWORD || !CLIENT_PASSWORD) {
    throw new Error('Set E2E_SUPERADMIN_PASSWORD, E2E_RESELLER_PASSWORD, and E2E_CLIENT_PASSWORD before running this script.');
  }

  const sa = await fetch(API + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: SA_EMAIL, password: SA_PASSWORD }) }).then(r => r.json());
  const ad = await fetch(API + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: RESELLER_EMAIL, password: RESELLER_PASSWORD }) }).then(r => r.json());
  const cl = await fetch(API + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: CLIENT_EMAIL, password: CLIENT_PASSWORD }) }).then(r => r.json());

  const checks = [
    ['SA Leads', API + '/api/superadmin/leads', sa.token],
    ['SA System', API + '/api/superadmin/system/health', sa.token],
    ['SA API Usage', API + '/api/superadmin/system/api-usage', sa.token],
    ['Admin Charts', API + '/api/admin/charts', ad.token],
    ['Admin Leads', API + '/api/admin/leads', ad.token],
    ['Admin Convs', API + '/api/admin/conversations', ad.token],
    ['Client Stats', API + '/api/client/stats', cl.token],
    ['Client Leads', API + '/api/client/leads', cl.token],
    ['Client Convs', API + '/api/client/conversations', cl.token],
    ['Widget Config', API + '/widget/config/69a305f398f94563b73c6ef3', null],
  ];

  for (const [name, url, token] of checks) {
    const opts = token ? { headers: { Authorization: 'Bearer ' + token } } : {};
    const txt = await j(url, opts);
    try {
      const d = JSON.parse(txt);
      const isArr = Array.isArray(d);
      const keys = isArr ? '[Array:' + d.length + ']' : Object.keys(d).join(',');
      console.log('---', name);
      console.log('  type:', isArr ? 'array' : 'object', '| keys:', keys);
      if (isArr === false && typeof d === 'object') {
        for (const [k, v] of Object.entries(d)) {
          const vt = Array.isArray(v) ? 'array[' + v.length + ']' : typeof v;
          const val = Array.isArray(v) ? '' : '= ' + JSON.stringify(v).slice(0, 60);
          console.log('  ', k + ':', vt, val);
        }
      }
    } catch (e) {
      console.log('---', name, 'ERROR:', txt.slice(0, 100));
    }
  }

  // Widget init
  const wi = await fetch(API + '/widget/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ businessId: '69a305f398f94563b73c6ef3', visitorId: 'e2e-' + Date.now() })
  }).then(r => r.text());
  console.log('--- Widget Init');
  try {
    const d = JSON.parse(wi);
    console.log('  keys:', Object.keys(d).join(','));
    console.log('  data:', JSON.stringify(d).slice(0, 200));
  } catch (e) {
    console.log('  ERROR:', wi.slice(0, 100));
  }
}

main().catch(e => console.error('FATAL:', e.message));
