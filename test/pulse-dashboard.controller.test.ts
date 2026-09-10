import { describe, expect, it, vi } from 'vitest';
import { PulseDashboardController, dashboardContentSecurityPolicy } from '../src/pulse-dashboard.controller.js';
import { renderPulseDashboard } from '../src/pulse-dashboard.html.js';

function createController(options = { serviceId: 'api' }, rabbit: { queue?: (name: string, vhost?: string) => unknown } = {}) {
  return new PulseDashboardController({} as never, options, {} as never, {} as never, {} as never, {} as never, rabbit as never);
}

function createResponse() {
  const headers = new Map<string, string>();
  return {
    headers,
    status: () => undefined,
    setHeader: (name: string, value: string) => { headers.set(name, value); },
  };
}

describe('Pulse dashboard content security policy', () => {
  it('ships a nonce-based policy so the inline script runs under helmet defaults', () => {
    const controller = createController();
    const response = createResponse();

    const html = controller.dashboard({ url: '/pulse', headers: {} }, response);

    const policy = response.headers.get('content-security-policy');
    const nonce = /script-src 'nonce-([^']+)'/.exec(policy ?? '')?.[1];
    expect(nonce).toBeTruthy();
    expect(policy).toContain("default-src 'self'");
    expect(policy).not.toContain('unsafe-eval');
    expect(html).toContain(`<script nonce="${nonce}">`);
    expect(html).not.toContain(`"nonce"`);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
  });

  it('does not set an html content type before authorization fails', () => {
    const controller = createController({ serviceId: 'api', dashboard: { users: [{ username: 'admin', password: 'secret' }] } } as never);
    const response = createResponse();

    expect(() => controller.dashboard({ url: '/pulse', headers: {} }, response)).toThrow('Invalid Pulse dashboard credentials');
    expect(response.headers.has('content-type')).toBe(false);
    expect(response.headers.get('www-authenticate')).toBe('Basic realm="Pulse"');
  });

  it('uses a fresh nonce per request', () => {
    const controller = createController();
    const first = createResponse();
    const second = createResponse();

    controller.dashboard({ url: '/pulse', headers: {} }, first);
    controller.dashboard({ url: '/pulse', headers: {} }, second);

    expect(first.headers.get('content-security-policy')).not.toEqual(second.headers.get('content-security-policy'));
  });

  it('renders a plain script tag when no nonce is given', () => {
    const html = renderPulseDashboard({ serviceId: 'api', environment: 'Development', basePath: '/pulse' });

    expect(html).toContain('<script>');
    expect(dashboardContentSecurityPolicy('abc')).toContain("script-src 'nonce-abc'");
  });

  it('serves one RabbitMQ queue detail behind the same authorization', async () => {
    const queue = vi.fn(async (name: string, vhost?: string) => ({ status: name === 'ghost' ? 'missing' : 'connected', name, vhost: vhost ?? '/', checkedAt: 'now' }));
    const controller = createController({ serviceId: 'api', dashboard: { users: [{ username: 'admin', password: 'secret' }] } } as never, { queue });
    const authorized = { url: '/pulse/api/rabbitmq/queue?name=events', headers: { authorization: 'Basic ' + Buffer.from('admin:secret').toString('base64') } };

    await expect(controller.rabbitMqQueue('events', undefined, { url: authorized.url, headers: {} }, createResponse())).rejects.toThrow('Invalid Pulse dashboard credentials');
    expect(queue).not.toHaveBeenCalled();

    await expect(controller.rabbitMqQueue(undefined, undefined, authorized, createResponse())).rejects.toThrow('"name" is required');
    await expect(controller.rabbitMqQueue('events', '', authorized, createResponse())).resolves.toMatchObject({ status: 'connected', name: 'events' });
    expect(queue).toHaveBeenLastCalledWith('events', undefined);

    const response = { ...createResponse(), status: vi.fn() };
    await expect(controller.rabbitMqQueue('ghost', 'shop', authorized, response)).resolves.toMatchObject({ status: 'missing' });
    expect(response.status).toHaveBeenCalledWith(404);
    expect(queue).toHaveBeenLastCalledWith('ghost', 'shop');
  });

  it('opens a side sheet with every request field when a Requests row is clicked', () => {
    const html = renderPulseDashboard({ serviceId: 'api', environment: 'Development', basePath: '/pulse' });

    // Route rows open a shadcn-style Sheet (backdrop + right panel) rendered outside #content after every render.
    expect(html).toContain('function requestsTable(rows, compactMode)');
    expect(html).toContain("closest('tr[data-request]')");
    expect(html).toContain('class="sheet-backdrop" data-sheet-close="1"');
    expect(html).toContain('<aside class="sheet" role="dialog" aria-modal="true"');
    expect(html).toContain('afterRender.push(renderSheet)');
    expect(html).toContain("event.key === 'Escape' && sheet.key");
    // The panel reuses the error-detail building blocks: samples, stack frames, cause chain, attributes, trace, JSON.
    expect(html).toContain('data-request-sample="');
    expect(html).toContain('frameRow(frame, position)');
    expect(html).toContain('causeChain(error.cause, 0)');
    expect(html).toContain('traceWaterfall(traceSpans, span.spanId, false)');
    expect(html).toContain('JSON completo');
    expect(html).toContain('.sheet { position: fixed; top: 0; right: 0; bottom: 0;');
    expect(html).not.toContain('class="request-detail"');
  });
});
