const fs = require('node:fs/promises');
const path = require('node:path');

const STORE_PATH = path.join(process.cwd(), 'api', '_data', 'kalos-store.local.json');
const LOCK_PATH = `${STORE_PATH}.lock`;
const KV_STORE_KEY = process.env.KALOS_KV_STORE_KEY || 'kalos:store';
const KV_LOCK_KEY = process.env.KALOS_KV_LOCK_KEY || 'kalos:store:lock';
const RESERVATION_TTL_MINUTES = Number(process.env.KALOS_RESERVATION_TTL_MINUTES || '30');
const RESERVATION_TTL_MS = Math.max(1, RESERVATION_TTL_MINUTES) * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withStoreLock(fn, { timeoutMs = 2500, staleMs = 30000 } = {}) {
  if (hasKvConfig()) {
    return withKvLock(fn, { timeoutMs, staleMs });
  }

  const startedAt = Date.now();
  let lockHandle = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      lockHandle = await fs.open(LOCK_PATH, 'wx');
      break;
    } catch (error) {
      if (error && error.code !== 'EEXIST') throw error;

      try {
        const stat = await fs.stat(LOCK_PATH);
        if (Date.now() - stat.mtimeMs > staleMs) {
          await fs.unlink(LOCK_PATH);
          continue;
        }
      } catch (statError) {
        // Lock disappeared between checks; retry acquire.
      }

      await sleep(25 + Math.floor(Math.random() * 75));
    }
  }

  if (!lockHandle) {
    throw new Error('Store is busy, please retry.');
  }

  try {
    return await fn();
  } finally {
    try {
      await lockHandle.close();
    } catch (error) {
      // ignore
    }
    try {
      await fs.unlink(LOCK_PATH);
    } catch (error) {
      // ignore
    }
  }
}

function hasKvConfig() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

function isVercelRuntime() {
  return Boolean(process.env.VERCEL || process.env.VERCEL_ENV || process.env.AWS_REGION);
}

function assertWritableStorageAvailable() {
  if (!hasKvConfig() && isVercelRuntime()) {
    throw new Error(
      'Kalos code storage is not configured. Add KV_REST_API_URL and KV_REST_API_TOKEN in Vercel.'
    );
  }
}

function parseSeedCodes() {
  const jsonCodes = process.env.KALOS_CODES_JSON;
  if (jsonCodes) {
    try {
      const parsed = JSON.parse(jsonCodes);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item).trim()).filter(Boolean);
      }
    } catch (error) {
      throw new Error('KALOS_CODES_JSON is not valid JSON.');
    }
  }

  const csvCodes = process.env.KALOS_CODES_CSV || '';
  return csvCodes
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function createInitialStore() {
  return {
    emails: [],
    codes: parseSeedCodes().map((code) => ({
      code,
      status: 'available',
      email: '',
      reservedAt: '',
      sessionId: '',
      deliveredAt: '',
      updatedAt: '',
    })),
    purchases: [],
  };
}

function hydrateCodesIfMissing(store) {
  if (Array.isArray(store.codes) && store.codes.length > 0) {
    return store;
  }

  const seededCodes = createInitialStore().codes;
  if (seededCodes.length === 0) {
    return store;
  }

  return {
    ...store,
    codes: seededCodes,
  };
}

function releaseExpiredReservations(store, nowMs = Date.now()) {
  let changed = false;

  for (const code of store.codes) {
    if (code.status !== 'reserved') continue;
    const reservedAtMs = Date.parse(code.reservedAt || '');
    const isExpired = !reservedAtMs || nowMs - reservedAtMs >= RESERVATION_TTL_MS;
    if (!isExpired) continue;

    code.status = 'available';
    code.email = '';
    code.reservedAt = '';
    code.sessionId = '';
    code.deliveredAt = '';
    code.updatedAt = nowIso();
    changed = true;
  }

  return changed;
}

function mergeSeedCodesIntoStore(store) {
  const seedCodes = parseSeedCodes();
  if (seedCodes.length === 0) {
    return { store, changed: false };
  }

  const existing = new Set(store.codes.map((item) => item.code));
  let changed = false;

  for (const code of seedCodes) {
    if (existing.has(code)) continue;
    store.codes.push({
      code,
      status: 'available',
      email: '',
      reservedAt: '',
      sessionId: '',
      deliveredAt: '',
      updatedAt: '',
    });
    existing.add(code);
    changed = true;
  }

  return { store, changed };
}

function getKvHeaders() {
  return {
    Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

async function kvRequest(command, ...args) {
  const baseUrl = process.env.KV_REST_API_URL;
  const encodedArgs = args.map((item) => encodeURIComponent(String(item)));
  const url = `${baseUrl}/${[command, ...encodedArgs].join('/')}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: getKvHeaders(),
  });
  const result = await response.json();

  if (!response.ok || result.error) {
    throw new Error(result.error || `KV request failed: ${command}`);
  }

  return result.result;
}

async function withKvLock(fn, { timeoutMs = 2500, staleMs = 30000 } = {}) {
  const startedAt = Date.now();
  const token = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  while (Date.now() - startedAt < timeoutMs) {
    const locked = await kvRequest('set', KV_LOCK_KEY, token, 'NX', 'PX', staleMs);
    if (locked === 'OK') {
      try {
        return await fn();
      } finally {
        const currentToken = await kvRequest('get', KV_LOCK_KEY);
        if (currentToken === token) {
          await kvRequest('del', KV_LOCK_KEY);
        }
      }
    }

    await sleep(25 + Math.floor(Math.random() * 75));
  }

  throw new Error('Store is busy, please retry.');
}

async function ensureStore() {
  assertWritableStorageAvailable();

  if (hasKvConfig()) {
    const existingStore = await kvRequest('get', KV_STORE_KEY);
    if (existingStore) return;

    const initialStore = createInitialStore();
    await kvRequest('set', KV_STORE_KEY, JSON.stringify(initialStore));
    return;
  }

  try {
    await fs.access(STORE_PATH);
  } catch (error) {
    const initialStore = createInitialStore();
    await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
    await fs.writeFile(STORE_PATH, JSON.stringify(initialStore, null, 2));
  }
}

async function readStore({ mergeSeedCodes = false } = {}) {
  await ensureStore();
  const raw = hasKvConfig()
    ? await kvRequest('get', KV_STORE_KEY)
    : await fs.readFile(STORE_PATH, 'utf8');
  const parsed = hydrateCodesIfMissing(JSON.parse(raw));

  if (!Array.isArray(parsed.emails)) parsed.emails = [];
  if (!Array.isArray(parsed.codes)) parsed.codes = [];
  if (!Array.isArray(parsed.purchases)) parsed.purchases = [];

  if (mergeSeedCodes) {
    const { store, changed } = mergeSeedCodesIntoStore(parsed);
    if (changed) {
      await writeStore(store);
    }
    return store;
  }

  return parsed;
}

async function writeStore(store) {
  if (hasKvConfig()) {
    await kvRequest('set', KV_STORE_KEY, JSON.stringify(store));
    return;
  }

  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2));
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

async function recordEmailLead(email, extra = {}) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;

  return await withStoreLock(async () => {
    const store = await readStore();
    const existingLead = store.emails.find((item) => item.email === normalizedEmail);
    const timestamp = nowIso();

    if (existingLead) {
      existingLead.lastSeenAt = timestamp;
      existingLead.sessionsStarted = (existingLead.sessionsStarted || 0) + 1;
      existingLead.source = extra.source || existingLead.source || 'landing-page';
      await writeStore(store);
      return existingLead;
    }

    const lead = {
      email: normalizedEmail,
      source: extra.source || 'landing-page',
      createdAt: timestamp,
      lastSeenAt: timestamp,
      sessionsStarted: 1,
    };

    store.emails.push(lead);
    await writeStore(store);
    return lead;
  });
}

async function reserveNextCode(email) {
  const normalizedEmail = normalizeEmail(email);
  return await withStoreLock(async () => {
    const store = await readStore({ mergeSeedCodes: true });
    const expiredReleased = releaseExpiredReservations(store);
    const availableCode = store.codes.find((item) => item.status === 'available');

    if (!availableCode) {
      if (expiredReleased) {
        await writeStore(store);
      }
      return null;
    }

    availableCode.status = 'reserved';
    availableCode.email = normalizedEmail;
    availableCode.reservedAt = nowIso();
    availableCode.sessionId = '';
    availableCode.deliveredAt = '';
    availableCode.updatedAt = nowIso();

    await writeStore(store);
    return { ...availableCode };
  });
}

async function attachSessionToCode(codeValue, sessionId) {
  return await withStoreLock(async () => {
    const store = await readStore();
    const code = store.codes.find((item) => item.code === codeValue);

    if (!code) return null;

    code.sessionId = sessionId;
    code.updatedAt = nowIso();
    await writeStore(store);
    return { ...code };
  });
}

async function releaseReservedCode(codeValue) {
  return await withStoreLock(async () => {
    const store = await readStore();
    const code = store.codes.find((item) => item.code === codeValue);

    if (!code) return null;

    code.status = 'available';
    code.email = '';
    code.reservedAt = '';
    code.sessionId = '';
    code.deliveredAt = '';
    code.updatedAt = nowIso();

    await writeStore(store);
    return { ...code };
  });
}

async function findCodeBySessionId(sessionId) {
  const store = await readStore();
  const code = store.codes.find((item) => item.sessionId === sessionId);
  return code ? { ...code } : null;
}

async function findLatestDeliveredCodeByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;

  const store = await readStore();
  const delivered = store.codes.filter(
    (item) => item.email === normalizedEmail && item.status === 'delivered'
  );

  if (delivered.length === 0) return null;

  delivered.sort((a, b) => {
    const aTime = Date.parse(a.deliveredAt || a.updatedAt || '') || 0;
    const bTime = Date.parse(b.deliveredAt || b.updatedAt || '') || 0;
    return bTime - aTime;
  });

  return { ...delivered[0] };
}

async function markCodeDelivered(sessionId) {
  return await withStoreLock(async () => {
    const store = await readStore();
    const code = store.codes.find((item) => item.sessionId === sessionId);

    if (!code) return null;

    code.status = 'delivered';
    code.deliveredAt = code.deliveredAt || nowIso();
    code.updatedAt = nowIso();

    await writeStore(store);
    return { ...code };
  });
}

async function deliverCodeForSession(sessionId, { email = '' } = {}) {
  return await withStoreLock(async () => {
    const store = await readStore({ mergeSeedCodes: true });
    const expiredReleased = releaseExpiredReservations(store);
    const code = store.codes.find((item) => item.sessionId === sessionId);
    if (!code) {
      if (expiredReleased) {
        await writeStore(store);
      }
      return null;
    }

    code.status = 'delivered';
    code.deliveredAt = code.deliveredAt || nowIso();
    code.updatedAt = nowIso();

    await writeStore(store);
    return { ...code };
  });
}

async function deliverOrAssignCodeForSession(sessionId, { email = '' } = {}) {
  return await withStoreLock(async () => {
    const store = await readStore({ mergeSeedCodes: true });
    const expiredReleased = releaseExpiredReservations(store);
    const existing = store.codes.find((item) => item.sessionId === sessionId);
    const now = nowIso();

    if (existing) {
      existing.status = 'delivered';
      existing.deliveredAt = existing.deliveredAt || now;
      existing.updatedAt = now;
      await writeStore(store);
      return { ...existing };
    }

    const available = store.codes.find((item) => item.status === 'available');
    if (!available) {
      if (expiredReleased) {
        await writeStore(store);
      }
      return null;
    }

    available.status = 'delivered';
    available.email = normalizeEmail(email) || available.email || '';
    available.reservedAt = available.reservedAt || now;
    available.sessionId = sessionId;
    available.deliveredAt = now;
    available.updatedAt = now;

    await writeStore(store);
    return { ...available };
  });
}

async function hasReportedPurchase({ subscriptionId = '', invoiceId = '' } = {}) {
  if (!subscriptionId && !invoiceId) return false;
  const store = await readStore();
  return store.purchases.some(
    (item) =>
      (subscriptionId && item.subscriptionId === subscriptionId) ||
      (invoiceId && item.invoiceId === invoiceId)
  );
}

async function recordReportedPurchase({
  subscriptionId = '',
  invoiceId = '',
  email = '',
  amount = 0,
  currency = '',
} = {}) {
  if (!subscriptionId && !invoiceId) return { reported: false, record: null };

  return await withStoreLock(async () => {
    const store = await readStore();
    const existing = store.purchases.find(
      (item) =>
        (subscriptionId && item.subscriptionId === subscriptionId) ||
        (invoiceId && item.invoiceId === invoiceId)
    );

    if (existing) {
      return { reported: false, record: { ...existing } };
    }

    const record = {
      subscriptionId,
      invoiceId,
      email: normalizeEmail(email),
      amount,
      currency,
      reportedAt: nowIso(),
    };

    store.purchases.push(record);
    await writeStore(store);

    return { reported: true, record: { ...record } };
  });
}

module.exports = {
  normalizeEmail,
  recordEmailLead,
  reserveNextCode,
  attachSessionToCode,
  releaseReservedCode,
  findCodeBySessionId,
  findLatestDeliveredCodeByEmail,
  markCodeDelivered,
  deliverCodeForSession,
  deliverOrAssignCodeForSession,
  hasReportedPurchase,
  recordReportedPurchase,
};
