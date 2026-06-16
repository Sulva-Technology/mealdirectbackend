import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export type FakePaystackServer = {
  baseUrl: string;
  close: () => Promise<void>;
};

let refundCounter = 0;

function json(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, { 'content-type': 'application/json' });
  response.end(JSON.stringify(payload));
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const value: unknown = chunk;
    if (Buffer.isBuffer(value)) {
      chunks.push(value);
    } else if (typeof value === 'string') {
      chunks.push(Buffer.from(value));
    } else if (value instanceof Uint8Array) {
      chunks.push(Buffer.from(value));
    }
  }
  const body = Buffer.concat(chunks).toString('utf8');
  return body.length === 0 ? {} : (JSON.parse(body) as Record<string, unknown>);
}

export async function startFakePaystack(): Promise<FakePaystackServer> {
  const configuredUrl = new URL(process.env.PAYSTACK_BASE_URL ?? 'http://127.0.0.1:59999');
  const server = createServer((request, response) => {
    void handlePaystackRequest(request, response);
  });

  await new Promise<void>((resolve) => {
    server.listen(Number(configuredUrl.port), configuredUrl.hostname, resolve);
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Fake Paystack server did not bind to a TCP port.');
  }

  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
    close: () => closeServer(server)
  };
}

async function handlePaystackRequest(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  if (request.url === '/transaction/initialize' && request.method === 'POST') {
    const body = await readJson(request);
    const reference = typeof body.reference === 'string' ? body.reference : 'E2E-REFERENCE';
    json(response, 200, {
      data: {
        access_code: `ACCESS_${reference}`,
        authorization_url: `https://checkout.e2e.local/${reference}`,
        reference
      },
      message: 'Authorization URL created',
      status: true
    });
    return;
  }

  if (request.url?.startsWith('/transaction/verify/') && request.method === 'GET') {
    const reference = decodeURIComponent(request.url.split('/').at(-1) ?? 'E2E-REFERENCE');
    json(response, 200, {
      data: {
        amount: 35000,
        currency: 'NGN',
        id: 987654321,
        reference,
        status: 'success'
      },
      message: 'Verification successful',
      status: true
    });
    return;
  }

  if (request.url === '/refund' && request.method === 'POST') {
    const body = await readJson(request);
    refundCounter += 1;
    json(response, 200, {
      data: {
        amount: typeof body.amount === 'number' ? body.amount : 1000,
        id: `RF_E2E_${String(Date.now())}_${String(refundCounter)}`,
        status: 'processed'
      },
      message: 'Refund created',
      status: true
    });
    return;
  }

  json(response, 404, { message: 'Not found', status: false });
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
