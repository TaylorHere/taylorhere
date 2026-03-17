const {
  CF_API_TOKEN,
  CF_ACCOUNT_ID,
  CF_PROJECT_NAME,
  CF_CUSTOM_DOMAIN,
  CF_ZONE_NAME,
  CF_TARGET_DOMAIN,
} = process.env;

const required = {
  CF_API_TOKEN,
  CF_ACCOUNT_ID,
  CF_PROJECT_NAME,
  CF_CUSTOM_DOMAIN,
  CF_ZONE_NAME,
};

for (const [key, value] of Object.entries(required)) {
  if (!value) {
    throw new Error(`Missing required env: ${key}`);
  }
}

const API_BASE = 'https://api.cloudflare.com/client/v4';

async function cfRequest(method, path, body) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${CF_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json().catch(() => ({
    success: false,
    errors: [{ message: `Non-JSON response (${response.status})` }],
  }));

  return {
    ok: response.ok && data.success !== false,
    status: response.status,
    data,
  };
}

function hasAlreadyExistsError(payload) {
  const errors = payload?.errors ?? [];
  return errors.some((e) => /already exists/i.test(String(e?.message ?? '')));
}

function normalizeRecordName(name) {
  if (!name || name === '@') return CF_ZONE_NAME;
  if (name.endsWith(`.${CF_ZONE_NAME}`) || name === CF_ZONE_NAME) return name;
  return `${name}.${CF_ZONE_NAME}`;
}

function isProxiableType(type) {
  return ['A', 'AAAA', 'CNAME'].includes(type.toUpperCase());
}

function stringifyError(payload) {
  return JSON.stringify(payload, null, 2);
}

async function ensurePagesDomainBinding() {
  const result = await cfRequest(
    'POST',
    `/accounts/${CF_ACCOUNT_ID}/pages/projects/${CF_PROJECT_NAME}/domains`,
    { name: CF_CUSTOM_DOMAIN },
  );

  if (result.ok || hasAlreadyExistsError(result.data)) {
    console.log(`Pages custom domain ensured: ${CF_CUSTOM_DOMAIN}`);
    return;
  }

  throw new Error(`Failed ensuring Pages custom domain:\n${stringifyError(result.data)}`);
}

async function ensureZoneId() {
  const zoneResponse = await cfRequest(
    'GET',
    `/zones?name=${encodeURIComponent(CF_ZONE_NAME)}&per_page=1`,
  );
  if (!zoneResponse.ok || !zoneResponse.data?.result?.length) {
    throw new Error(
      `Unable to locate zone "${CF_ZONE_NAME}". Check token scopes (Zone Read).\n${stringifyError(zoneResponse.data)}`,
    );
  }
  return zoneResponse.data.result[0].id;
}

async function upsertDnsRecord(zoneId, record) {
  const list = await cfRequest(
    'GET',
    `/zones/${zoneId}/dns_records?name=${encodeURIComponent(record.name)}&per_page=100`,
  );
  if (!list.ok) {
    throw new Error(`Failed querying DNS records:\n${stringifyError(list.data)}`);
  }

  const existing = list.data.result ?? [];
  const sameType = existing.find((r) => r.type === record.type);
  if (sameType) {
    const update = await cfRequest('PATCH', `/zones/${zoneId}/dns_records/${sameType.id}`, record);
    if (!update.ok) {
      throw new Error(`Failed updating DNS record:\n${stringifyError(update.data)}`);
    }
    console.log(`DNS updated: ${record.type} ${record.name} -> ${record.content}`);
    return;
  }

  // CNAME 与 A/AAAA/CNAME 同名冲突，自动清理这类 web 记录，避免人工干预。
  if (record.type === 'CNAME') {
    for (const conflict of existing) {
      if (['A', 'AAAA', 'CNAME'].includes(conflict.type)) {
        const del = await cfRequest('DELETE', `/zones/${zoneId}/dns_records/${conflict.id}`);
        if (!del.ok) {
          throw new Error(`Failed deleting conflicting DNS record:\n${stringifyError(del.data)}`);
        }
        console.log(`DNS deleted conflict: ${conflict.type} ${conflict.name}`);
      }
    }
  }

  const create = await cfRequest('POST', `/zones/${zoneId}/dns_records`, record);
  if (!create.ok) {
    throw new Error(`Failed creating DNS record:\n${stringifyError(create.data)}`);
  }
  console.log(`DNS created: ${record.type} ${record.name} -> ${record.content}`);
}

async function ensureDnsForCustomDomain() {
  const zoneId = await ensureZoneId();
  const target = CF_TARGET_DOMAIN || `${CF_PROJECT_NAME}.pages.dev`;
  const record = {
    type: 'CNAME',
    name: normalizeRecordName(CF_CUSTOM_DOMAIN),
    content: target,
    ttl: 1,
    proxied: true,
  };

  await upsertDnsRecord(zoneId, record);
}

async function main() {
  await ensurePagesDomainBinding();
  await ensureDnsForCustomDomain();
  console.log(`Custom domain fully ensured: ${CF_CUSTOM_DOMAIN}`);
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
