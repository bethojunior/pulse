import { existsSync, readFileSync, readdirSync, statfsSync } from 'node:fs';
import * as os from 'node:os';
import { PerformanceObserver, constants as perfConstants, monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { getHeapSpaceStatistics, getHeapStatistics } from 'node:v8';

/** Facts about the machine and the process that do not change while it runs. Collected once. */
export interface ServerInfo {
  host: string;
  platform: string;
  type: string;
  release: string;
  osVersion: string;
  arch: string;
  machine: string;
  cpuModel: string;
  cpuSpeedMhz: number;
  cores: number;
  parallelism: number;
  memoryTotal: number;
  endianness: string;
  node: string;
  versions: Record<string, string>;
  pid: number;
  ppid: number;
  title: string;
  execPath: string;
  argv: string[];
  execArgv: string[];
  cwd: string;
  user: string;
  timezone: string;
  nodeEnv: string;
  tmpdir: string;
  homedir: string;
  bootedAt: string;
  networkInterfaces: Array<{ name: string; address: string; family: string; internal: boolean }>;
}

export interface GcBucket { count: number; pauseMs: number }

export interface ServerSample {
  time: string;
  process: {
    pid: number;
    uptime: number;
    cpu: { percent: number; user: number; system: number };
    memory: { rss: number; heapUsed: number; heapTotal: number; heapLimit: number; heapPercent: number; external: number; arrayBuffers: number };
    heap: {
      totalHeapSize: number;
      totalHeapSizeExecutable: number;
      totalPhysicalSize: number;
      totalAvailableSize: number;
      mallocedMemory: number;
      peakMallocedMemory: number;
      nativeContexts: number;
      detachedContexts: number;
      externalMemory: number;
    };
    heapSpaces: Array<{ name: string; size: number; used: number; available: number; physical: number }>;
    gc: { total: GcBucket; sinceLast: GcBucket; kinds: Record<string, GcBucket> };
    eventLoop: { min: number; max: number; mean: number; stddev: number; p50: number; p95: number; p99: number; utilization: number };
    resources: { handles: number; requests: number; byType: Record<string, number>; fileDescriptors: number | null };
    usage: {
      maxRss: number;
      minorPageFaults: number;
      majorPageFaults: number;
      voluntaryContextSwitches: number;
      involuntaryContextSwitches: number;
      fsRead: number;
      fsWrite: number;
      swappedOut: number;
      signals: number;
      ipcSent: number;
      ipcReceived: number;
    };
  };
  host: {
    uptime: number;
    cpu: { percent: number; perCore: number[]; load: [number, number, number] };
    memory: { total: number; free: number; used: number; percent: number };
    disk: { path: string; total: number; free: number; used: number; percent: number } | null;
    network: { rxBytes: number; txBytes: number; rxBytesPerSecond: number; txBytesPerSecond: number } | null;
    container: { memoryLimit: number | null; memoryUsage: number | null; cpuLimit: number | null } | null;
  };
}

/** Compact time series point kept in memory for charts. */
export interface ServerPoint {
  time: string;
  hostCpu: number;
  processCpu: number;
  memoryPercent: number;
  memoryUsed: number;
  rss: number;
  heapUsed: number;
  heapPercent: number;
  external: number;
  eventLoopP50: number;
  eventLoopP95: number;
  eventLoopP99: number;
  eventLoopMax: number;
  eventLoopUtilization: number;
  load1: number;
  gcCount: number;
  gcPauseMs: number;
  handles: number;
  requests: number;
  rxBytesPerSecond: number;
  txBytesPerSecond: number;
}

const GC_KIND_NAMES: Record<number, string> = {
  [perfConstants.NODE_PERFORMANCE_GC_MINOR]: 'minor',
  [perfConstants.NODE_PERFORMANCE_GC_MAJOR]: 'major',
  [perfConstants.NODE_PERFORMANCE_GC_INCREMENTAL]: 'incremental',
  [perfConstants.NODE_PERFORMANCE_GC_WEAKCB]: 'weakcb',
};

export class ServerMetrics {
  private previousCpu = process.cpuUsage();
  private previousTime = process.hrtime.bigint();
  private previousCores = coreTimes();
  private previousElu = eventLoopUtilization();
  private previousNetwork: { rx: number; tx: number; at: number } | null = null;
  private readonly lag = monitorEventLoopDelay({ resolution: 20 });
  private gcObserver: PerformanceObserver | undefined;
  private readonly gcTotal: GcBucket = { count: 0, pauseMs: 0 };
  private readonly gcKinds: Record<string, GcBucket> = {};
  private gcSince: GcBucket = { count: 0, pauseMs: 0 };
  private cgroup: 'v2' | 'v1' | 'none' | 'unknown' = process.platform === 'linux' ? 'unknown' : 'none';

  start(): void {
    this.lag.enable();
    if (!this.gcObserver && typeof PerformanceObserver === 'function') {
      try {
        this.gcObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const detail = (entry as { detail?: { kind?: number }; kind?: number }).detail;
            const kind = GC_KIND_NAMES[detail?.kind ?? (entry as { kind?: number }).kind ?? -1] ?? 'other';
            const bucket = (this.gcKinds[kind] ??= { count: 0, pauseMs: 0 });
            bucket.count += 1;
            bucket.pauseMs += entry.duration;
            this.gcTotal.count += 1;
            this.gcTotal.pauseMs += entry.duration;
            this.gcSince.count += 1;
            this.gcSince.pauseMs += entry.duration;
          }
        });
        this.gcObserver.observe({ entryTypes: ['gc'] });
      } catch {
        this.gcObserver = undefined;
      }
    }
  }

  stop(): void {
    this.lag.disable();
    this.gcObserver?.disconnect();
    this.gcObserver = undefined;
  }

  describe(): ServerInfo {
    const cpu = os.cpus()[0];
    const interfaces: ServerInfo['networkInterfaces'] = [];
    for (const [name, entries] of Object.entries(os.networkInterfaces())) {
      for (const entry of entries ?? []) {
        interfaces.push({ name, address: entry.address, family: String(entry.family), internal: entry.internal });
      }
    }
    return {
      host: os.hostname(),
      platform: process.platform,
      type: os.type(),
      release: os.release(),
      osVersion: safe(() => os.version(), ''),
      arch: process.arch,
      machine: safe(() => (typeof os.machine === 'function' ? os.machine() : ''), ''),
      cpuModel: cpu?.model ?? '',
      cpuSpeedMhz: cpu?.speed ?? 0,
      cores: os.cpus().length,
      parallelism: safe(() => (typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length), os.cpus().length),
      memoryTotal: os.totalmem(),
      endianness: os.endianness(),
      node: process.version,
      versions: { ...process.versions } as Record<string, string>,
      pid: process.pid,
      ppid: process.ppid,
      title: process.title,
      execPath: process.execPath,
      argv: [...process.argv],
      execArgv: [...process.execArgv],
      cwd: safe(() => process.cwd(), ''),
      user: safe(() => os.userInfo().username, ''),
      timezone: safe(() => Intl.DateTimeFormat().resolvedOptions().timeZone, process.env.TZ ?? ''),
      nodeEnv: process.env.NODE_ENV ?? '',
      tmpdir: os.tmpdir(),
      homedir: safe(() => os.homedir(), ''),
      bootedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      networkInterfaces: interfaces,
    };
  }

  sample(): ServerSample {
    const now = process.hrtime.bigint();
    const elapsedUs = Number(now - this.previousTime) / 1000;
    const cpu = process.cpuUsage();
    const cores = coreTimes();
    const memory = process.memoryUsage();
    const heap = getHeapStatistics();
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    const elu = eventLoopUtilization(this.previousElu);
    const usage = process.resourceUsage();
    const resources = activeResources();
    const perCore = cores.map((core, index) => {
      const previous = this.previousCores[index];
      if (!previous) return 0;
      const total = core.total - previous.total;
      return total > 0 ? clamp(100 * (1 - (core.idle - previous.idle) / total)) : 0;
    });
    const hostTotal = cores.reduce((sum, core) => sum + core.total, 0) - this.previousCores.reduce((sum, core) => sum + core.total, 0);
    const hostIdle = cores.reduce((sum, core) => sum + core.idle, 0) - this.previousCores.reduce((sum, core) => sum + core.idle, 0);
    const user = elapsedUs > 0 ? (100 * (cpu.user - this.previousCpu.user)) / elapsedUs : 0;
    const system = elapsedUs > 0 ? (100 * (cpu.system - this.previousCpu.system)) / elapsedUs : 0;
    const gcSince = this.gcSince;
    this.gcSince = { count: 0, pauseMs: 0 };
    const load = os.loadavg();

    const sample: ServerSample = {
      time: new Date().toISOString(),
      process: {
        pid: process.pid,
        uptime: Math.floor(process.uptime()),
        cpu: { percent: Math.max(0, user + system), user: Math.max(0, user), system: Math.max(0, system) },
        memory: {
          rss: memory.rss,
          heapUsed: memory.heapUsed,
          heapTotal: memory.heapTotal,
          heapLimit: heap.heap_size_limit,
          heapPercent: heap.heap_size_limit > 0 ? (memory.heapUsed / heap.heap_size_limit) * 100 : 0,
          external: memory.external,
          arrayBuffers: memory.arrayBuffers ?? 0,
        },
        heap: {
          totalHeapSize: heap.total_heap_size,
          totalHeapSizeExecutable: heap.total_heap_size_executable,
          totalPhysicalSize: heap.total_physical_size,
          totalAvailableSize: heap.total_available_size,
          mallocedMemory: heap.malloced_memory,
          peakMallocedMemory: heap.peak_malloced_memory,
          nativeContexts: heap.number_of_native_contexts,
          detachedContexts: heap.number_of_detached_contexts,
          externalMemory: (heap as { external_memory?: number }).external_memory ?? 0,
        },
        heapSpaces: getHeapSpaceStatistics().map((space) => ({
          name: space.space_name,
          size: space.space_size,
          used: space.space_used_size,
          available: space.space_available_size,
          physical: space.physical_space_size,
        })),
        gc: {
          total: { ...this.gcTotal },
          sinceLast: gcSince,
          kinds: Object.fromEntries(Object.entries(this.gcKinds).map(([kind, bucket]) => [kind, { ...bucket }])),
        },
        eventLoop: {
          min: this.lag.count > 0 ? this.lag.min / 1e6 : 0,
          max: this.lag.count > 0 ? this.lag.max / 1e6 : 0,
          mean: this.lag.count > 0 ? this.lag.mean / 1e6 : 0,
          stddev: this.lag.count > 0 ? this.lag.stddev / 1e6 : 0,
          p50: this.lag.count > 0 ? this.lag.percentile(50) / 1e6 : 0,
          p95: this.lag.count > 0 ? this.lag.percentile(95) / 1e6 : 0,
          p99: this.lag.count > 0 ? this.lag.percentile(99) / 1e6 : 0,
          utilization: elu.utilization * 100,
        },
        resources: {
          handles: resources.handles,
          requests: resources.requests,
          byType: resources.byType,
          fileDescriptors: openFileDescriptors(),
        },
        usage: {
          maxRss: usage.maxRSS * 1024,
          minorPageFaults: usage.minorPageFault,
          majorPageFaults: usage.majorPageFault,
          voluntaryContextSwitches: usage.voluntaryContextSwitches,
          involuntaryContextSwitches: usage.involuntaryContextSwitches,
          fsRead: usage.fsRead,
          fsWrite: usage.fsWrite,
          swappedOut: usage.swappedOut,
          signals: usage.signalsCount,
          ipcSent: usage.ipcSent,
          ipcReceived: usage.ipcReceived,
        },
      },
      host: {
        uptime: Math.floor(os.uptime()),
        cpu: {
          percent: hostTotal > 0 ? clamp(100 * (1 - hostIdle / hostTotal)) : 0,
          perCore,
          load: [load[0] ?? 0, load[1] ?? 0, load[2] ?? 0],
        },
        memory: { total: totalMemory, free: freeMemory, used: usedMemory, percent: totalMemory > 0 ? (usedMemory / totalMemory) * 100 : 0 },
        disk: diskUsage(),
        network: this.networkThroughput(),
        container: this.containerLimits(),
      },
    };

    this.previousCpu = cpu;
    this.previousTime = now;
    this.previousCores = cores;
    this.previousElu = eventLoopUtilization();
    this.lag.reset();
    return sample;
  }

  private networkThroughput(): ServerSample['host']['network'] {
    if (process.platform !== 'linux') return null;
    try {
      let rx = 0;
      let tx = 0;
      for (const line of readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2)) {
        const [name, values] = line.split(':');
        if (!name || !values || name.trim() === 'lo') continue;
        const fields = values.trim().split(/\s+/);
        rx += Number(fields[0] ?? 0);
        tx += Number(fields[8] ?? 0);
      }
      const at = Date.now();
      const previous = this.previousNetwork;
      this.previousNetwork = { rx, tx, at };
      const seconds = previous ? (at - previous.at) / 1000 : 0;
      return {
        rxBytes: rx,
        txBytes: tx,
        rxBytesPerSecond: previous && seconds > 0 ? Math.max(0, (rx - previous.rx) / seconds) : 0,
        txBytesPerSecond: previous && seconds > 0 ? Math.max(0, (tx - previous.tx) / seconds) : 0,
      };
    } catch {
      return null;
    }
  }

  private containerLimits(): ServerSample['host']['container'] {
    if (this.cgroup === 'none') return null;
    if (this.cgroup === 'unknown') {
      this.cgroup = existsSync('/sys/fs/cgroup/memory.max') ? 'v2' : existsSync('/sys/fs/cgroup/memory/memory.limit_in_bytes') ? 'v1' : 'none';
      if (this.cgroup === 'none') return null;
    }
    const read = (path: string): string | null => safe(() => readFileSync(path, 'utf8').trim(), null);
    const bytes = (value: string | null): number | null => {
      if (value === null || value === 'max') return null;
      const parsed = Number(value);
      // cgroup v1 reports "no limit" as a very large number close to the platform maximum.
      return Number.isFinite(parsed) && parsed > 0 && parsed < 2 ** 60 ? parsed : null;
    };
    if (this.cgroup === 'v2') {
      const cpuMax = read('/sys/fs/cgroup/cpu.max');
      const [quota, period] = cpuMax ? cpuMax.split(/\s+/) : [];
      return {
        memoryLimit: bytes(read('/sys/fs/cgroup/memory.max')),
        memoryUsage: bytes(read('/sys/fs/cgroup/memory.current')),
        cpuLimit: quota && quota !== 'max' && period ? Number(quota) / Number(period) : null,
      };
    }
    const quota = Number(read('/sys/fs/cgroup/cpu/cpu.cfs_quota_us') ?? -1);
    const period = Number(read('/sys/fs/cgroup/cpu/cpu.cfs_period_us') ?? 0);
    return {
      memoryLimit: bytes(read('/sys/fs/cgroup/memory/memory.limit_in_bytes')),
      memoryUsage: bytes(read('/sys/fs/cgroup/memory/memory.usage_in_bytes')),
      cpuLimit: quota > 0 && period > 0 ? quota / period : null,
    };
  }
}

export function toServerPoint(sample: ServerSample): ServerPoint {
  return {
    time: sample.time,
    hostCpu: sample.host.cpu.percent,
    processCpu: sample.process.cpu.percent,
    memoryPercent: sample.host.memory.percent,
    memoryUsed: sample.host.memory.used,
    rss: sample.process.memory.rss,
    heapUsed: sample.process.memory.heapUsed,
    heapPercent: sample.process.memory.heapPercent,
    external: sample.process.memory.external,
    eventLoopP50: sample.process.eventLoop.p50,
    eventLoopP95: sample.process.eventLoop.p95,
    eventLoopP99: sample.process.eventLoop.p99,
    eventLoopMax: sample.process.eventLoop.max,
    eventLoopUtilization: sample.process.eventLoop.utilization,
    load1: sample.host.cpu.load[0],
    gcCount: sample.process.gc.sinceLast.count,
    gcPauseMs: sample.process.gc.sinceLast.pauseMs,
    handles: sample.process.resources.handles,
    requests: sample.process.resources.requests,
    rxBytesPerSecond: sample.host.network?.rxBytesPerSecond ?? 0,
    txBytesPerSecond: sample.host.network?.txBytesPerSecond ?? 0,
  };
}

/** Averages a group of points into one (sums for GC counters), used for the long-range history. */
export function aggregatePoints(points: ServerPoint[]): ServerPoint | null {
  const first = points[0];
  if (!first) return null;
  const result = { ...first };
  const keys = Object.keys(first).filter((key) => key !== 'time') as Array<Exclude<keyof ServerPoint, 'time'>>;
  for (const key of keys) {
    const total = points.reduce((sum, point) => sum + point[key], 0);
    result[key] = key === 'gcCount' || key === 'gcPauseMs' ? total : total / points.length;
  }
  return result;
}

function coreTimes(): Array<{ idle: number; total: number }> {
  return os.cpus().map((cpu) => ({
    idle: cpu.times.idle,
    total: Object.values(cpu.times).reduce((a, b) => a + b, 0),
  }));
}

function eventLoopUtilization(previous?: ReturnType<typeof performance.eventLoopUtilization>) {
  if (typeof performance.eventLoopUtilization !== 'function') return { idle: 0, active: 0, utilization: 0 };
  return previous ? performance.eventLoopUtilization(previous) : performance.eventLoopUtilization();
}

// Request wraps as named by Node (TCPConnectWrap, WriteWrap, FSReqCallback, GetAddrInfoReqWrap, ...).
const REQUEST_RESOURCE = /(Req(Wrap|Callback|Promise)?|ConnectWrap|WriteWrap|ShutdownWrap|QueryWrap|SendWrap)$/;
// Timers and immediates are scheduled callbacks, neither libuv handles nor requests.
const SCHEDULED_RESOURCE = new Set(['Timeout', 'Immediate']);

// Only the public process.getActiveResourcesInfo() is used here. The internal
// process._getActiveHandles() / _getActiveRequests() abort the whole process with
// "Assertion failed: !obj.IsEmpty()" (node::AsyncWrap::GetOwner) when a handle is
// being torn down while it runs, which is not something a try/catch can recover from.
function activeResources(): { handles: number; requests: number; byType: Record<string, number> } {
  const byType: Record<string, number> = {};
  let handles = 0;
  let requests = 0;
  const getInfo = (process as { getActiveResourcesInfo?: () => string[] }).getActiveResourcesInfo;
  const types = typeof getInfo === 'function' ? safe(() => getInfo.call(process), [] as string[]) : [];
  for (const type of types) {
    byType[type] = (byType[type] ?? 0) + 1;
    if (SCHEDULED_RESOURCE.has(type)) continue;
    if (REQUEST_RESOURCE.test(type)) requests += 1;
    else handles += 1;
  }
  return { handles, requests, byType };
}

function openFileDescriptors(): number | null {
  if (process.platform !== 'linux') return null;
  return safe(() => readdirSync('/proc/self/fd').length, null);
}

function diskUsage(): ServerSample['host']['disk'] {
  if (typeof statfsSync !== 'function') return null;
  const path = safe(() => process.cwd(), '/');
  return safe(() => {
    const stats = statfsSync(path);
    const total = Number(stats.blocks) * Number(stats.bsize);
    const free = Number(stats.bavail) * Number(stats.bsize);
    const used = (Number(stats.blocks) - Number(stats.bfree)) * Number(stats.bsize);
    return { path, total, free, used, percent: total > 0 ? (used / total) * 100 : 0 };
  }, null);
}

function clamp(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function safe<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}
