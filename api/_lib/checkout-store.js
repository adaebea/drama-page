const fs = require('node:fs/promises');
const path = require('node:path');

const STORE_PATH = path.join(process.cwd(), 'api', '_data', 'kalos-store.json');
const LOCK_PATH = `${STORE_PATH}.lock`;

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withStoreLock(fn, { timeoutMs = 2500, staleMs = 30000 } = {}) {
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

async function ensureStore() {
  try {
    await fs.access(STORE_PATH);
  } catch (error) {
    const initialStore = {
      emails: [],
      codes: [],
    };
    await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
    await fs.writeFile(STORE_PATH, JSON.stringify(initialStore, null, 2));
  }
}

async function readStore() {
  await ensureStore();
  const raw = await fs.readFile(STORE_PATH, 'utf8');
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed.emails)) parsed.emails = [];
  if (!Array.isArray(parsed.codes)) parsed.codes = [];

  return parsed;
}

async function writeStore(store) {
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
    const store = await readStore();
    const availableCode = store.codes.find((item) => item.status === 'available');

    if (!availableCode) {
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

async function deliverCodeForSession(sessionId) {
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

module.exports = {
  normalizeEmail,
  recordEmailLead,
  reserveNextCode,
  attachSessionToCode,
  releaseReservedCode,
  findCodeBySessionId,
  markCodeDelivered,
  deliverCodeForSession,
};
