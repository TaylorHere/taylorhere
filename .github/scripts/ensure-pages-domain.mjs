const {
  CF_API_TOKEN,
  CF_DNS_API_TOKEN,
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
const DNS_TOKEN = CF_DNS_API_TOKEN || CF_API_TOKEN;
const USING_DEDICATED_DNS_TOKEN = Boolean(CF_DNS_API_TOKEN && CF_DNS_API_TOKEN !== CF_API_TOKEN);

class DnsAuthError extends Error {}

async function cfRequest(method, path, body, token = CF_API_TOKEN) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
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
  return errors.some((e) => {
    const code = Number(e?.code);
    const message = String(e?.message ?? '');
    return code === 8000018 || /already exists/i.test(message) || /already added this custom domain/i.test(message);
  });
}

function hasAuthError(payload) {
  const errors = payload?.errors ?? [];
  return errors.some((e) => {
    const code = Number(e?.code);
    const message = String(e?.message ?? '');
    return code === 10000 || /authentication/i.test(message);
  });
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

async function getPagesDomainDetails() {
  const detail = await cfRequest(
    'GET',
    `/accounts/${CF_ACCOUNT_ID}/pages/projects/${CF_PROJECT_NAME}/domains/${encodeURIComponent(CF_CUSTOM_DOMAIN)}`,
  );
  if (!detail.ok) {
    return null;
  }
  return detail.data?.result ?? null;
}

function isDomainActive(details) {
  if (!details) return false;
  const text = JSON.stringify(details).toLowerCase();
  return text.includes('"status":"active"') || text.includes('"status":"verified"');
}

async function ensureZoneId() {
  const zoneResponse = await cfRequest(
    'GET',
    `/zones?name=${encodeURIComponent(CF_ZONE_NAME)}&per_page=1`,
    undefined,
    DNS_TOKEN,
  );
  if (!zoneResponse.ok && hasAuthError(zoneResponse.data)) {
    throw new DnsAuthError('Token lacks Zone Read permission for DNS automation.');
  }
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
    undefined,
    DNS_TOKEN,
  );
  if (!list.ok && hasAuthError(list.data)) {
    throw new DnsAuthError('Token lacks DNS Edit/Read permission for DNS automation.');
  }
  if (!list.ok) {
    throw new Error(`Failed querying DNS records:\n${stringifyError(list.data)}`);
  }

  const existing = list.data.result ?? [];
  const sameType = existing.find((r) => r.type === record.type);
  if (sameType) {
    const update = await cfRequest('PATCH', `/zones/${zoneId}/dns_records/${sameType.id}`, record, DNS_TOKEN);
    if (!update.ok && hasAuthError(update.data)) {
      throw new DnsAuthError('Token lacks DNS Edit permission for DNS automation.');
    }
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
        const del = await cfRequest('DELETE', `/zones/${zoneId}/dns_records/${conflict.id}`, undefined, DNS_TOKEN);
        if (!del.ok && hasAuthError(del.data)) {
          throw new DnsAuthError('Token lacks DNS Edit permission for DNS automation.');
        }
        if (!del.ok) {
          throw new Error(`Failed deleting conflicting DNS record:\n${stringifyError(del.data)}`);
        }
        console.log(`DNS deleted conflict: ${conflict.type} ${conflict.name}`);
      }
    }
  }

  const create = await cfRequest('POST', `/zones/${zoneId}/dns_records`, record, DNS_TOKEN);
  if (!create.ok && hasAuthError(create.data)) {
    throw new DnsAuthError('Token lacks DNS Edit permission for DNS automation.');
  }
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
  console.log(
    `DNS token source: ${USING_DEDICATED_DNS_TOKEN ? 'CLOUDFLARE_DNS_API_TOKEN' : 'CLOUDFLARE_API_TOKEN'}`,
  );
  await ensurePagesDomainBinding();
  const details = await getPagesDomainDetails();

  try {
    await ensureDnsForCustomDomain();
  } catch (error) {
    if (error instanceof DnsAuthError) {
      if (isDomainActive(details)) {
        console.warn(`DNS API permission missing, but domain is already active in Pages: ${CF_CUSTOM_DOMAIN}`);
      } else {
        throw new Error(
          `DNS automation requires token scopes: Zone Read + DNS Edit. ` +
            `Set secret CLOUDFLARE_DNS_API_TOKEN (recommended) or extend CLOUDFLARE_API_TOKEN.\n` +
            `Original: ${error.message}`,
        );
      }
    } else {
      throw error;
    }
  }

  console.log(`Custom domain fully ensured: ${CF_CUSTOM_DOMAIN}`);
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
