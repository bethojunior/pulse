import { describe, expect, it } from 'vitest';
import { createObserveModule, ObserveModule } from '../src/index.js';

describe('Observe module factory', () => {
  it('returns a Nest dynamic module compatible surface', () => {
    const created = createObserveModule();
    const dynamicModule = created.ObserveModule.forRoot({ serviceId: 'api' });

    expect(created.ObserveModule).toBe(ObserveModule);
    expect(dynamicModule.module).toBe(ObserveModule);
    expect(dynamicModule.providers?.length).toBeGreaterThan(0);
    expect(created.ObserveInstrument).toEqual({ module: ObserveModule });
  });
});
