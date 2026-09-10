export function renderPulseDashboard(input: { serviceId: string; environment: string; basePath: string; nonce?: string }): string {
  const { nonce, ...publicConfig } = input;
  const config = JSON.stringify(publicConfig).replaceAll('<', '\\u003c');
  // The nonce lets the dashboard run under a strict Content-Security-Policy (for example when the host app uses helmet).
  const scriptTag = nonce ? `<script nonce="${nonce}">` : '<script>';

  // The page is one self-contained document: styles, markup and a single inline script. The script is written with
  // string concatenation only (no template literals) because it lives inside this String.raw template.
  return String.raw`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Pulse Observability</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #080808;
      --bg-2: #0E0E0E;
      --card: #121212;
      --card-hover: #181818;
      --border: #242424;
      --border-2: #2e2e2e;
      --red: #E0234E;
      --red-hot: #FF2D55;
      --red-dark: #8F1533;
      --text: #F5F5F5;
      --muted: #9B9B9B;
      --disabled: #626262;
      --green: #22C55E;
      --warning: #F59E0B;
      --critical: #EF4444;
      --purple: #8B5CF6;
      --orange: #F97316;
      --blue: #38BDF8;
      --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font: 13px/1.5 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }
    button, select, input { font: inherit; }
    a { color: inherit; }
    .app { min-height: 100vh; display: grid; grid-template-columns: 230px minmax(0, 1fr); }
    .sidebar {
      position: fixed;
      inset: 0 auto 0 0;
      width: 230px;
      background: #090909;
      border-right: 1px solid var(--border);
      padding: 18px 12px;
      overflow-y: auto;
    }
    .brand { display: flex; gap: 10px; align-items: center; padding: 2px 6px 18px; }
    .mark {
      width: 28px; height: 28px; border-radius: 7px;
      display: grid; place-items: center;
      background: linear-gradient(145deg, var(--red), var(--red-dark));
      box-shadow: 0 0 28px rgba(224, 35, 78, .28);
      font-weight: 800;
    }
    .brand strong { display: block; font-size: 14px; }
    .brand span { color: var(--muted); font-size: 12px; display: block; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .env {
      width: calc(100% - 12px);
      margin: 0 6px 16px;
      background: var(--bg-2);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 7px;
      padding: 8px 10px;
    }
    .nav { display: grid; gap: 3px; }
    .nav .group { color: var(--disabled); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; padding: 12px 14px 4px; }
    .nav button {
      position: relative;
      height: 34px;
      border: 0;
      border-radius: 7px;
      background: transparent;
      color: var(--muted);
      text-align: left;
      padding: 0 10px 0 14px;
      cursor: pointer;
      display: flex; align-items: center; justify-content: space-between;
    }
    .nav button:hover { background: var(--card); color: var(--text); }
    .nav button.active { background: rgba(143, 21, 51, .32); color: var(--text); }
    .nav button.active:before {
      content: "";
      position: absolute;
      left: 0; top: 7px; bottom: 7px; width: 2px;
      border-radius: 2px;
      background: var(--red-hot);
    }
    .nav .count { font-size: 11px; color: var(--muted); background: var(--bg-2); border: 1px solid var(--border); border-radius: 999px; padding: 0 7px; line-height: 18px; }
    .nav .count.bad { color: #fda4af; border-color: rgba(224, 35, 78, .4); }
    main { grid-column: 2; min-width: 0; }
    .header {
      position: sticky;
      top: 0;
      z-index: 5;
      min-height: 64px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      padding: 0 24px;
      background: rgba(8, 8, 8, .88);
      border-bottom: 1px solid var(--border);
      backdrop-filter: blur(14px);
    }
    .title strong { display: block; font-size: 15px; }
    .title span { color: var(--muted); font-size: 12px; }
    .tools { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    .icon-btn, .btn {
      height: 32px;
      border: 1px solid var(--border);
      border-radius: 7px;
      background: var(--bg-2);
      color: var(--text);
      padding: 0 10px;
      cursor: pointer;
      min-width: 34px;
    }
    .btn.small { height: 26px; font-size: 12px; padding: 0 8px; color: var(--muted); }
    .btn.small:hover, .icon-btn:hover { color: var(--text); border-color: var(--border-2); }
    .btn.paused { color: var(--warning); border-color: rgba(245, 158, 11, .4); }
    .live, .health { display: inline-flex; align-items: center; gap: 7px; color: var(--muted); }
    .dot { width: 7px; height: 7px; border-radius: 999px; background: var(--green); box-shadow: 0 0 16px rgba(34, 197, 94, .48); }
    .content { padding: 24px; max-width: 1560px; }
    .section-title { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 26px 0 10px; }
    .section-title h2 { margin: 0; font-size: 13px; font-weight: 700; letter-spacing: .01em; }
    .section-title span { color: var(--muted); font-size: 12px; }
    .metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .metrics.six { grid-template-columns: repeat(6, minmax(0, 1fr)); }
    .metrics.four { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .card {
      min-height: 116px;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px;
      overflow: hidden;
      position: relative;
      min-width: 0;
    }
    .card:hover { background: var(--card-hover); }
    .card.compact { min-height: 92px; padding: 12px 14px; }
    .card.compact .value { font-size: 20px; margin-top: 4px; }
    .label { color: var(--muted); font-size: 12px; }
    .value { font-size: 26px; font-weight: 720; margin-top: 8px; line-height: 1.05; overflow-wrap: anywhere; }
    .value small { font-size: 13px; font-weight: 500; color: var(--muted); margin-left: 4px; }
    .delta { margin-top: 8px; color: var(--muted); font-size: 12px; min-height: 18px; overflow-wrap: anywhere; }
    .delta.good { color: var(--green); }
    .delta.bad { color: var(--critical); }
    .spark { width: 100%; height: 28px; margin-top: 8px; display: block; }
    .grid { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(320px, .9fr); gap: 12px; margin-top: 12px; }
    .grid.even { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .panel { border-top: 1px solid var(--border); min-width: 0; }
    .panel.boxed { border: 1px solid var(--border); border-radius: 8px; background: var(--card); }
    .panel.boxed .panel-head { padding: 0 14px; }
    .panel.boxed .panel-body { padding: 14px; }
    .panel-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      min-height: 48px;
      border-bottom: 1px solid var(--border);
      padding: 10px 0;
      flex-wrap: wrap;
    }
    .panel-head strong { font-size: 13px; }
    .panel-head .label { overflow-wrap: anywhere; }
    .tabs { display: flex; gap: 4px; flex-wrap: wrap; }
    .tabs button {
      height: 28px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--bg-2);
      color: var(--muted);
      padding: 0 9px;
      cursor: pointer;
    }
    .tabs button.active { background: rgba(224, 35, 78, .14); border-color: rgba(224, 35, 78, .42); color: var(--text); }
    .chart { width: 100%; height: 300px; display: block; }
    .chart-wrap { position: relative; }
    .tooltip {
      position: absolute; pointer-events: none; z-index: 3;
      background: rgba(14, 14, 14, .96); border: 1px solid var(--border-2); border-radius: 6px;
      padding: 6px 9px; font-size: 12px; color: var(--text); white-space: nowrap; display: none;
      box-shadow: 0 8px 24px rgba(0,0,0,.4);
    }
    .tooltip .label { display: block; }
    .legend { display: flex; gap: 14px; flex-wrap: wrap; color: var(--muted); font-size: 12px; padding: 8px 0 0; }
    .legend i { display: inline-block; width: 10px; height: 3px; border-radius: 2px; margin-right: 6px; vertical-align: middle; }
    .server-meta { display: flex; flex-wrap: wrap; gap: 8px 16px; margin: 0 0 18px; color: var(--muted); overflow-wrap: anywhere; align-items: center; }
    .server-meta b { color: var(--text); font-weight: 600; }
    .errors-list { display:grid; gap:0; }
    .error-item { border-bottom:1px solid var(--border); padding:14px 0; min-width:0; }
    .error-item summary { cursor:pointer; overflow-wrap:anywhere; color:#fda4af; }
    .error-item pre { white-space:pre-wrap; overflow-wrap:anywhere; color:var(--muted); font-size:12px; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border-bottom: 1px solid var(--border); padding: 9px 12px; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; vertical-align: middle; }
    th { color: var(--muted); font-size: 11px; font-weight: 600; }
    th.sortable { cursor: pointer; user-select: none; }
    th.sortable:hover { color: var(--text); }
    th.sorted { color: var(--text); }
    td { color: #d8d8d8; }
    td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
    td.wrap { white-space: normal; overflow-wrap: anywhere; }
    tr.slow td { background: rgba(224, 35, 78, .045); }
    tr.clickable { cursor: pointer; }
    tr.clickable:hover td { background: var(--card-hover); }
    tr.selected td { background: rgba(224, 35, 78, .12); }
    .kv { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px 16px; padding: 12px 16px 16px; }
    .kv > div { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .subhead { border-top: 1px solid var(--border); }
    .table-scroll { overflow-x: auto; }
    .badge { display: inline-flex; align-items: center; height: 20px; padding: 0 7px; border-radius: 5px; border: 1px solid transparent; font-size: 11px; font-weight: 700; white-space: nowrap; vertical-align: middle; }
    .badge.mono { font-family: var(--mono); font-weight: 600; }
    .GET, .b-2xx, .b-ok { background: rgba(34, 197, 94, .12); color: #86efac; border-color: rgba(34, 197, 94, .24); }
    .POST, .b-5xx, .b-server { background: rgba(224, 35, 78, .14); color: #fb7185; border-color: rgba(224, 35, 78, .28); }
    .PUT, .PATCH, .b-4xx, .b-client, .b-process { background: rgba(245, 158, 11, .14); color: #fbbf24; border-color: rgba(245, 158, 11, .28); }
    .DELETE { background: rgba(239, 68, 68, .16); color: #f87171; border-color: rgba(239, 68, 68, .32); }
    .b-3xx, .b-internal, .b-kind { background: rgba(139, 92, 246, .14); color: #c4b5fd; border-color: rgba(139, 92, 246, .3); }
    .b-muted { background: var(--bg-2); color: var(--muted); border-color: var(--border); }
    .b-blue { background: rgba(56, 189, 248, .12); color: #7dd3fc; border-color: rgba(56, 189, 248, .3); }
    .bar-line { height: 6px; background: #0a0a0a; border: 1px solid var(--border); border-radius: 4px; overflow: hidden; margin-top: 10px; }
    .bar-line > i { display: block; height: 100%; background: linear-gradient(90deg, var(--red), var(--red-hot)); }
    .bar-line.green > i { background: var(--green); }
    .bar-line.warn > i { background: var(--warning); }
    .bar-line.purple > i { background: var(--purple); }
    .bar-line.blue > i { background: var(--blue); }
    .cores { display: grid; grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); gap: 8px; }
    .core { background: var(--bg-2); border: 1px solid var(--border); border-radius: 6px; padding: 8px; font-size: 11px; color: var(--muted); }
    .core b { color: var(--text); display: block; font-size: 13px; }
    .core .bar-line { margin-top: 6px; height: 5px; }
    .kvt { display: grid; grid-template-columns: minmax(120px, 190px) minmax(0, 1fr); gap: 0; }
    .kvt > div { padding: 7px 12px; border-bottom: 1px solid var(--border); overflow-wrap: anywhere; min-width: 0; }
    .kvt > div:nth-child(odd) { color: var(--muted); }
    .toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 0 0 12px; }
    .toolbar .spacer { flex: 1; }
    .search { height: 30px; border: 1px solid var(--border); border-radius: 7px; background: var(--bg-2); color: var(--text); padding: 0 10px; min-width: 220px; }
    .search:focus { outline: none; border-color: rgba(224, 35, 78, .5); }
    .two-col { display: grid; grid-template-columns: minmax(300px, 1fr) minmax(0, 1.6fr); gap: 12px; align-items: start; }
    .two-col.traces { grid-template-columns: minmax(360px, 1.1fr) minmax(0, 1.3fr); }
    .err-list { display: grid; gap: 6px; }
    .err-item { border: 1px solid var(--border); border-radius: 8px; background: var(--card); padding: 12px 14px; cursor: pointer; min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) 80px; gap: 10px; }
    .err-item:hover { background: var(--card-hover); }
    .err-item.selected { border-color: rgba(224, 35, 78, .55); background: rgba(224, 35, 78, .06); }
    .err-item .name { color: #fda4af; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .err-item .msg { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px; }
    .err-item .meta { color: var(--muted); font-size: 11px; margin-top: 6px; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .err-item .side { text-align: right; }
    .err-item .side b { display: block; font-size: 18px; font-weight: 720; }
    .err-item .side canvas { width: 80px; height: 22px; display: block; margin-top: 4px; }
    .err-detail { border: 1px solid var(--border); border-radius: 8px; background: var(--card); min-width: 0; position: sticky; top: 76px; max-height: calc(100vh - 100px); overflow: auto; }
    .err-detail .head { padding: 14px 16px; border-bottom: 1px solid var(--border); }
    .err-detail h3 { margin: 0; font-size: 15px; overflow-wrap: anywhere; }
    .err-detail h3 span { color: var(--muted); font-weight: 500; }
    .err-detail .badges { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
    .err-detail .block { padding: 12px 16px; border-bottom: 1px solid var(--border); }
    .err-detail .block:last-child { border-bottom: 0; }
    .err-detail .block h4 { margin: 0 0 8px; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
    .meta-grid .label { font-size: 11px; }
    .meta-grid b { display: block; font-weight: 600; overflow-wrap: anywhere; }
    .samples { display: grid; gap: 2px; max-height: 190px; overflow: auto; }
    .sample { display: grid; grid-template-columns: 74px minmax(0, 1fr) auto; gap: 8px; padding: 6px 8px; border-radius: 6px; cursor: pointer; font-size: 12px; color: var(--muted); align-items: center; }
    .sample:hover { background: var(--card-hover); }
    .sample.selected { background: rgba(224, 35, 78, .12); color: var(--text); }
    .sample .r { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .frames { font-family: var(--mono); font-size: 12px; display: grid; gap: 1px; }
    .frame { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 8px; padding: 5px 8px; border-radius: 5px; color: var(--muted); }
    .frame.in-app { color: var(--text); background: rgba(224, 35, 78, .07); }
    .frame .fn { color: inherit; overflow-wrap: anywhere; }
    .frame.in-app .fn { color: #fda4af; }
    .frame .loc { overflow-wrap: anywhere; color: var(--muted); }
    .frame.in-app .loc { color: #d8d8d8; }
    .frame .n { color: var(--disabled); text-align: right; }
    pre.stack { white-space: pre-wrap; overflow-wrap: anywhere; color: var(--muted); font-size: 12px; font-family: var(--mono); margin: 0; background: #0a0a0a; border: 1px solid var(--border); border-radius: 6px; padding: 10px; max-height: 360px; overflow: auto; }
    .cause { border-left: 2px solid rgba(245, 158, 11, .5); padding-left: 10px; margin-top: 8px; }
    .cause .title { color: #fbbf24; font-weight: 600; overflow-wrap: anywhere; }
    .waterfall { display: grid; gap: 4px; padding: 10px 0; overflow-x: auto; }
    .span-row { display: grid; grid-template-columns: minmax(0, 300px) minmax(160px, 1fr) 70px; gap: 10px; align-items: center; color: var(--muted); font-size: 12px; padding: 3px 0; border-radius: 4px; }
    .span-row.clickable { cursor: pointer; }
    .span-row.clickable:hover, .span-row.selected { background: var(--card-hover); }
    .span-row .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); display: flex; align-items: center; gap: 6px; }
    .span-row .nm i { width: 8px; height: 8px; border-radius: 2px; flex: none; display: inline-block; }
    .span-row .nm .err { color: #fb7185; font-weight: 700; }
    .span-row .dur { text-align: right; font-variant-numeric: tabular-nums; }
    .bar-track { height: 12px; background: #0a0a0a; border: 1px solid var(--border); border-radius: 4px; overflow: hidden; position: relative; }
    .bar { height: 100%; background: linear-gradient(90deg, var(--red), var(--red-hot)); position: absolute; top: 0; border-radius: 2px; min-width: 2px; }
    .bar.k-handler { background: var(--orange); }
    .bar.k-database { background: var(--purple); }
    .bar.k-redis { background: var(--green); }
    .bar.k-job { background: var(--blue); }
    .bar.k-internal { background: #6b7280; }
    .bar.k-process { background: var(--warning); }
    .bar.error { outline: 1px solid var(--critical); }
    .empty { min-height: 200px; display: grid; place-items: center; color: var(--disabled); padding: 24px; text-align: center; }
    .empty.small { min-height: 80px; padding: 12px; }
    .muted { color: var(--muted); }
    .mono { font-family: var(--mono); font-size: 12px; }
    .rel { color: var(--muted); font-size: 11px; }
    .status-bar { display: flex; height: 10px; border-radius: 5px; overflow: hidden; border: 1px solid var(--border); background: #0a0a0a; margin: 12px 0 8px; }
    .status-bar i { display: block; height: 100%; }
    .s-2xx { background: var(--green); } .s-3xx { background: var(--purple); } .s-4xx { background: var(--warning); } .s-5xx { background: var(--critical); } .s-1xx { background: var(--blue); }
    .chips { display: flex; gap: 6px 12px; flex-wrap: wrap; font-size: 12px; color: var(--muted); }
    .chips span i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 5px; vertical-align: middle; }
    details.raw summary { cursor: pointer; color: var(--muted); font-size: 12px; margin-bottom: 6px; }
    .events { display: grid; gap: 6px; }
    .event { border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; background: var(--card); }
    .event .t { color: #fbbf24; font-weight: 600; overflow-wrap: anywhere; }
    tr.request-row:focus-visible { outline: 2px solid rgba(224, 35, 78, .6); outline-offset: -2px; }
    tr.request-row.selected td { background: rgba(224, 35, 78, .12); }
    /* Requests: painel lateral (Sheet) */
    body.sheet-open { overflow: hidden; }
    .sheet-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, .6); backdrop-filter: blur(2px); z-index: 60; animation: sheet-fade .15s ease-out; }
    .sheet { position: fixed; top: 0; right: 0; bottom: 0; width: min(780px, 100vw); background: var(--bg-2); border-left: 1px solid var(--border); box-shadow: -30px 0 80px rgba(0, 0, 0, .55); z-index: 61; display: flex; flex-direction: column; animation: sheet-slide .22s cubic-bezier(.32, .72, 0, 1); }
    @keyframes sheet-slide { from { transform: translateX(100%); } to { transform: none; } }
    @keyframes sheet-fade { from { opacity: 0; } to { opacity: 1; } }
    .sheet-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 16px 18px; border-bottom: 1px solid var(--border); background: var(--card); }
    .sheet-head h3 { margin: 0; font-size: 15px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; overflow-wrap: anywhere; }
    .sheet-head .badges, .sheet-body .badges { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
    .sheet-close { flex: none; width: 30px; height: 30px; font-size: 18px; line-height: 1; }
    .sheet-body { overflow: auto; flex: 1; min-height: 0; }
    .sheet-body .block { padding: 12px 18px; border-bottom: 1px solid var(--border); }
    .sheet-body > div:last-child > .block:last-child { border-bottom: 0; }
    .sheet-body .block h4 { margin: 0 0 8px; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .sheet-body .title { overflow-wrap: anywhere; }
    .sheet-body .samples { max-height: 220px; }
    @media (max-width: 720px) { .sheet { width: 100vw; } }
    .request-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; padding: 10px 16px; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
    .request-item { border-bottom: 1px solid var(--border); padding: 8px 16px 12px; min-width: 0; }
    .request-item:last-child { border-bottom: 0; }
    .request-item > summary { cursor: pointer; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; overflow-wrap: anywhere; padding: 4px 0; list-style: none; }
    .request-item > summary::-webkit-details-marker { display: none; }
    .request-item > summary::before { content: "▸"; color: var(--muted); }
    .request-item[open] > summary::before { content: "▾"; color: var(--text); }
    .request-item .kvt { margin-top: 8px; border-top: 1px solid var(--border); }
    .request-item .kvt > div { padding: 5px 10px; }
    .request-item .waterfall { padding: 6px 0 0; }
    @media (max-width: 1240px) {
      .metrics.six { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .metrics.four { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .two-col { grid-template-columns: 1fr; }
      .err-detail { position: static; max-height: none; }
    }
    @media (max-width: 980px) {
      .app { display: block; }
      .sidebar { position: static; width: auto; height: auto; }
      main { grid-column: auto; }
      .metrics, .metrics.six, .metrics.four { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .grid, .grid.even { grid-template-columns: 1fr; }
      .header { position: static; height: auto; min-height: 64px; align-items: flex-start; padding: 14px; flex-direction: column; }
      .content { padding: 14px; }
      .span-row { grid-template-columns: minmax(0, 150px) minmax(100px, 1fr) 60px; }
    }
  </style>
</head>
<body>
  <div class="app">
    <aside class="sidebar">
      <div class="brand">
        <div class="mark">P</div>
        <div><strong>Pulse</strong><span id="serviceName"></span></div>
      </div>
      <select class="env" id="environment">
        <option>Production</option><option>Staging</option><option>Development</option>
      </select>
      <nav class="nav" id="nav"></nav>
    </aside>
    <main>
      <header class="header">
        <div class="title"><strong id="projectTitle"></strong><span id="projectMeta"></span></div>
        <div class="tools">
          <button class="btn" id="live" title="Pausar ou retomar a atualização automática">Ao vivo</button>
          <button class="icon-btn" id="refresh" title="Atualizar" aria-label="Atualizar">↻</button>
          <span class="live" id="liveState"><span class="dot"></span>Conectando</span>
          <span class="health" id="health"><span class="dot"></span>—</span>
        </div>
      </header>
      <section class="content" id="content"></section>
      <div class="tooltip" id="tooltip"></div>
    </main>
  </div>
  ${scriptTag}
    window.__PULSE__ = ${config};
    const menu = [
      { group: 'Aplicação', items: ['Visão geral', 'Erros', 'Requests', 'Traces', 'Métricas'] },
      { group: 'Infraestrutura', items: ['Servidor', 'Redis', 'Banco de dados', 'Queues', 'Jobs'] },
    ];
    const pages = menu.flatMap((entry) => entry.items);
    const hashState = readHash();
    const state = {
      page: pages.includes(hashState.page) ? hashState.page : 'Visão geral',
      snapshot: null,
      live: true,
      range: '10m',
      metric: { overview: 'requests', server: 'hostCpu' },
      errorFilter: 'all',
      selectedError: hashState.error || null,
      errorDetail: null,
      selectedSample: 0,
      trace: null,
      traceId: hashState.trace || null,
      selectedSpan: null,
      sort: { key: 'requests', dir: 'desc' },
      search: '',
      allFrames: false,
      rabbitQueue: null,
      rabbitQueueDetail: null,
    };
    const charts = new Map();
    // Callbacks run after every render() (fresh snapshot or state change); overlays rendered outside #content use it.
    const afterRender = [];
    const nav = document.querySelector('#nav');
    const content = document.querySelector('#content');
    const tooltip = document.querySelector('#tooltip');
    document.querySelector('#serviceName').textContent = window.__PULSE__.serviceId;
    document.querySelector('#projectTitle').textContent = window.__PULSE__.serviceId;
    document.querySelector('#projectMeta').textContent = window.__PULSE__.environment;
    document.querySelector('#environment').value = window.__PULSE__.environment;
    document.querySelector('#environment').disabled = true;
    nav.innerHTML = menu.map((entry) => '<div class="group">' + entry.group + '</div>' + entry.items.map((item) => '<button data-page="' + item + '"><span>' + item + '</span><span class="count" data-count="' + item + '" hidden></span></button>').join('')).join('');
    nav.addEventListener('click', (event) => {
      const target = event.target.closest('button[data-page]');
      if (!target) return;
      state.page = target.dataset.page;
      state.search = '';
      writeHash();
      render();
      window.scrollTo(0, 0);
      if (state.page === 'Queues') loadRabbitQueue().then(render);
    });
    document.querySelector('#refresh').addEventListener('click', () => load(true));
    document.querySelector('#live').addEventListener('click', () => {
      state.live = !state.live;
      const button = document.querySelector('#live');
      button.textContent = state.live ? 'Ao vivo' : 'Pausado';
      button.classList.toggle('paused', !state.live);
      if (state.live) load(true);
    });

    function readHash() {
      const params = new URLSearchParams(location.hash.replace(/^#\??/, ''));
      return { page: params.get('page') || '', error: params.get('error') || '', trace: params.get('trace') || '' };
    }
    function writeHash() {
      const params = new URLSearchParams();
      params.set('page', state.page);
      if (state.selectedError) params.set('error', state.selectedError);
      if (state.traceId) params.set('trace', state.traceId);
      history.replaceState(null, '', '#' + params.toString());
    }

    async function api(path) {
      const response = await fetch(window.__PULSE__.basePath + '/api/' + path, { headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    }
    async function load(force) {
      if (!state.live && !force) return;
      try {
        const [snapshot, detail, trace] = await Promise.all([
          api('snapshot'),
          state.selectedError ? api('errors/' + encodeURIComponent(state.selectedError)).catch(() => null) : Promise.resolve(state.errorDetail),
          state.traceId ? api('traces/' + encodeURIComponent(state.traceId)).catch(() => null) : Promise.resolve(null),
        ]);
        state.snapshot = snapshot;
        state.errorDetail = detail;
        if (trace) state.trace = trace;
        if (state.page === 'Queues') await loadRabbitQueue();
        document.querySelector('#liveState').innerHTML = '<span class="dot"></span>' + (state.live ? 'Ao vivo' : 'Pausado') + ' · ' + time(snapshot.generatedAt);
        render();
      } catch (error) {
        document.querySelector('#liveState').innerHTML = '<span class="dot" style="background:#EF4444;box-shadow:none"></span>Sem conexão';
        if (!state.snapshot) content.innerHTML = '<div class="empty">Telemetria indisponível: ' + escapeHtml(error.message) + '</div>';
      }
    }

    function render() {
      [...nav.querySelectorAll('button[data-page]')].forEach((button) => button.classList.toggle('active', button.dataset.page === state.page));
      if (!state.snapshot) {
        content.innerHTML = '<div class="empty">Aguardando telemetria...</div>';
        return;
      }
      // Do not replace the DOM while the user is selecting text (copying a stack trace, for example).
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.anchorNode && content.contains(selection.anchorNode)) return;
      const s = state.snapshot;
      const status = s.service.status;
      document.querySelector('#health').innerHTML = '<span class="dot" style="background:' + (status === 'critical' ? '#EF4444' : status === 'degraded' ? '#F59E0B' : '#22C55E') + ';box-shadow:none"></span>' + labelStatus(status);
      document.querySelector('#projectMeta').textContent = (s.service.environment || window.__PULSE__.environment) + (s.serverInfo ? ' · ' + s.serverInfo.host : '') + (s.service.version ? ' · v' + s.service.version : '') + ' · uptime ' + duration(s.server ? s.server.process.uptime : 0);
      badgeCount('Erros', s.errorSummary.server + s.errorSummary.process, true);
      badgeCount('Requests', s.overview.requestsPerMinute, false);
      // Open <details> elements keep their state across refreshes (identified by data-key or data-error).
      const expanded = new Set([...content.querySelectorAll('details[open]')].map((item) => item.dataset.key || item.dataset.error || ''));
      const active = document.activeElement;
      const focusSearch = active && active.matches && active.matches('input[data-search]') ? { start: active.selectionStart } : null;
      const scrollers = {};
      content.querySelectorAll('[data-scroll]').forEach((element) => { scrollers[element.dataset.scroll] = element.scrollTop; });
      content.innerHTML = renderPage(state.page);
      content.querySelectorAll('details[data-key], details[data-error]').forEach((item) => { if (expanded.has(item.dataset.key || item.dataset.error)) item.open = true; });
      content.querySelectorAll('[data-scroll]').forEach((element) => { if (scrollers[element.dataset.scroll] !== undefined) element.scrollTop = scrollers[element.dataset.scroll]; });
      if (focusSearch) {
        const input = content.querySelector('input[data-search]');
        if (input) { input.focus(); try { input.setSelectionRange(focusSearch.start, focusSearch.start); } catch (error) { /* not selectable */ } }
      }
      drawCharts();
      afterRender.forEach((callback) => { try { callback(); } catch (error) { console.error(error); } });
    }
    function badgeCount(page, value, bad) {
      const element = nav.querySelector('[data-count="' + page + '"]');
      if (!element) return;
      element.hidden = !value;
      element.textContent = compact(value);
      element.classList.toggle('bad', bad && value > 0);
    }
    function renderPage(page) {
      if (page === 'Visão geral') return overviewPage();
      if (page === 'Servidor') return serverPage();
      if (page === 'Erros') return errorsPage();
      if (page === 'Requests') return requestsPage();
      if (page === 'Traces') return tracesPage();
      if (page === 'Métricas') return metricsPage();
      if (page === 'Banco de dados') return databasePage();
      if (page === 'Queues') return queuesPage();
      if (page === 'Jobs') return jobsPage();
      if (page === 'Redis') return redisPage();
      return '<div class="empty">Página desconhecida</div>';
    }

    /* ---------- Visão geral ---------- */
    function overviewPage() {
      const s = state.snapshot;
      const o = s.overview;
      const server = s.server;
      const http = s.http;
      const metricKey = state.metric.overview;
      const series = overviewSeries(metricKey);
      return '<div class="metrics six">' +
        metric('Requisições / min', compact(o.requestsPerMinute), trendText(o.trend.requests) + ' · ' + o.requestsPerSecond.toFixed(2) + ' rps', trendClass(o.trend.requests, false), 'requests') +
        metric('Erros 5xx', o.errorRate.toFixed(2) + '%', trendText(o.trend.errorRate) + ' · ' + (o.statusClasses['5xx'] || 0) + ' respostas', o.errorRate >= 1 ? 'bad' : trendClass(o.trend.errorRate, true), 'errors') +
        metric('Erros 4xx', o.clientErrorRate.toFixed(2) + '%', (o.statusClasses['4xx'] || 0) + ' respostas', o.clientErrorRate > 20 ? 'bad' : '', 'clientErrors') +
        metric('Latência p95', o.p95Latency + '<small>ms</small>', trendText(o.trend.p95) + ' · p50 ' + o.p50Latency + ' ms · p99 ' + o.p99Latency + ' ms', o.p95Latency > 1000 ? 'bad' : trendClass(o.trend.p95, true), 'p95') +
        metric('Em andamento', http.inFlight, compact(http.total) + ' requisições desde o início', '') +
        metric('Uptime', duration(server ? server.process.uptime : 0), 'desde ' + dateTime(s.service.startedAt), '') +
        '</div>' +
        '<div class="metrics six" style="margin-top:12px">' +
        sparkCard('CPU do host', server ? pct(server.host.cpu.percent) : '-', 'hostCpu', server && server.host.cpu.percent > 85) +
        sparkCard('CPU do processo', server ? pct(server.process.cpu.percent) : '-', 'processCpu', false) +
        sparkCard('Memória do host', server ? pct(server.host.memory.percent) : '-', 'memoryPercent', server && server.host.memory.percent > 90) +
        sparkCard('RSS', server ? bytes(server.process.memory.rss) : '-', 'rss', false) +
        sparkCard('Heap', server ? pct(server.process.memory.heapPercent) + ' <small>do limite</small>' : '-', 'heapPercent', server && server.process.memory.heapPercent > 85) +
        sparkCard('Event loop p95', server ? ms(server.process.eventLoop.p95) : '-', 'eventLoopP95', server && server.process.eventLoop.p95 > 100) +
        '</div>' +
        '<div class="grid"><section class="panel"><div class="panel-head"><strong>Tráfego · últimos 60 min</strong><div class="tabs">' +
        [['requests', 'Requisições'], ['latency', 'Latência'], ['errors', 'Erros']].map(([key, label]) => '<button data-metric="overview:' + key + '" class="' + (metricKey === key ? 'active' : '') + '">' + label + '</button>').join('') +
        '</div></div><div class="chart-wrap"><canvas class="chart" id="mainChart" data-chart="overview"></canvas></div>' + legend(series) + '</section>' +
        '<section class="panel"><div class="panel-head"><strong>Códigos de status</strong><span class="label">' + compact(sumValues(o.statusClasses)) + ' respostas retidas</span></div>' + statusDistribution(o.statusClasses, o.statusCodes) +
        '<div class="panel-head" style="margin-top:6px"><strong>Spans por tipo</strong><button class="btn small" data-goto="Métricas">Detalhes</button></div>' + breakdownTable(s.spanBreakdown, true) + '</section></div>' +
        '<div class="grid even" style="margin-top:12px"><section class="panel"><div class="panel-head"><strong>Rotas mais acessadas</strong><button class="btn small" data-goto="Requests">Ver todas</button></div>' + requestsTable(s.routes.slice(0, 8), true) + '</section>' +
        '<section class="panel"><div class="panel-head"><strong>Erros recentes</strong><button class="btn small" data-goto="Erros">Ver todos</button></div>' + errorList(s.errors.slice(0, 6), true) + '</section></div>';
    }
    function overviewSeries(key) {
      const ts = state.snapshot.timeseries;
      if (key === 'latency') return [{ label: 'p95 (ms)', color: '#FF2D55', values: ts.map((p) => p.p95) }, { label: 'média (ms)', color: '#8B5CF6', values: ts.map((p) => p.latency) }];
      if (key === 'errors') return [{ label: '5xx', color: '#EF4444', values: ts.map((p) => p.errors) }, { label: '4xx', color: '#F59E0B', values: ts.map((p) => p.clientErrors) }];
      return [{ label: 'requisições', color: '#FF2D55', values: ts.map((p) => p.requests), fill: true }, { label: '5xx', color: '#EF4444', values: ts.map((p) => p.errors) }];
    }
    function statusDistribution(classes, codes) {
      const total = sumValues(classes) || 1;
      const order = ['2xx', '3xx', '4xx', '5xx', '1xx'];
      const topCodes = Object.entries(codes).sort((a, b) => b[1] - a[1]).slice(0, 8);
      return '<div style="padding:4px 0 10px"><div class="status-bar">' + order.filter((key) => classes[key]).map((key) => '<i class="s-' + key + '" style="width:' + (classes[key] / total * 100) + '%" title="' + key + ': ' + classes[key] + '"></i>').join('') + '</div>' +
        '<div class="chips">' + order.map((key) => '<span><i class="s-' + key + '"></i>' + key + ' <b>' + compact(classes[key] || 0) + '</b> (' + ((classes[key] || 0) / total * 100).toFixed(1) + '%)</span>').join('') + '</div>' +
        (topCodes.length ? '<table style="margin-top:10px"><thead><tr><th>Código</th><th class="num">Respostas</th><th class="num">%</th></tr></thead><tbody>' + topCodes.map(([code, count]) => '<tr><td><span class="badge b-' + code.charAt(0) + 'xx mono">' + code + '</span></td><td class="num">' + compact(count) + '</td><td class="num">' + (count / total * 100).toFixed(1) + '%</td></tr>').join('') + '</tbody></table>' : '') + '</div>';
    }
    function breakdownTable(rows, compactMode) {
      if (!rows.length) return '<div class="empty small">Nenhum span registrado</div>';
      if (compactMode) {
        return '<table><thead><tr><th style="width:34%">Tipo</th><th class="num">Spans</th><th class="num">Erros</th><th class="num">p95</th></tr></thead><tbody>' +
          rows.map((r) => '<tr><td><span class="badge b-kind">' + escapeHtml(kindLabel(r.key)) + '</span></td><td class="num">' + compact(r.count) + '</td><td class="num">' + (r.errors ? '<span style="color:#fb7185">' + r.errors + '</span>' : '0') + '</td><td class="num">' + ms(r.p95) + '</td></tr>').join('') + '</tbody></table>';
      }
      return '<table><thead><tr><th style="width:28%">Tipo</th><th class="num">Spans</th><th class="num">Erros</th><th class="num">Média</th><th class="num">p95</th><th class="num">Máx</th></tr></thead><tbody>' +
        rows.map((r) => '<tr><td><span class="badge b-kind">' + escapeHtml(kindLabel(r.key)) + '</span></td><td class="num">' + compact(r.count) + '</td><td class="num">' + (r.errors ? '<span style="color:#fb7185">' + r.errors + '</span>' : '0') + '</td><td class="num">' + ms(r.avg) + '</td><td class="num">' + ms(r.p95) + '</td><td class="num">' + ms(r.max) + '</td></tr>').join('') + '</tbody></table>';
    }

    /* ---------- Servidor ---------- */
    function serverPage() {
      const s = state.snapshot;
      const info = s.serverInfo;
      const sample = s.server;
      if (!sample || !info) return '<div class="empty">Aguardando métricas do servidor</div>';
      const p = sample.process;
      const h = sample.host;
      const key = state.metric.server;
      const history = state.range === '6h' ? s.serverHistoryLong : s.serverHistory;
      const chartSeries = serverSeries(key, history);
      const container = h.container;
      const gcKinds = Object.entries(p.gc.kinds);
      const resources = Object.entries(p.resources.byType).sort((a, b) => b[1] - a[1]);
      return '<div class="server-meta">' +
        '<span><b>' + escapeHtml(info.host) + '</b></span>' +
        '<span>' + escapeHtml(info.type + ' ' + info.release) + ' · ' + escapeHtml(info.arch) + '</span>' +
        '<span>' + escapeHtml(info.cpuModel || 'CPU') + ' · ' + info.cores + ' núcleos' + (info.cpuSpeedMhz ? ' @ ' + info.cpuSpeedMhz + ' MHz' : '') + '</span>' +
        '<span>Node ' + escapeHtml(info.node) + '</span><span>PID ' + info.pid + ' (ppid ' + info.ppid + ')</span>' +
        '<span>Processo há <b>' + duration(p.uptime) + '</b></span><span>SO há ' + duration(h.uptime) + '</span>' +
        (container ? '<span class="badge b-blue">Container' + (container.cpuLimit ? ' · ' + container.cpuLimit.toFixed(2) + ' CPU' : '') + (container.memoryLimit ? ' · ' + bytes(container.memoryLimit) : '') + '</span>' : '') +
        (info.nodeEnv ? '<span class="badge b-muted">NODE_ENV=' + escapeHtml(info.nodeEnv) + '</span>' : '') +
        '</div>' +
        sectionTitle('CPU', 'Percentual do host; processo em relação a um núcleo (100% = 1 núcleo)') +
        '<div class="metrics four">' +
        metric('CPU do host', pct(h.cpu.percent), bar(h.cpu.percent, h.cpu.percent > 85 ? '' : 'green'), h.cpu.percent > 85 ? 'bad' : '') +
        metric('CPU do processo', pct(p.cpu.percent), 'user ' + pct(p.cpu.user) + ' · system ' + pct(p.cpu.system) + bar(Math.min(100, p.cpu.percent), 'purple'), '') +
        metric('Load average', h.cpu.load[0].toFixed(2), '5 min ' + h.cpu.load[1].toFixed(2) + ' · 15 min ' + h.cpu.load[2].toFixed(2) + ' · paralelismo ' + info.parallelism, h.cpu.load[0] > info.cores ? 'bad' : '') +
        metric('Event loop', pct(p.eventLoop.utilization) + '<small>ocupado</small>', 'p50 ' + ms(p.eventLoop.p50) + ' · p95 ' + ms(p.eventLoop.p95) + ' · p99 ' + ms(p.eventLoop.p99) + ' · máx ' + ms(p.eventLoop.max), p.eventLoop.p95 > 100 ? 'bad' : '') +
        '</div>' +
        '<div class="panel boxed" style="margin-top:12px"><div class="panel-head"><strong>Uso por núcleo</strong><span class="label">' + h.cpu.perCore.length + ' núcleos</span></div><div class="panel-body cores">' +
        h.cpu.perCore.map((value, index) => '<div class="core">CPU ' + index + '<b>' + value.toFixed(0) + '%</b><div class="bar-line ' + (value > 85 ? '' : value > 60 ? 'warn' : 'green') + '"><i style="width:' + value + '%"></i></div></div>').join('') + '</div></div>' +
        sectionTitle('Memória', 'Host, processo e heap do V8') +
        '<div class="metrics four">' +
        metric('Memória do host', pct(h.memory.percent), bytes(h.memory.used) + ' de ' + bytes(h.memory.total) + ' · livre ' + bytes(h.memory.free) + bar(h.memory.percent, h.memory.percent > 90 ? '' : 'green'), h.memory.percent > 90 ? 'bad' : '') +
        metric('RSS do processo', bytes(p.memory.rss), 'pico ' + bytes(p.usage.maxRss) + ' · externa ' + bytes(p.memory.external) + ' · ArrayBuffers ' + bytes(p.memory.arrayBuffers), '') +
        metric('Heap utilizado', bytes(p.memory.heapUsed), 'alocado ' + bytes(p.memory.heapTotal) + ' · limite ' + bytes(p.memory.heapLimit) + ' (' + pct(p.memory.heapPercent) + ')' + bar(p.memory.heapPercent, p.memory.heapPercent > 85 ? '' : 'purple'), p.memory.heapPercent > 85 ? 'bad' : '') +
        (container && container.memoryLimit
          ? metric('Limite do container', pct((container.memoryUsage || 0) / container.memoryLimit * 100), bytes(container.memoryUsage || 0) + ' de ' + bytes(container.memoryLimit) + bar((container.memoryUsage || 0) / container.memoryLimit * 100, 'blue'), (container.memoryUsage || 0) / container.memoryLimit > 0.9 ? 'bad' : '')
          : h.disk
            ? metric('Disco', pct(h.disk.percent), bytes(h.disk.used) + ' de ' + bytes(h.disk.total) + ' · livre ' + bytes(h.disk.free) + ' · <span class="mono" title="' + escapeHtml(h.disk.path) + '">' + escapeHtml(shortPath(h.disk.path)) + '</span>' + bar(h.disk.percent, h.disk.percent > 90 ? '' : 'blue'), h.disk.percent > 90 ? 'bad' : '')
            : metric('Disco', '-', 'Indisponível nesta plataforma', '')) +
        '</div>' +
        '<div class="grid even" style="margin-top:12px">' +
        '<section class="panel boxed"><div class="panel-head"><strong>Heap V8</strong><span class="label">' + p.heap.nativeContexts + ' contextos · ' + p.heap.detachedContexts + ' desanexados</span></div><div class="kvt">' +
        kvt('Heap total', bytes(p.heap.totalHeapSize)) + kvt('Heap físico', bytes(p.heap.totalPhysicalSize)) + kvt('Disponível', bytes(p.heap.totalAvailableSize)) + kvt('Executável', bytes(p.heap.totalHeapSizeExecutable)) +
        kvt('Malloc', bytes(p.heap.mallocedMemory) + ' <span class="muted">(pico ' + bytes(p.heap.peakMallocedMemory) + ')</span>') + kvt('Memória externa', bytes(p.heap.externalMemory)) +
        '</div><div class="table-scroll"><table><thead><tr><th style="width:34%">Espaço</th><th class="num">Usado</th><th class="num">Tamanho</th><th class="num">Disponível</th><th class="num">Físico</th></tr></thead><tbody>' +
        p.heapSpaces.filter((space) => space.size > 0 || space.used > 0).map((space) => '<tr><td class="mono">' + escapeHtml(space.name) + '</td><td class="num">' + bytes(space.used) + '</td><td class="num">' + bytes(space.size) + '</td><td class="num">' + bytes(space.available) + '</td><td class="num">' + bytes(space.physical) + '</td></tr>').join('') + '</tbody></table></div></section>' +
        '<section class="panel boxed"><div class="panel-head"><strong>Garbage collector</strong><span class="label">' + p.gc.total.count + ' ciclos · ' + ms(p.gc.total.pauseMs) + ' de pausa acumulada</span></div>' +
        '<div class="kvt">' + kvt('Últimos 2 s', p.gc.sinceLast.count + ' ciclos · ' + ms(p.gc.sinceLast.pauseMs)) + kvt('Pausa média', ms(p.gc.total.count ? p.gc.total.pauseMs / p.gc.total.count : 0)) + '</div>' +
        (gcKinds.length ? '<table><thead><tr><th>Tipo</th><th class="num">Ciclos</th><th class="num">Pausa total</th><th class="num">Média</th></tr></thead><tbody>' + gcKinds.map(([kind, bucket]) => '<tr><td>' + escapeHtml(gcLabel(kind)) + '</td><td class="num">' + bucket.count + '</td><td class="num">' + ms(bucket.pauseMs) + '</td><td class="num">' + ms(bucket.count ? bucket.pauseMs / bucket.count : 0) + '</td></tr>').join('') + '</tbody></table>' : '<div class="empty small">Nenhum ciclo de GC observado ainda</div>') +
        '<div class="panel-head"><strong>Handles e recursos ativos</strong><span class="label">' + p.resources.handles + ' handles · ' + p.resources.requests + ' requests' + (p.resources.fileDescriptors !== null ? ' · ' + p.resources.fileDescriptors + ' descritores' : '') + '</span></div>' +
        (resources.length ? '<table><thead><tr><th>Recurso</th><th class="num">Quantidade</th></tr></thead><tbody>' + resources.map(([type, count]) => '<tr><td class="mono">' + escapeHtml(type) + '</td><td class="num">' + count + '</td></tr>').join('') + '</tbody></table>' : '<div class="empty small">Sem detalhamento de recursos nesta versão do Node</div>') +
        '</section></div>' +
        '<section class="panel" style="margin-top:24px"><div class="panel-head"><strong>Histórico</strong><div class="tabs">' +
        [['10m', '10 min'], ['6h', '6 h']].map(([value, label]) => '<button data-range="' + value + '" class="' + (state.range === value ? 'active' : '') + '">' + label + '</button>').join('') +
        '</div><div class="tabs">' +
        serverMetricTabs().map(([value, label]) => '<button data-metric="server:' + value + '" class="' + (key === value ? 'active' : '') + '">' + label + '</button>').join('') +
        '</div></div><div class="chart-wrap"><canvas class="chart" id="serverChart" data-chart="server"></canvas></div>' + legend(chartSeries) + '</section>' +
        sectionTitle('Recursos do sistema operacional', 'process.resourceUsage() acumulado desde o início') +
        '<div class="grid even"><section class="panel boxed"><div class="kvt">' +
        kvt('Page faults', compact(p.usage.minorPageFaults) + ' menores · ' + compact(p.usage.majorPageFaults) + ' maiores') +
        kvt('Trocas de contexto', compact(p.usage.voluntaryContextSwitches) + ' voluntárias · ' + compact(p.usage.involuntaryContextSwitches) + ' involuntárias') +
        kvt('E/S de arquivos', compact(p.usage.fsRead) + ' leituras · ' + compact(p.usage.fsWrite) + ' escritas') +
        kvt('Swap / sinais', compact(p.usage.swappedOut) + ' swapped · ' + compact(p.usage.signals) + ' sinais') +
        kvt('IPC', compact(p.usage.ipcSent) + ' enviadas · ' + compact(p.usage.ipcReceived) + ' recebidas') +
        (h.network ? kvt('Rede (host)', rate(h.network.rxBytesPerSecond) + ' ↓ · ' + rate(h.network.txBytesPerSecond) + ' ↑ · total ' + bytes(h.network.rxBytes) + ' / ' + bytes(h.network.txBytes)) : kvt('Rede (host)', '<span class="muted">Taxas disponíveis apenas em Linux</span>')) +
        (h.disk && container && container.memoryLimit ? kvt('Disco (' + escapeHtml(h.disk.path) + ')', bytes(h.disk.used) + ' de ' + bytes(h.disk.total) + ' (' + pct(h.disk.percent) + ')') : '') +
        (container ? kvt('cgroup', (container.cpuLimit ? container.cpuLimit.toFixed(2) + ' CPUs' : 'CPU sem limite') + ' · ' + (container.memoryLimit ? bytes(container.memoryLimit) : 'memória sem limite')) : '') +
        '</div></section>' +
        '<section class="panel boxed"><div class="panel-head"><strong>Processo</strong></div><div class="kvt">' +
        kvt('Título', '<span class="mono">' + escapeHtml(info.title) + '</span>') + kvt('Executável', '<span class="mono">' + escapeHtml(info.execPath) + '</span>') +
        kvt('Argumentos', '<span class="mono">' + escapeHtml(info.argv.slice(1).join(' ') || '—') + '</span>') + (info.execArgv.length ? kvt('Flags do Node', '<span class="mono">' + escapeHtml(info.execArgv.join(' ')) + '</span>') : '') +
        kvt('Diretório', '<span class="mono">' + escapeHtml(info.cwd) + '</span>') + kvt('Usuário', escapeHtml(info.user || '—')) + kvt('Fuso horário', escapeHtml(info.timezone || '—')) +
        kvt('Iniciado em', dateTime(info.bootedAt)) + kvt('Plataforma', escapeHtml(info.platform + ' · ' + info.machine + ' · ' + info.endianness)) + kvt('Kernel', escapeHtml(info.osVersion || info.release)) + kvt('Memória total', bytes(info.memoryTotal)) +
        kvt('Temp / home', '<span class="mono">' + escapeHtml(info.tmpdir) + '</span><br><span class="mono">' + escapeHtml(info.homedir) + '</span>') +
        '</div></section></div>' +
        '<div class="grid even" style="margin-top:12px"><section class="panel boxed"><div class="panel-head"><strong>Versões</strong></div><div class="kvt">' +
        ['node', 'v8', 'uv', 'openssl', 'napi', 'modules', 'icu', 'unicode', 'zlib', 'llhttp', 'undici', 'nghttp2', 'ares', 'brotli', 'sqlite'].filter((name) => info.versions[name]).map((name) => kvt(name, '<span class="mono">' + escapeHtml(info.versions[name]) + '</span>')).join('') +
        '</div></section>' +
        '<section class="panel boxed"><div class="panel-head"><strong>Interfaces de rede</strong><span class="label">' + info.networkInterfaces.length + ' endereços</span></div>' +
        (info.networkInterfaces.length ? '<div class="table-scroll"><table><thead><tr><th>Interface</th><th>Endereço</th><th>Família</th><th>Interna</th></tr></thead><tbody>' + info.networkInterfaces.map((item) => '<tr><td class="mono">' + escapeHtml(item.name) + '</td><td class="mono">' + escapeHtml(item.address) + '</td><td>' + escapeHtml(item.family) + '</td><td>' + (item.internal ? 'sim' : 'não') + '</td></tr>').join('') + '</tbody></table></div>' : '<div class="empty small">Nenhuma interface</div>') +
        '</section></div>';
    }
    function serverMetricTabs() {
      const tabs = [['hostCpu', 'CPU host'], ['processCpu', 'CPU processo'], ['load1', 'Load'], ['memoryPercent', 'Memória %'], ['rss', 'RSS'], ['heapUsed', 'Heap'], ['eventLoopP95', 'Event loop'], ['eventLoopUtilization', 'ELU'], ['gcPauseMs', 'GC'], ['handles', 'Handles']];
      if (state.snapshot.server && state.snapshot.server.host.network) tabs.push(['network', 'Rede']);
      return tabs;
    }
    function serverSeries(key, history) {
      if (key === 'eventLoopP95') return [{ label: 'p95 (ms)', color: '#FF2D55', values: history.map((p) => p.eventLoopP95) }, { label: 'p99 (ms)', color: '#F59E0B', values: history.map((p) => p.eventLoopP99) }, { label: 'p50 (ms)', color: '#8B5CF6', values: history.map((p) => p.eventLoopP50) }];
      if (key === 'heapUsed') return [{ label: 'heap usado', color: '#8B5CF6', values: history.map((p) => p.heapUsed), fill: true }, { label: 'RSS', color: '#FF2D55', values: history.map((p) => p.rss) }, { label: 'externa', color: '#38BDF8', values: history.map((p) => p.external) }];
      if (key === 'rss') return [{ label: 'RSS', color: '#FF2D55', values: history.map((p) => p.rss), fill: true }];
      if (key === 'processCpu') return [{ label: 'CPU processo (%)', color: '#8B5CF6', values: history.map((p) => p.processCpu), fill: true }, { label: 'CPU host (%)', color: '#FF2D55', values: history.map((p) => p.hostCpu) }];
      if (key === 'gcPauseMs') return [{ label: 'pausa GC (ms)', color: '#F59E0B', values: history.map((p) => p.gcPauseMs), fill: true }, { label: 'ciclos', color: '#38BDF8', values: history.map((p) => p.gcCount) }];
      if (key === 'handles') return [{ label: 'handles', color: '#38BDF8', values: history.map((p) => p.handles), fill: true }, { label: 'requests', color: '#F59E0B', values: history.map((p) => p.requests) }];
      if (key === 'network') return [{ label: 'recebido (B/s)', color: '#22C55E', values: history.map((p) => p.rxBytesPerSecond), fill: true }, { label: 'enviado (B/s)', color: '#38BDF8', values: history.map((p) => p.txBytesPerSecond) }];
      if (key === 'load1') return [{ label: 'load 1 min', color: '#F59E0B', values: history.map((p) => p.load1), fill: true }];
      if (key === 'eventLoopUtilization') return [{ label: 'event loop ocupado (%)', color: '#F97316', values: history.map((p) => p.eventLoopUtilization), fill: true }];
      if (key === 'memoryPercent') return [{ label: 'memória do host (%)', color: '#FF2D55', values: history.map((p) => p.memoryPercent), fill: true }];
      return [{ label: 'CPU host (%)', color: '#FF2D55', values: history.map((p) => p.hostCpu), fill: true }, { label: 'CPU processo (%)', color: '#8B5CF6', values: history.map((p) => p.processCpu) }];
    }
    function serverFormatter(key) {
      if (key === 'rss' || key === 'heapUsed') return bytes;
      if (key === 'network') return rate;
      if (key === 'eventLoopP95' || key === 'gcPauseMs') return (value) => value.toFixed(1) + ' ms';
      if (key === 'handles') return (value) => value.toFixed(0);
      if (key === 'load1') return (value) => value.toFixed(2);
      return (value) => value.toFixed(1) + '%';
    }

    /* ---------- Erros ---------- */
    function errorsPage() {
      const s = state.snapshot;
      const summary = s.errorSummary;
      const filtered = s.errors.filter((group) => (state.errorFilter === 'all' || group.category === state.errorFilter) && matchesSearch(group.name + ' ' + group.message + ' ' + (group.location || '') + ' ' + group.routes.map((r) => r.route).join(' ')));
      const selected = filtered.find((group) => group.id === state.selectedError) || s.errors.find((group) => group.id === state.selectedError) || null;
      return '<div class="metrics six">' +
        metric('Ocorrências retidas', compact(summary.total), summary.groups + ' erros distintos', summary.total ? 'bad' : '') +
        metric('Servidor (5xx)', compact(summary.server), 'exceções não tratadas e respostas 5xx', summary.server ? 'bad' : '') +
        metric('Cliente (4xx)', compact(summary.client), 'validação, autenticação, não encontrado', '') +
        metric('Processo', compact(summary.process), 'uncaught exceptions, rejections e warnings', summary.process ? 'bad' : '') +
        metric('Internos', compact(summary.internal), 'banco, Redis, jobs e spans manuais', '') +
        metric('Última hora', compact(summary.lastHour), 'taxa 5xx atual ' + s.overview.errorRate.toFixed(2) + '%', summary.lastHour ? 'bad' : '') +
        '</div>' +
        '<div class="toolbar" style="margin-top:16px"><div class="tabs">' +
        [['all', 'Todos'], ['server', 'Servidor'], ['client', 'Cliente'], ['process', 'Processo'], ['internal', 'Internos']].map(([value, label]) => '<button data-filter="' + value + '" class="' + (state.errorFilter === value ? 'active' : '') + '">' + label + '</button>').join('') +
        '</div><span class="spacer"></span><input class="search" data-search="1" placeholder="Filtrar por tipo, mensagem, rota ou arquivo" value="' + escapeHtml(state.search) + '"></div>' +
        '<div class="two-col"><div>' + errorList(filtered, false) + '</div>' + errorDetailPanel(selected) + '</div>';
    }
    function errorList(groups, compactMode) {
      if (!groups.length) return '<div class="empty' + (compactMode ? ' small' : '') + '">Nenhum erro' + (state.search || state.errorFilter !== 'all' ? ' com esse filtro' : ' registrado') + '</div>';
      return '<div class="err-list">' + groups.map((group) => '<div class="err-item ' + (group.id === state.selectedError && !compactMode ? 'selected' : '') + '" data-error-id="' + escapeHtml(group.id) + '">' +
        '<div><div class="name" title="' + escapeHtml(group.name) + '">' + escapeHtml(group.name) + (group.code !== null ? ' <span class="badge b-muted mono">' + escapeHtml(String(group.code)) + '</span>' : '') + '</div>' +
        '<div class="msg" title="' + escapeHtml(group.message) + '">' + escapeHtml(group.message || '(sem mensagem)') + '</div>' +
        '<div class="meta">' + categoryBadge(group.category, group.status) + '<span class="badge b-kind">' + escapeHtml(kindLabel(group.kind)) + '</span>' + (group.routes[0] ? '<span class="mono">' + escapeHtml(group.routes[0].route) + (group.routes.length > 1 ? ' +' + (group.routes.length - 1) : '') + '</span>' : '') + (group.location ? '<span class="mono" title="' + escapeHtml(group.location) + '">' + escapeHtml(shortPath(group.location)) + '</span>' : '') + '<span>última ' + relative(group.lastSeen) + '</span></div></div>' +
        '<div class="side"><b>' + compact(group.occurrences) + '</b><span class="rel">' + (group.traces > group.occurrences ? group.traces + ' spans' : 'ocorrências') + '</span>' + (compactMode ? '' : '<canvas data-trend="' + escapeHtml(group.id) + '"></canvas>') + '</div></div>').join('') + '</div>';
    }
    function errorDetailPanel(group) {
      if (!group) return '<div class="err-detail"><div class="empty">Selecione um erro para ver o stack trace completo, os atributos da requisição e o trace</div></div>';
      const detail = state.errorDetail && state.errorDetail.id === group.id ? state.errorDetail : null;
      const samples = detail ? detail.samples : [group.latest];
      const index = Math.min(state.selectedSample, samples.length - 1);
      const sample = samples[index] || group.latest;
      const error = sample.error || { name: group.name, message: group.message };
      const frames = error.frames || [];
      const shownFrames = state.allFrames ? frames : frames.filter((frame) => frame.inApp);
      const hiddenCount = frames.length - shownFrames.length;
      const trace = state.trace && state.trace.traceId === sample.traceId ? state.trace.spans : null;
      const attributes = Object.entries(sample.attributes || {}).filter(([, value]) => value !== undefined && value !== null && value !== '');
      return '<div class="err-detail" data-scroll="detail"><div class="head"><h3>' + escapeHtml(error.name) + ' <span>' + escapeHtml(error.message || '') + '</span></h3>' +
        '<div class="badges">' + categoryBadge(group.category, sampleStatus(sample)) + '<span class="badge b-kind">' + escapeHtml(kindLabel(sample.kind)) + '</span>' + (error.code !== undefined ? '<span class="badge b-muted mono">code ' + escapeHtml(String(error.code)) + '</span>' : '') + (sample.attributes && sample.attributes['http.method'] ? '<span class="badge ' + escapeHtml(sample.attributes['http.method']) + '">' + escapeHtml(sample.attributes['http.method']) + '</span><span class="badge b-muted mono">' + escapeHtml(sample.attributes['http.route'] || sample.attributes['http.url'] || '') + '</span>' : '') + '<span class="badge b-muted mono" title="Trace ID">trace ' + escapeHtml(sample.traceId) + '</span></div></div>' +
        '<div class="block"><div class="meta-grid">' +
        metaItem('Ocorrências', compact(group.occurrences) + (group.traces !== group.occurrences ? ' <span class="muted">(' + group.traces + ' spans)</span>' : '')) + metaItem('Primeira vez', dateTime(group.firstSeen)) + metaItem('Última vez', dateTime(group.lastSeen) + ' <span class="muted">(' + relative(group.lastSeen) + ')</span>') +
        metaItem('Usuários afetados', group.users || '—') + metaItem('Rotas afetadas', group.routes.length ? group.routes.map((r) => '<span class="mono">' + escapeHtml(r.route) + '</span> <span class="muted">×' + r.count + '</span>').join('<br>') : '—') + metaItem('Origem', group.location ? '<span class="mono">' + escapeHtml(group.location) + '</span>' : '—') +
        '</div></div>' +
        '<div class="block"><h4>Ocorrências recentes <span class="muted">' + (detail ? samples.length + ' amostras' : 'carregando…') + '</span></h4><div class="samples" data-scroll="samples">' +
        samples.map((item, position) => '<div class="sample ' + (position === index ? 'selected' : '') + '" data-sample="' + position + '"><span>' + time(item.startedAt) + '</span><span class="r mono">' + escapeHtml(sampleLabel(item)) + '</span><span>' + (sampleStatus(item) ? '<span class="badge b-' + statusClass(sampleStatus(item)) + ' mono">' + sampleStatus(item) + '</span>' : '<span class="badge b-kind">' + escapeHtml(kindLabel(item.kind)) + '</span>') + ' ' + item.durationMs + ' ms</span></div>').join('') + '</div></div>' +
        '<div class="block"><h4>Stack trace <span><button class="btn small" data-toggle-frames="1">' + (state.allFrames ? 'Ocultar frames externos' : 'Mostrar todos os frames' + (hiddenCount > 0 ? ' (+' + hiddenCount + ')' : '')) + '</button> <button class="btn small" data-copy="stack-' + escapeHtml(sample.spanId) + '">Copiar</button></span></h4>' +
        (frames.length ? '<div class="frames">' + (shownFrames.length ? shownFrames : frames).map((frame, position) => frameRow(frame, position)).join('') + '</div>' : '') +
        '<details class="raw" style="margin-top:8px" data-key="raw-' + escapeHtml(group.id) + '"><summary>Stack bruto</summary><pre class="stack" id="stack-' + escapeHtml(sample.spanId) + '">' + escapeHtml(error.stack || (error.name + ': ' + error.message)) + '</pre></details>' +
        (error.cause ? '<div class="cause">' + causeChain(error.cause, 0) + '</div>' : '') + '</div>' +
        (error.details ? '<div class="block"><h4>Detalhes da exceção</h4><pre class="stack">' + escapeHtml(JSON.stringify(error.details, null, 2)) + '</pre></div>' : '') +
        '<div class="block"><h4>Atributos <span class="muted">' + attributes.length + '</span></h4>' + (attributes.length ? '<div class="kvt">' + attributes.map(([key, value]) => kvt('<span class="mono">' + escapeHtml(key) + '</span>', attributeValue(value))).join('') + '</div>' : '<div class="muted">Sem atributos</div>') + '</div>' +
        '<div class="block"><h4>Trace <span><button class="btn small" data-open-trace="' + escapeHtml(sample.traceId) + '">Abrir em Traces</button></span></h4>' + (trace ? traceWaterfall(trace, sample.spanId, false) : '<div class="empty small">Carregando spans do trace…</div>') + '</div></div>';
    }
    function frameRow(frame, position) {
      const location = frame.file ? frame.file + (frame.line !== null ? ':' + frame.line + (frame.column !== null ? ':' + frame.column : '') : '') : '';
      return '<div class="frame ' + (frame.inApp ? 'in-app' : '') + '"><span class="n">' + (position + 1) + '</span><span><span class="fn">' + escapeHtml(frame.function || '<anônimo>') + '</span>' + (location ? '<br><span class="loc">' + escapeHtml(location) + '</span>' : '') + '</span></div>';
    }
    function causeChain(cause, depth) {
      if (!cause || depth > 4) return '';
      const frames = (cause.frames || []).filter((frame) => frame.inApp);
      return '<div class="title">Causa: ' + escapeHtml(cause.name) + ': ' + escapeHtml(cause.message) + (cause.code !== undefined ? ' <span class="badge b-muted mono">' + escapeHtml(String(cause.code)) + '</span>' : '') + '</div>' +
        (frames.length ? '<div class="frames" style="margin-top:6px">' + frames.slice(0, 6).map((frame, index) => frameRow(frame, index)).join('') + '</div>' : (cause.stack ? '<pre class="stack" style="margin-top:6px">' + escapeHtml(cause.stack) + '</pre>' : '')) +
        (cause.details ? '<pre class="stack" style="margin-top:6px">' + escapeHtml(JSON.stringify(cause.details, null, 2)) + '</pre>' : '') +
        (cause.cause ? '<div class="cause">' + causeChain(cause.cause, depth + 1) + '</div>' : '');
    }
    function sampleLabel(span) {
      const a = span.attributes || {};
      if (a['http.method']) return a['http.method'] + ' ' + (a['http.route'] || a['http.url'] || '');
      return span.name;
    }
    function sampleStatus(span) {
      const value = Number(span.attributes && span.attributes['http.status_code']);
      if (value >= 100) return value;
      return span.error && span.error.status ? span.error.status : null;
    }
    function categoryBadge(category, status) {
      const label = category === 'server' ? 'Servidor' : category === 'client' ? 'Cliente' : category === 'process' ? 'Processo' : 'Interno';
      return '<span class="badge b-' + category + '">' + label + (status ? ' · ' + status : '') + '</span>';
    }

    /* ---------- Requests ---------- */
    function requestsPage() {
      const s = state.snapshot;
      const o = s.overview;
      const rows = sortRows(s.routes.filter((route) => matchesSearch(route.method + ' ' + route.route)));
      return '<div class="metrics six">' +
        metric('Requisições / min', compact(o.requestsPerMinute), o.requestsPerSecond.toFixed(2) + ' rps · ' + compact(s.http.total) + ' no total', '') +
        metric('Em andamento', s.http.inFlight, 'conexões com resposta pendente', '') +
        metric('Latência média', o.avgLatency + '<small>ms</small>', 'p50 ' + o.p50Latency + ' · p95 ' + o.p95Latency + ' · p99 ' + o.p99Latency + ' · máx ' + o.maxLatency, '') +
        metric('2xx / 3xx', compact((o.statusClasses['2xx'] || 0) + (o.statusClasses['3xx'] || 0)), 'respostas de sucesso retidas', '') +
        metric('4xx', compact(o.statusClasses['4xx'] || 0), o.clientErrorRate.toFixed(2) + '% das requisições', '') +
        metric('5xx', compact(o.statusClasses['5xx'] || 0), o.errorRate.toFixed(2) + '% das requisições', o.errorRate >= 1 ? 'bad' : '') +
        '</div>' +
        '<div class="server-meta" style="margin-top:14px"><span>Tráfego total: <b>' + bytes(s.http.bytesIn) + '</b> recebidos · <b>' + bytes(s.http.bytesOut) + '</b> enviados</span><span>' + compact(o.retainedSpans) + ' spans retidos' + (o.retainedSince ? ' desde ' + time(o.retainedSince) : '') + '</span></div>' +
        '<div class="toolbar"><input class="search" data-search="1" placeholder="Filtrar rotas" value="' + escapeHtml(state.search) + '"><span class="spacer"></span><span class="label">' + rows.length + ' rotas</span></div>' +
        '<section class="panel">' + requestsTable(rows, false) + '</section>';
    }
    function requestsTable(rows, compactMode) {
      if (!rows.length) return '<div class="empty small">Nenhuma requisição registrada</div>';
      if (compactMode) {
        // Overview card: six columns so nothing truncates; the row jumps to the Requests page with the route expanded.
        return '<div class="table-scroll"><table><thead><tr><th style="width:70px">Método</th><th>Rota</th><th class="num" style="width:60px">Req</th><th class="num" style="width:74px">p95</th><th class="num" style="width:50px">5xx</th><th class="num" style="width:50px">4xx</th></tr></thead><tbody>' +
          rows.map((r) => {
            const key = requestKey(r.method, r.route);
            const slow = r.p95 > 1000 || r.errorRate >= 1 ? 'slow' : '';
            return '<tr class="clickable ' + slow + '" data-request-goto="' + escapeHtml(key) + '" title="Ver todos os dados em Requests"><td><span class="badge ' + escapeHtml(r.method) + '">' + escapeHtml(r.method) + '</span></td><td class="mono" title="' + escapeHtml(r.route) + '">' + escapeHtml(r.route) + '</td><td class="num">' + compact(r.requests) + '</td><td class="num">' + ms(r.p95) + '</td><td class="num">' + (r.errors ? '<span style="color:#fb7185">' + r.errors + '</span>' : '0') + '</td><td class="num">' + (r.clientErrors ? '<span style="color:#fbbf24">' + r.clientErrors + '</span>' : '0') + '</td></tr>';
          }).join('') + '</tbody></table></div>';
      }
      const th = (key, label, numeric) => '<th class="' + (numeric ? 'num ' : '') + (compactMode ? '' : 'sortable ') + (state.sort.key === key ? 'sorted' : '') + '" data-sort="' + key + '">' + label + (state.sort.key === key && !compactMode ? (state.sort.dir === 'desc' ? ' ↓' : ' ↑') : '') + '</th>';
      return (compactMode ? '' : '<div class="label" style="padding:10px 16px 0">Clique em uma rota para abrir o painel com todos os dados das requisições</div>') +
        '<div class="table-scroll"><table><thead><tr>' + th('method', 'Método') + '<th style="width:' + (compactMode ? '34%' : '26%') + '" class="' + (compactMode ? '' : 'sortable ') + (state.sort.key === 'route' ? 'sorted' : '') + '" data-sort="route">Rota</th>' + th('requests', 'Req', true) + th('avg', 'Média', true) + th('p50', 'p50', true) + th('p95', 'p95', true) + th('p99', 'p99', true) + (compactMode ? '' : th('max', 'Máx', true)) + th('errors', '5xx', true) + th('clientErrors', '4xx', true) + th('errorRate', 'Erro %', true) + (compactMode ? '' : th('lastSeen', 'Última', true)) + '</tr></thead><tbody>' +
        rows.map((r) => {
          const key = requestKey(r.method, r.route);
          const open = !compactMode && sheet.key === key;
          const slow = r.p95 > 1000 || r.errorRate >= 1 ? 'slow' : '';
          // Full mode: the row opens the side panel (Sheet) with every request of the route.
          const rowAttributes = compactMode
            ? ' class="clickable ' + slow + '" data-request-goto="' + escapeHtml(key) + '" title="Ver todos os dados em Requests"'
            : ' class="request-row clickable ' + (open ? 'selected ' : '') + slow + '" data-request="' + escapeHtml(key) + '" tabindex="0" role="button" title="Abrir todos os dados desta rota"';
          return '<tr' + rowAttributes + '><td><span class="badge ' + escapeHtml(r.method) + '">' + escapeHtml(r.method) + '</span></td><td class="mono" title="' + escapeHtml(r.route) + '">' + escapeHtml(r.route) + '</td><td class="num">' + compact(r.requests) + '</td><td class="num">' + r.avg + '</td><td class="num">' + r.p50 + '</td><td class="num">' + r.p95 + '</td><td class="num">' + r.p99 + '</td>' + (compactMode ? '' : '<td class="num">' + r.max + '</td>') + '<td class="num">' + (r.errors ? '<span style="color:#fb7185">' + r.errors + '</span>' : '0') + '</td><td class="num">' + (r.clientErrors ? '<span style="color:#fbbf24">' + r.clientErrors + '</span>' : '0') + '</td><td class="num">' + r.errorRate.toFixed(2) + '%</td>' + (compactMode ? '' : '<td class="num rel">' + relative(r.lastSeen) + '</td>') + '</tr>' +
            '';
        }).join('') +
        '</tbody></table></div>';
    }
    function requestKey(method, route) { return String(method) + ' ' + String(route); }
    // Mirrors how the server groups server spans into routes (http.method + http.route, falling back to the span name).
    function requestSpanKey(span) {
      const attributes = span.attributes || {};
      const method = attributes['http.method'] !== undefined ? attributes['http.method'] : 'GET';
      const route = attributes['http.route'] !== undefined ? attributes['http.route'] : span.name.replace(/^HTTP [A-Z]+ /, '');
      return requestKey(method, route);
    }
    function requestSpans(key) {
      return (state.snapshot.spans || []).filter((span) => {
        if (span.kind !== 'server') return false;
        const attributes = span.attributes || {};
        return requestSpanKey(span) === key || requestKey(attributes['http.method'] !== undefined ? attributes['http.method'] : 'GET', span.name) === key;
      });
    }

    /* ---------- Requests: painel lateral (Sheet) ---------- */
    // Sheet state lives here (not in state) so the request panel can refresh without touching the page renderer.
    const sheet = { key: null, sample: null, sampleSpan: null, allFrames: false, traces: {}, loading: null, rendered: {} };
    const sheetRoot = document.createElement('div');
    sheetRoot.id = 'pulse-sheet';
    document.body.appendChild(sheetRoot);
    afterRender.push(renderSheet);

    function toggleRequest(key) { openSheet(sheet.key === key ? null : key); }
    function openRequest(key) {
      state.page = 'Requests';
      state.search = '';
      writeHash();
      openSheet(key);
      window.scrollTo(0, 0);
    }
    function openSheet(key) {
      sheet.key = key;
      sheet.sample = null;
      sheet.sampleSpan = null;
      sheet.allFrames = false;
      render();
      renderSheet();
    }
    function closeSheet() {
      if (sheet.key === null) return;
      sheet.key = null;
      sheet.sample = null;
      sheet.sampleSpan = null;
      render();
      renderSheet();
    }
    function sheetRoute() {
      const s = state.snapshot;
      if (!s || !sheet.key) return null;
      return s.routes.find((route) => requestKey(route.method, route.route) === sheet.key) || null;
    }
    function sheetSamples() {
      return requestSpans(sheet.key).slice().sort((a, b) => Date.parse(b.endedAt) - Date.parse(a.endedAt));
    }
    function renderSheet() {
      if (!sheet.key || state.page !== 'Requests' || !state.snapshot) {
        if (sheet.key && state.page !== 'Requests') { sheet.key = null; sheet.sample = null; sheet.sampleSpan = null; }
        if (sheetRoot.innerHTML) { sheetRoot.innerHTML = ''; document.body.classList.remove('sheet-open'); }
        sheet.rendered = {};
        return;
      }
      // Keep the DOM while the user selects text inside the panel (copying a stack trace, for example).
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.anchorNode && sheetRoot.contains(selection.anchorNode)) return;
      const parts = requestSheet();
      let aside = sheetRoot.querySelector('.sheet');
      if (!aside) {
        // The shell is built once per opening, so the slide-in animation does not replay on every 5-second refresh.
        sheetRoot.innerHTML = '<div class="sheet-backdrop" data-sheet-close="1"></div><aside class="sheet" role="dialog" aria-modal="true" aria-label="Detalhes da requisição"><div class="sheet-head"></div><div class="sheet-body" data-scroll="sheet-body"></div></aside>';
        aside = sheetRoot.querySelector('.sheet');
        document.body.classList.add('sheet-open');
        sheet.rendered = {};
      }
      const head = aside.querySelector('.sheet-head');
      const body = aside.querySelector('.sheet-body');
      const expanded = new Set([...aside.querySelectorAll('details[open]')].map((item) => item.dataset.key || ''));
      const scrollers = {};
      aside.querySelectorAll('[data-scroll]').forEach((element) => { scrollers[element.dataset.scroll] = element.scrollTop; });
      if (sheet.rendered.head !== parts.head) { head.innerHTML = parts.head; sheet.rendered.head = parts.head; }
      // Each block is replaced only when its markup changed; untouched blocks keep their DOM and the user's place in them.
      const wanted = parts.blocks.map((block) => block.id);
      [...body.children].forEach((child) => { if (!wanted.includes(child.dataset.block)) child.remove(); });
      parts.blocks.forEach((block, index) => {
        let element = body.querySelector('[data-block="' + block.id + '"]');
        if (!element) {
          element = document.createElement('div');
          element.dataset.block = block.id;
          body.insertBefore(element, body.children[index] || null);
          sheet.rendered[block.id] = null;
        }
        if (sheet.rendered[block.id] !== block.html) { element.innerHTML = block.html; sheet.rendered[block.id] = block.html; }
      });
      aside.querySelectorAll('details[data-key]').forEach((item) => { if (expanded.has(item.dataset.key)) item.open = true; });
      aside.querySelectorAll('[data-scroll]').forEach((element) => { if (scrollers[element.dataset.scroll] !== undefined) element.scrollTop = scrollers[element.dataset.scroll]; });
    }
    function requestSheet() {
      const route = sheetRoute();
      const parts = sheet.key.split(' ');
      const method = parts.shift();
      const routeLabel = parts.join(' ');
      const samples = sheetSamples();
      // The selected request stays selected across refreshes; when it leaves the retained spans the last copy is kept.
      if (!sheet.sample && samples[0]) { sheet.sample = samples[0].spanId; sheet.sampleSpan = samples[0]; }
      const live = samples.find((span) => span.spanId === sheet.sample) || null;
      if (live) sheet.sampleSpan = live;
      const selected = live || sheet.sampleSpan || null;
      const stale = !!(selected && !live);
      if (selected) ensureSheetTrace(selected.traceId);
      const classes = route && route.statusClasses ? route.statusClasses : {};
      const head = '<div><h3><span class="badge ' + escapeHtml(method) + '">' + escapeHtml(method) + '</span><span class="mono">' + escapeHtml(routeLabel) + '</span></h3>' +
        '<div class="badges">' + ['1xx', '2xx', '3xx', '4xx', '5xx'].filter((name) => classes[name]).map((name) => '<span class="badge b-' + name + ' mono">' + name + ' ' + compact(classes[name]) + '</span>').join('') +
        (route ? '<span class="badge b-kind">' + compact(route.requests) + ' requisições</span><span class="badge ' + (route.errorRate >= 1 ? 'b-5xx' : 'b-muted') + '">' + route.errorRate.toFixed(2) + '% de erro</span>' : '') + '</div></div>' +
        '<button class="icon-btn sheet-close" data-sheet-close="1" title="Fechar (Esc)" aria-label="Fechar">×</button>';
      const stats = route ? '<div class="block"><div class="meta-grid">' + [
          ['Requisições', compact(route.requests)], ['Última requisição', dateTime(route.lastSeen) + ' <span class="muted">(' + relative(route.lastSeen) + ')</span>'],
          ['Média', ms(route.avg)], ['Mínimo', ms(route.min)], ['Máximo', ms(route.max)], ['p50', ms(route.p50)], ['p95', ms(route.p95)], ['p99', ms(route.p99)],
          ['Erros 5xx', compact(route.errors)], ['Erros 4xx', compact(route.clientErrors)], ['Taxa de erro', route.errorRate.toFixed(2) + '%'],
        ].map((item) => metaItem(item[0], item[1])).join('') + '</div></div>' : '';
      const list = '<div class="block"><h4>Requisições recentes <span class="muted">' + samples.length + ' entre os spans retidos</span></h4>' +
        (stale ? '<div class="muted" style="margin-bottom:6px">A requisição selecionada saiu dos spans retidos; o detalhe abaixo mostra a última cópia recebida.</div>' : '') +
        (samples.length ? '<div class="samples" data-scroll="sheet-samples">' + samples.map((span) => '<div class="sample ' + (span.spanId === sheet.sample ? 'selected' : '') + '" data-request-sample="' + escapeHtml(span.spanId) + '"><span>' + time(span.endedAt) + '</span><span class="r mono" title="' + escapeHtml(sampleTarget(span)) + '">' + escapeHtml(sampleTarget(span)) + '</span><span>' + sampleBadges(span) + '</span></div>').join('') + '</div>'
          : '<div class="empty small">Nenhuma requisição desta rota entre os spans retidos</div>') + '</div>';
      return { head, blocks: [{ id: 'stats', html: stats }, { id: 'samples', html: list }, { id: 'detail', html: selected ? requestSample(selected) : '' }] };
    }
    function sampleTarget(span) {
      const a = span.attributes || {};
      return a['http.url'] || a['http.target'] || span.name;
    }
    function sampleBadges(span) {
      const status = sampleStatus(span);
      return (status ? '<span class="badge b-' + statusClass(status) + ' mono">' + status + '</span>' : '<span class="badge b-muted">sem status</span>') +
        ' <span class="muted">' + ms(span.durationMs) + '</span>' + (span.error ? ' <span class="badge b-5xx">' + escapeHtml(span.error.name) + '</span>' : '');
    }
    function requestSample(span) {
      const a = span.attributes || {};
      const error = span.error || null;
      const frames = error && error.frames ? error.frames : [];
      const shownFrames = sheet.allFrames ? frames : frames.filter((frame) => frame.inApp);
      const hiddenCount = frames.length - shownFrames.length;
      const trace = sheet.traces[span.traceId] || null;
      const traceSpans = trace ? trace.spans : (state.snapshot.spans || []).filter((item) => item.traceId === span.traceId);
      const attributes = Object.entries(a).filter((entry) => entry[1] !== undefined && entry[1] !== null && entry[1] !== '');
      const status = sampleStatus(span);
      const userAgent = a['http.user_agent'] ? String(a['http.user_agent']) : '';
      const sizes = bytes(Number(a['http.request.content_length']) || 0) + ' recebidos · ' + bytes(Number(a['http.response.content_length']) || 0) + ' enviados';
      return '<div class="block"><h4>Requisição <span><button class="btn small" data-open-trace="' + escapeHtml(span.traceId) + '">Abrir em Traces</button></span></h4>' +
          '<div class="badges" style="margin:0 0 10px">' + (status ? '<span class="badge b-' + statusClass(status) + ' mono">' + status + '</span>' : '') +
            '<span class="badge ' + escapeHtml(a['http.method'] || '') + '">' + escapeHtml(a['http.method'] || span.kind) + '</span><span class="badge b-kind">' + escapeHtml(kindLabel(span.kind)) + '</span>' +
            (error ? '<span class="badge b-5xx">' + escapeHtml(error.name) + '</span>' : '<span class="badge b-ok">ok</span>') + '</div>' +
          '<div class="meta-grid">' + [
            ['URL', '<span class="mono">' + escapeHtml(a['http.url'] || a['http.target'] || '—') + '</span>'],
            ['Duração', ms(span.durationMs) + ' <span class="muted">(' + span.durationMs + ' ms)</span>'],
            ['Início', dateTime(span.startedAt)],
            ['Fim', dateTime(span.endedAt) + ' <span class="muted">(' + relative(span.endedAt) + ')</span>'],
            ['IP do cliente', a['http.client_ip'] ? '<span class="mono">' + escapeHtml(a['http.client_ip']) + (a['net.peer.port'] ? ':' + escapeHtml(a['net.peer.port']) : '') + '</span>' : '—'],
            ['Usuário', a['enduser.id'] ? '<span class="mono">' + escapeHtml(a['enduser.id']) + '</span>' : '—'],
            ['User agent', userAgent ? '<span class="mono" title="' + escapeHtml(userAgent) + '">' + escapeHtml(userAgent.slice(0, 60)) + (userAgent.length > 60 ? '…' : '') + '</span>' : '—'],
            ['Request id', a['http.request_id'] ? '<span class="mono">' + escapeHtml(a['http.request_id']) + '</span>' : '—'],
            ['Tamanhos', sizes],
            ['Trace id', '<span class="mono">' + escapeHtml(span.traceId) + '</span>'],
            ['Span id', '<span class="mono">' + escapeHtml(span.spanId) + '</span>'],
          ].map((item) => metaItem(item[0], item[1])).join('') + '</div></div>' +
        (error ? '<div class="block"><h4>Stack trace <span><button class="btn small" data-sheet-frames="1">' + (sheet.allFrames ? 'Ocultar frames externos' : 'Mostrar todos os frames' + (hiddenCount > 0 ? ' (+' + hiddenCount + ')' : '')) + '</button> <button class="btn small" data-copy="sheet-stack-' + escapeHtml(span.spanId) + '">Copiar</button></span></h4>' +
            '<div class="title" style="margin-bottom:8px"><b>' + escapeHtml(error.name) + '</b>: ' + escapeHtml(error.message || '') +
              (error.code !== undefined ? ' <span class="badge b-muted mono">code ' + escapeHtml(String(error.code)) + '</span>' : '') +
              (error.status !== undefined ? ' <span class="badge b-' + statusClass(Number(error.status)) + ' mono">HTTP ' + escapeHtml(error.status) + '</span>' : '') + '</div>' +
            (frames.length ? '<div class="frames">' + (shownFrames.length ? shownFrames : frames).map((frame, position) => frameRow(frame, position)).join('') + '</div>' : '') +
            '<details class="raw" style="margin-top:8px" data-key="sheet-raw-' + escapeHtml(span.spanId) + '"><summary>Stack bruto</summary><pre class="stack" id="sheet-stack-' + escapeHtml(span.spanId) + '">' + escapeHtml(error.stack || (error.name + ': ' + error.message)) + '</pre></details>' +
            (error.cause ? '<div class="cause">' + causeChain(error.cause, 0) + '</div>' : '') + '</div>' +
          (error.details ? '<div class="block"><h4>Detalhes da exceção</h4><pre class="stack">' + escapeHtml(JSON.stringify(error.details, null, 2)) + '</pre></div>' : '') : '') +
        '<div class="block"><h4>Atributos <span class="muted">' + attributes.length + '</span></h4>' + (attributes.length ? '<div class="kvt">' + attributes.map((entry) => kvt('<span class="mono">' + escapeHtml(entry[0]) + '</span>', attributeValue(entry[1]))).join('') + '</div>' : '<div class="muted">Sem atributos</div>') + '</div>' +
        '<div class="block"><h4>Trace <span class="muted">' + traceSpans.length + ' spans' + (trace ? '' : ' retidos no snapshot') + '</span></h4>' + (traceSpans.length ? traceWaterfall(traceSpans, span.spanId, false) : '<div class="empty small">Carregando spans do trace…</div>') + '</div>' +
        '<div class="block"><details class="raw" data-key="sheet-json-' + escapeHtml(span.spanId) + '"><summary>JSON completo</summary><pre class="stack">' + escapeHtml(JSON.stringify(span, null, 2)) + '</pre></details></div>';
    }
    function ensureSheetTrace(traceId) {
      if (!traceId || sheet.traces[traceId] || sheet.loading === traceId) return;
      if (Object.keys(sheet.traces).length > 40) sheet.traces = {};
      sheet.loading = traceId;
      api('traces/' + encodeURIComponent(traceId))
        .then((trace) => { sheet.traces[traceId] = trace; })
        .catch(() => undefined)
        .finally(() => { if (sheet.loading === traceId) sheet.loading = null; renderSheet(); });
    }
    sheetRoot.addEventListener('click', (event) => {
      if (event.target.closest('[data-sheet-close]')) return closeSheet();
      const sample = event.target.closest('[data-request-sample]');
      if (sample) {
        sheet.sample = sample.dataset.requestSample;
        sheet.sampleSpan = sheetSamples().find((span) => span.spanId === sheet.sample) || sheet.sampleSpan;
        sheet.allFrames = false;
        return renderSheet();
      }
      const toggle = event.target.closest('button[data-sheet-frames]');
      if (toggle) { sheet.allFrames = !sheet.allFrames; return renderSheet(); }
      const copy = event.target.closest('button[data-copy]');
      if (copy) {
        const source = document.getElementById(copy.dataset.copy);
        if (source && navigator.clipboard) navigator.clipboard.writeText(source.textContent).then(() => { copy.textContent = 'Copiado'; setTimeout(() => { copy.textContent = 'Copiar'; }, 1500); }).catch(() => undefined);
        return;
      }
      const openTrace = event.target.closest('[data-open-trace]');
      if (openTrace) {
        state.traceId = openTrace.dataset.openTrace;
        state.selectedSpan = null;
        state.page = 'Traces';
        state.search = '';
        sheet.key = null;
        sheet.sample = null;
        sheet.sampleSpan = null;
        writeHash();
        render();
        renderSheet();
        window.scrollTo(0, 0);
        return refreshTrace();
      }
    });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && sheet.key) closeSheet(); });
    content.addEventListener('click', (event) => {
      const row = event.target.closest('tr[data-request]');
      if (row) return toggleRequest(row.dataset.request);
      const shortcut = event.target.closest('tr[data-request-goto]');
      if (shortcut) openRequest(shortcut.dataset.requestGoto);
    });
    content.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const row = event.target.closest('tr[data-request]');
      if (!row || event.target !== row) return;
      event.preventDefault();
      toggleRequest(row.dataset.request);
    });
    function sortRows(rows) {
      const { key, dir } = state.sort;
      const factor = dir === 'desc' ? -1 : 1;
      return [...rows].sort((a, b) => {
        const left = a[key]; const right = b[key];
        if (typeof left === 'string') return left.localeCompare(right) * factor;
        return ((left || 0) - (right || 0)) * factor;
      });
    }

    /* ---------- Traces ---------- */
    function tracesPage() {
      const s = state.snapshot;
      const rows = s.traces.filter((trace) => matchesSearch(trace.name + ' ' + (trace.route || '') + ' ' + trace.traceId));
      const selectedId = state.traceId;
      const trace = state.trace && state.trace.traceId === selectedId ? state.trace.spans : null;
      const selectedSpan = trace ? trace.find((span) => span.spanId === state.selectedSpan) : null;
      return '<div class="toolbar"><input class="search" data-search="1" placeholder="Filtrar por nome, rota ou trace id" value="' + escapeHtml(state.search) + '"><span class="spacer"></span><span class="label">' + rows.length + ' traces recentes · ' + compact(s.overview.retainedSpans) + ' spans retidos</span></div>' +
        '<div class="two-col traces"><section class="panel"><div class="table-scroll"><table><thead><tr><th style="width:80px">Hora</th><th>Trace</th><th class="num" style="width:76px">Duração</th><th class="num" style="width:60px">Spans</th><th style="width:70px">Status</th></tr></thead><tbody>' +
        (rows.length ? rows.map((t) => '<tr class="clickable ' + (t.traceId === selectedId ? 'selected' : '') + (t.status === 'error' ? ' slow' : '') + '" data-trace-id="' + escapeHtml(t.traceId) + '"><td>' + time(t.startedAt) + '</td><td class="mono" title="' + escapeHtml(t.traceId) + '">' + (t.method ? '<span class="badge ' + escapeHtml(t.method) + '">' + escapeHtml(t.method) + '</span> ' + escapeHtml(t.route || '') : escapeHtml(t.name)) + '</td><td class="num">' + t.durationMs + ' ms</td><td class="num">' + t.spanCount + (t.errorCount ? ' <span style="color:#fb7185">(' + t.errorCount + '!)</span>' : '') + '</td><td>' + (t.statusCode ? '<span class="badge b-' + statusClass(t.statusCode) + ' mono">' + t.statusCode + '</span>' : '<span class="badge ' + (t.status === 'error' ? 'b-5xx' : 'b-ok') + '">' + (t.status === 'error' ? 'erro' : 'ok') + '</span>') + '</td></tr>').join('') : '<tr><td colspan="5" class="muted">Nenhum trace</td></tr>') +
        '</tbody></table></div></section>' +
        '<div class="err-detail" data-scroll="trace">' + (selectedId ? (trace ? traceDetail(trace, selectedSpan) : '<div class="empty">Carregando trace ' + escapeHtml(selectedId) + '…</div>') : '<div class="empty">Selecione um trace para ver o waterfall dos spans</div>') + '</div></div>';
    }
    function traceDetail(spans, selectedSpan) {
      if (!spans.length) return '<div class="empty">Trace sem spans retidos (podem ter expirado)</div>';
      const root = spans.find((span) => !span.parentSpanId) || spans[0];
      const start = Math.min(...spans.map((span) => Date.parse(span.startedAt)));
      const end = Math.max(...spans.map((span) => Date.parse(span.endedAt)));
      const errors = spans.filter((span) => span.status === 'error');
      const kinds = {};
      spans.forEach((span) => { const key = spanKind(span); kinds[key] = (kinds[key] || 0) + span.durationMs; });
      return '<div class="head"><h3>' + escapeHtml(root.name) + '</h3><div class="badges"><span class="badge b-muted mono">' + escapeHtml(root.traceId) + '</span><span class="badge b-kind">' + spans.length + ' spans</span><span class="badge b-muted">' + (end - start) + ' ms</span>' + (errors.length ? '<span class="badge b-5xx">' + errors.length + ' com erro</span>' : '<span class="badge b-ok">sem erros</span>') + '<span class="badge b-muted">' + dateTime(root.startedAt) + '</span></div>' +
        '<div class="chips" style="margin-top:8px">' + Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([kind, total]) => '<span><i style="background:' + kindColor(kind) + '"></i>' + escapeHtml(kindLabel(kind)) + ' <b>' + total + ' ms</b></span>').join('') + '</div></div>' +
        '<div class="block">' + traceWaterfall(spans, selectedSpan ? selectedSpan.spanId : null, true) + '</div>' +
        (selectedSpan ? '<div class="block"><h4>' + escapeHtml(selectedSpan.name) + ' <span class="muted">' + selectedSpan.durationMs + ' ms · ' + escapeHtml(kindLabel(spanKind(selectedSpan))) + '</span></h4>' +
          (selectedSpan.error ? '<div class="cause" style="margin:0 0 10px"><div class="title">' + escapeHtml(selectedSpan.error.name) + ': ' + escapeHtml(selectedSpan.error.message) + '</div>' + (selectedSpan.error.stack ? '<pre class="stack" style="margin-top:6px">' + escapeHtml(selectedSpan.error.stack) + '</pre>' : '') + '</div>' : '') +
          '<div class="kvt">' + kvt('span id', '<span class="mono">' + escapeHtml(selectedSpan.spanId) + '</span>') + (selectedSpan.parentSpanId ? kvt('parent', '<span class="mono">' + escapeHtml(selectedSpan.parentSpanId) + '</span>') : '') + kvt('início', dateTime(selectedSpan.startedAt)) + kvt('fim', dateTime(selectedSpan.endedAt)) + Object.entries(selectedSpan.attributes || {}).map(([key, value]) => kvt('<span class="mono">' + escapeHtml(key) + '</span>', attributeValue(value))).join('') + '</div></div>' : '<div class="block muted">Clique em um span para ver atributos e erro</div>');
    }
    function traceWaterfall(spans, highlightId, clickable) {
      if (!spans || !spans.length) return '<div class="empty small">Trace indisponível: os spans podem ter saído da retenção</div>';
      const start = Math.min(...spans.map((span) => Date.parse(span.startedAt)));
      const end = Math.max(...spans.map((span) => Date.parse(span.endedAt)));
      const total = Math.max(1, end - start);
      const byId = new Map(spans.map((span) => [span.spanId, span]));
      const children = new Map();
      const roots = [];
      const byStart = (a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt) || b.durationMs - a.durationMs;
      spans.forEach((span) => {
        if (span.parentSpanId && byId.has(span.parentSpanId)) {
          if (!children.has(span.parentSpanId)) children.set(span.parentSpanId, []);
          children.get(span.parentSpanId).push(span);
        } else roots.push(span);
      });
      const rows = [];
      const walk = (span, depth) => { rows.push({ span, depth }); (children.get(span.spanId) || []).sort(byStart).forEach((child) => walk(child, depth + 1)); };
      roots.sort(byStart).forEach((root) => walk(root, 0));
      return '<div class="waterfall">' + rows.map(({ span, depth }) => {
        const kind = spanKind(span);
        const left = (Date.parse(span.startedAt) - start) / total * 100;
        const width = Math.max(0.6, span.durationMs / total * 100);
        return '<div class="span-row ' + (clickable ? 'clickable' : '') + (span.spanId === highlightId ? ' selected' : '') + '" data-span-id="' + escapeHtml(span.spanId) + '" title="' + escapeHtml(span.name) + '"><div class="nm" style="padding-left:' + (depth * 14) + 'px"><i style="background:' + kindColor(kind) + '"></i>' + (span.status === 'error' ? '<span class="err">!</span>' : '') + '<span>' + escapeHtml(span.name) + '</span></div><div class="bar-track"><div class="bar k-' + kind + (span.status === 'error' ? ' error' : '') + '" style="left:' + left + '%;width:' + Math.min(width, 100 - left) + '%"></div></div><div class="dur">' + span.durationMs + ' ms</div></div>';
      }).join('') + '</div>';
    }
    function spanKind(span) {
      const category = span.attributes && span.attributes['pulse.category'];
      if (category) return String(category);
      if (['server', 'handler', 'process'].includes(span.kind)) return span.kind;
      return 'internal';
    }
    function kindColor(kind) {
      return { server: '#FF2D55', handler: '#F97316', database: '#8B5CF6', redis: '#22C55E', job: '#38BDF8', process: '#F59E0B' }[kind] || '#6b7280';
    }
    function kindLabel(kind) {
      return { server: 'HTTP', handler: 'Handler', database: 'Banco', redis: 'Redis', job: 'Job', process: 'Processo', internal: 'Interno', rpc: 'RPC', ws: 'WebSocket' }[kind] || kind;
    }

    /* ---------- Métricas ---------- */
    function metricsPage() {
      const s = state.snapshot;
      const rows = s.metrics.filter((row) => matchesSearch(row.name));
      return '<div class="toolbar"><input class="search" data-search="1" placeholder="Filtrar métricas" value="' + escapeHtml(state.search) + '"><span class="spacer"></span><span class="label">' + s.metrics.length + ' métricas · ' + compact(s.recentMetrics.length) + ' registros recentes</span></div>' +
        '<section class="panel"><div class="panel-head"><strong>Métricas customizadas</strong><span class="label">tracer.counter() · gauge() · histogram()</span></div>' +
        (rows.length ? '<div class="table-scroll"><table><thead><tr><th>Nome</th><th>Tipo</th><th class="num">Registros</th><th class="num">Último</th><th class="num">Mín</th><th class="num">Média</th><th class="num">Máx</th><th class="num">Soma</th><th>Atributos</th><th class="num">Última vez</th></tr></thead><tbody>' +
          rows.map((m) => '<tr><td class="mono">' + escapeHtml(m.name) + '</td><td><span class="badge b-kind">' + escapeHtml(m.type) + '</span></td><td class="num">' + compact(m.count) + '</td><td class="num">' + number(m.last) + '</td><td class="num">' + number(m.min) + '</td><td class="num">' + number(m.avg) + '</td><td class="num">' + number(m.max) + '</td><td class="num">' + number(m.sum) + '</td><td class="mono" title="' + escapeHtml(JSON.stringify(m.attributes)) + '">' + escapeHtml(Object.entries(m.attributes).map(([key, value]) => key + '=' + value).join(' ') || '—') + '</td><td class="num rel">' + relative(m.lastAt) + '</td></tr>').join('') + '</tbody></table></div>'
          : '<div class="empty small">Nenhuma métrica customizada registrada. Use tracer.counter(nome).increment() na aplicação.</div>') + '</section>' +
        '<div class="grid even" style="margin-top:12px"><section class="panel"><div class="panel-head"><strong>Spans por tipo</strong><span class="label">' + compact(s.overview.retainedSpans) + ' retidos</span></div>' + breakdownTable(s.spanBreakdown) + '</section>' +
        '<section class="panel"><div class="panel-head"><strong>Eventos do processo</strong><span class="label">uncaughtException · unhandledRejection · warning</span></div>' +
        (s.processEvents.length ? '<div class="events" style="padding-top:10px">' + s.processEvents.map((event) => '<div class="event"><div class="t">' + escapeHtml(event.attributes['event.kind'] || event.name) + ' · ' + escapeHtml(event.error ? event.error.name + ': ' + event.error.message : '') + '</div><div class="rel">' + dateTime(event.startedAt) + '</div>' + (event.error && event.error.stack ? '<details class="raw" data-key="ev-' + escapeHtml(event.spanId) + '" style="margin-top:6px"><summary>Stack</summary><pre class="stack">' + escapeHtml(event.error.stack) + '</pre></details>' : '') + '</div>').join('') + '</div>' : '<div class="empty small">Nenhum evento de processo</div>') + '</section></div>' +
        '<section class="panel" style="margin-top:12px"><div class="panel-head"><strong>Registros recentes</strong></div>' +
        (s.recentMetrics.length ? '<div class="table-scroll"><table><thead><tr><th>Hora</th><th>Nome</th><th>Tipo</th><th class="num">Valor</th><th>Atributos</th></tr></thead><tbody>' + s.recentMetrics.slice(0, 50).map((m) => '<tr><td>' + time(m.recordedAt) + '</td><td class="mono">' + escapeHtml(m.name) + '</td><td>' + escapeHtml(m.type) + '</td><td class="num">' + number(m.value) + '</td><td class="mono">' + escapeHtml(Object.entries(m.attributes).map(([key, value]) => key + '=' + value).join(' ') || '—') + '</td></tr>').join('') + '</tbody></table></div>' : '<div class="empty small">Nenhum registro</div>') + '</section>';
    }

    /* ---------- Redis / Banco / Queues / Jobs ---------- */
    function redisPage() {
      const redis = state.snapshot.redis;
      if (!redis || redis.status === 'unconfigured') return '<section class="panel"><div class="panel-head"><strong>Redis</strong></div><div class="empty">Redis não configurado</div></section>' + operationList('redis');
      if (redis.status !== 'connected') return '<section class="panel"><div class="panel-head"><strong>Redis</strong><span style="color:var(--critical)">Indisponível</span></div><div class="empty">Não foi possível consultar o Redis</div><div class="label">Última tentativa: ' + time(redis.checkedAt) + '</div></section>' + operationList('redis');
      const m = redis.metrics;
      const count = (value) => value === null ? '-' : compact(value);
      return '<div class="server-meta"><strong style="color:var(--green)">Redis conectado</strong><span>Versão ' + escapeHtml(m.version) + '</span><span>' + escapeHtml(m.role) + '</span><span>' + time(redis.checkedAt) + '</span></div>' +
        '<div class="metrics">' + metric('Latência PING', m.latencyMs.toFixed(2) + ' ms', '', m.latencyMs > 100 ? 'bad' : '') +
        metric('Memória utilizada', m.usedMemory === null ? '-' : bytes(m.usedMemory), m.maxMemory === null ? '' : m.maxMemory === 0 ? 'Sem limite configurado' : 'Limite: ' + bytes(m.maxMemory), '') +
        metric('Clientes conectados', count(m.clients), 'Bloqueados: ' + count(m.blockedClients), '') +
        metric('Operações / segundo', count(m.opsPerSecond), '', '') +
        metric('Acertos do cache', m.hitRate === null ? '-' : m.hitRate.toFixed(1) + '%', 'Hits: ' + count(m.hits) + ' / Misses: ' + count(m.misses), '') +
        metric('Chaves removidas por memória', count(m.evictedKeys), 'Expiradas: ' + count(m.expiredKeys), m.evictedKeys > 0 ? 'bad' : '') +
        '</div><section class="panel" style="margin-top:24px"><div class="panel-head"><strong>Bancos Redis</strong></div>' +
        (m.databases.length ? '<table><thead><tr><th>Banco</th><th class="num">Chaves</th><th class="num">Com expiração</th></tr></thead><tbody>' + m.databases.map((db) => '<tr><td>' + escapeHtml(db.name) + '</td><td class="num">' + db.keys + '</td><td class="num">' + db.expires + '</td></tr>').join('') + '</tbody></table>' : '<div class="empty">Nenhum banco com chaves informado</div>') + '</section>' + operationList('redis');
    }
    function operationList(category) {
      const spans = state.snapshot.spans.filter((span) => span.attributes['pulse.category'] === category);
      return '<section class="panel" style="margin-top:24px"><div class="panel-head"><strong>Operações recentes</strong><span class="label">' + spans.length + ' spans</span></div>' + (spans.length ? '<div class="table-scroll"><table><thead><tr><th style="width:90px">Hora</th><th>Operação</th><th class="num" style="width:90px">Duração</th><th style="width:90px">Status</th><th>Trace</th></tr></thead><tbody>' + spans.slice(0, 50).map((span) => '<tr class="clickable ' + (span.error ? 'slow' : '') + '" data-open-trace="' + escapeHtml(span.traceId) + '"><td>' + time(span.endedAt) + '</td><td class="mono" title="' + escapeHtml(span.error ? span.error.message : span.name) + '">' + escapeHtml(span.name) + (span.error ? ' <span class="muted">— ' + escapeHtml(span.error.message) + '</span>' : '') + '</td><td class="num">' + span.durationMs.toFixed(1) + ' ms</td><td>' + (span.error ? '<span class="badge b-5xx">Falha</span>' : '<span class="badge b-ok">OK</span>') + '</td><td class="mono muted">' + escapeHtml(span.traceId) + '</td></tr>').join('') + '</tbody></table></div>' : '<div class="empty small">Nenhuma operação registrada</div>') + '</section>';
    }
    function databasePage() {
      const db = state.snapshot.database;
      let body = '<div class="empty">' + (db?.status === 'unavailable' ? 'Banco indisponível' : 'Banco não configurado') + '</div>';
      if (db?.status === 'connected') {
        const m = db.metrics;
        body = '<div class="metrics">' + metric('Latência', m.latencyMs.toFixed(1) + ' ms', '', '') + metric('Conexões', m.connections, '', '') + metric('Commits', compact(m.commits), '', '') + metric('Rollbacks', compact(m.rollbacks), '', '') + metric('Deadlocks', m.deadlocks, '', m.deadlocks > 0 ? 'bad' : '') + metric('Cache hit', m.cacheHitRate === null ? '-' : m.cacheHitRate.toFixed(1) + '%', '', '') + '</div>';
      }
      return '<section class="panel"><div class="panel-head"><strong>PostgreSQL</strong>' + (db && db.checkedAt ? '<span class="label">' + time(db.checkedAt) + '</span>' : '') + '</div>' + body + '</section>' + operationList('database');
    }
    function queuesPage() {
      const rabbit = state.snapshot.rabbitmq;
      const queues = state.snapshot.queues?.queues || [];
      let html = rabbit && rabbit.status !== 'unconfigured' ? rabbitPanel(rabbit) : '';
      html += queues.map((q) => '<section class="panel" style="margin-bottom:24px"><div class="panel-head"><strong>' + escapeHtml(q.name) + '</strong><span>' + (q.status === 'connected' ? q.paused ? 'Pausada' : 'Conectada' : 'Indisponivel') + '</span></div>' + (q.counts ? '<div class="metrics">' + [['waiting','Em espera'],['active','Ativos'],['completed','Concluidos'],['failed','Falhas'],['delayed','Agendados'],['waiting-children','Dependencias']].map(([key,label]) => metric(label, q.counts[key] || 0, '', key === 'failed' && q.counts[key] > 0)).join('') + '</div>' : '') + '</section>').join('');
      return html || '<div class="empty">Nenhuma fila configurada</div>';
    }
    function rabbitPanel(rabbit) {
      if (rabbit.status !== 'connected') return '<section class="panel" style="margin-bottom:24px"><div class="panel-head"><strong>RabbitMQ</strong><span>Indisponivel</span></div><div class="empty">Management API indisponivel</div></section>';
      const m = rabbit.metrics;
      const count = (value) => value === null || value === undefined ? '-' : compact(value);
      const rate = (value) => value === null || value === undefined ? '-' : value.toFixed(1) + '/s';
      const rows = rabbit.queues || [];
      return '<section class="panel" style="margin-bottom:24px"><div class="panel-head"><strong>RabbitMQ</strong><span>' + (m.version ? 'Versao ' + escapeHtml(m.version) + ' · ' : '') + time(rabbit.checkedAt) + '</span></div>' +
        '<div class="metrics">' + metric('Latencia', m.latencyMs.toFixed(1) + ' ms', '', false) + metric('Conexoes', count(m.connections), '', false) + metric('Canais', count(m.channels), '', false) + metric('Consumidores', count(m.consumers), '', m.consumers === 0) + metric('Mensagens', count(m.messages), '', false) + metric('Prontas', count(m.ready), '', false) + metric('Sem ack', count(m.unacknowledged), '', m.unacknowledged > 0) + metric('Publicacao', rate(m.publishRate), '', false) + metric('Entrega', rate(m.deliverRate), '', false) + '</div>' +
        (rows.length ? '<div class="label" style="padding:0 16px 8px">Clique em uma fila para ver todos os dados dela</div><table><thead><tr><th>Fila</th><th>Estado</th><th>Mensagens</th><th>Prontas</th><th>Sem ack</th><th>Consumidores</th></tr></thead><tbody>' + rows.map((queue) => '<tr class="clickable ' + (state.rabbitQueue && state.rabbitQueue.name === queue.name && state.rabbitQueue.vhost === queue.vhost ? 'selected ' : '') + (queue.state !== 'running' || queue.consumers === 0 ? 'slow' : '') + '" data-rabbit-queue="' + escapeHtml(queue.name) + '" data-rabbit-vhost="' + escapeHtml(queue.vhost) + '"><td>' + escapeHtml(queue.name) + '</td><td>' + escapeHtml(queue.state) + '</td><td>' + compact(queue.messages) + '</td><td>' + compact(queue.ready) + '</td><td>' + compact(queue.unacknowledged) + '</td><td>' + queue.consumers + '</td></tr>').join('') + '</tbody></table>' : '<div class="empty">Nenhuma fila no vhost</div>') + '</section>' + (state.rabbitQueue ? rabbitQueuePanel() : '');
    }
    async function loadRabbitQueue() {
      const selected = state.rabbitQueue;
      if (!selected) return;
      try {
        const response = await fetch(window.__PULSE__.basePath + '/api/rabbitmq/queue?name=' + encodeURIComponent(selected.name) + '&vhost=' + encodeURIComponent(selected.vhost));
        const detail = await response.json();
        if (!detail || !detail.status) throw new Error('HTTP ' + response.status);
        if (state.rabbitQueue === selected) state.rabbitQueueDetail = detail;
      } catch {
        if (state.rabbitQueue === selected) state.rabbitQueueDetail = { status: 'unavailable', checkedAt: new Date().toISOString(), name: selected.name, vhost: selected.vhost };
      }
    }
    function rabbitQueuePanel() {
      const selected = state.rabbitQueue;
      const detail = state.rabbitQueueDetail;
      const head = '<div class="panel-head"><strong>Fila ' + escapeHtml(selected.name) + '</strong><span>' + (detail ? time(detail.checkedAt) : 'Carregando...') + '</span></div>';
      if (!detail) return '<section class="panel" style="margin-bottom:24px">' + head + '<div class="empty">Carregando detalhes...</div></section>';
      if (detail.status !== 'connected') return '<section class="panel" style="margin-bottom:24px">' + head + '<div class="empty">' + (detail.status === 'missing' ? 'Fila nao encontrada no vhost' : detail.status === 'unavailable' ? 'Management API indisponivel' : 'RabbitMQ nao configurado') + '</div></section>';
      const queue = detail.queue || {};
      const stats = queue.message_stats || {};
      const val = (value) => value === null || value === undefined || value === '' ? '-' : typeof value === 'object' ? escapeHtml(JSON.stringify(value)) : escapeHtml(value);
      const yesNo = (value) => value === true ? 'Sim' : value === false ? 'Nao' : '-';
      const size = (value) => typeof value !== 'number' ? '-' : value < 1048576 ? (value / 1024).toFixed(1) + ' KB' : bytes(value);
      const percent = (value) => typeof value === 'number' ? (value * 100).toFixed(0) + '%' : '-';
      const stat = (key) => (typeof stats[key] === 'number' ? compact(stats[key]) : '-') + ' · ' + (stats[key + '_details'] && typeof stats[key + '_details'].rate === 'number' ? stats[key + '_details'].rate.toFixed(1) + '/s' : '-');
      const kv = (pairs) => '<div class="kv">' + pairs.map((pair) => '<div><div class="label">' + pair[0] + '</div><div title="' + pair[1] + '">' + pair[1] + '</div></div>').join('') + '</div>';
      const group = (title, body) => '<div class="panel-head subhead"><strong>' + title + '</strong></div>' + body;
      const args = queue.arguments && typeof queue.arguments === 'object' ? Object.entries(queue.arguments) : [];
      const consumers = Array.isArray(queue.consumer_details) ? queue.consumer_details : [];
      const bindings = detail.bindings || [];
      return '<section class="panel" style="margin-bottom:24px">' + head +
        kv([['Vhost', val(queue.vhost || detail.vhost)], ['Tipo', val(queue.type)], ['Estado', val(queue.state)], ['Node', val(queue.node)], ['Duravel', yesNo(queue.durable)], ['Auto delete', yesNo(queue.auto_delete)], ['Exclusiva', yesNo(queue.exclusive)], ['Politica', val(queue.policy)], ['Consumidores', val(queue.consumers)], ['Utilizacao dos consumidores', percent(queue.consumer_utilisation)], ['Ociosa desde', val(queue.idle_since)], ['Memoria', size(queue.memory)]]) +
        group('Mensagens', kv([['Total', val(queue.messages)], ['Prontas', val(queue.messages_ready)], ['Sem ack', val(queue.messages_unacknowledged)], ['Persistentes', val(queue.messages_persistent)], ['Em RAM', val(queue.messages_ram)], ['Bytes', size(queue.message_bytes)], ['Bytes prontas', size(queue.message_bytes_ready)], ['Bytes sem ack', size(queue.message_bytes_unacknowledged)]])) +
        group('Taxas (total · por segundo)', kv([['Publicadas', stat('publish')], ['Entregues', stat('deliver_get')], ['Ack', stat('ack')], ['Reentregues', stat('redeliver')], ['Entregues sem ack', stat('deliver_no_ack')], ['Get', stat('get')]])) +
        group('Argumentos', args.length ? '<table><thead><tr><th>Argumento</th><th>Valor</th></tr></thead><tbody>' + args.map((pair) => '<tr><td>' + escapeHtml(pair[0]) + '</td><td title="' + val(pair[1]) + '">' + val(pair[1]) + '</td></tr>').join('') + '</tbody></table>' : '<div class="empty">Sem argumentos</div>') +
        group('Consumidores', consumers.length ? '<table><thead><tr><th>Tag</th><th>Prefetch</th><th>Ack</th><th>Conexao</th><th>Usuario</th></tr></thead><tbody>' + consumers.map((consumer) => { const channel = consumer.channel_details || {}; return '<tr><td>' + val(consumer.consumer_tag) + '</td><td>' + val(consumer.prefetch_count) + '</td><td>' + (consumer.ack_required === false ? 'Automatico' : 'Manual') + '</td><td>' + val(channel.connection_name || (channel.peer_host ? channel.peer_host + ':' + channel.peer_port : '')) + '</td><td>' + val(channel.user) + '</td></tr>'; }).join('') + '</tbody></table>' : '<div class="empty">Nenhum consumidor</div>') +
        group('Bindings', bindings.length ? '<table><thead><tr><th>Exchange</th><th>Routing key</th><th>Argumentos</th></tr></thead><tbody>' + bindings.map((binding) => '<tr><td>' + (binding.source ? escapeHtml(binding.source) : '(default)') + '</td><td>' + val(binding.routing_key) + '</td><td>' + (binding.arguments && Object.keys(binding.arguments).length ? val(binding.arguments) : '-') + '</td></tr>').join('') + '</tbody></table>' : '<div class="empty">Sem bindings</div>') +
        '<details class="error-item" data-error="rabbit-json"><summary>JSON completo</summary><pre>' + escapeHtml(JSON.stringify({ queue: queue, bindings: bindings }, null, 2)) + '</pre></details></section>';
    }
    function jobsPage() {
      const jobs = (state.snapshot.queues?.queues || []).flatMap((queue) => (queue.jobs || []).map((job) => ({...job, queue: queue.name})));
      const active = state.snapshot.activeJobs || [];
      return '<section class="panel"><div class="panel-head"><strong>Jobs BullMQ</strong></div>' + (jobs.length ? jobs.map((job) => '<details class="error-item" data-error="' + escapeHtml(job.queue + ':' + job.id) + '"><summary>' + escapeHtml(job.name) + ' · ' + escapeHtml(job.queue) + ' · ' + escapeHtml(job.state) + '</summary><div class="label">ID ' + escapeHtml(job.id) + ' · Tentativas ' + job.attempts + ' · ' + time(job.timestamp) + '</div><pre>' + escapeHtml(job.failedReason || '') + '</pre></details>').join('') : '<div class="empty">Nenhum job disponivel</div>') + '</section><section class="panel"><div class="panel-head"><strong>Jobs locais em execucao</strong></div>' + (active.length ? active.map((job) => '<div class="error-item">' + escapeHtml(job.name) + ' · ' + time(job.timestamp) + '</div>').join('') : '<div class="label">Nenhum job ativo</div>') + '</section>' + operationList('job');
    }

    /* ---------- Interação ---------- */
    content.addEventListener('click', (event) => {
      const row = event.target.closest('tr[data-rabbit-queue]');
      if (row) {
        const current = state.rabbitQueue;
        const same = current && current.name === row.dataset.rabbitQueue && current.vhost === row.dataset.rabbitVhost;
        state.rabbitQueue = same ? null : { name: row.dataset.rabbitQueue, vhost: row.dataset.rabbitVhost };
        state.rabbitQueueDetail = null;
        render();
        if (state.rabbitQueue) loadRabbitQueue().then(render);
        return;
      }
      const metricButton = event.target.closest('button[data-metric]');
      if (metricButton) {
        const [scope, value] = metricButton.dataset.metric.split(':');
        state.metric[scope] = value;
        return render();
      }
      const rangeButton = event.target.closest('button[data-range]');
      if (rangeButton) { state.range = rangeButton.dataset.range; return render(); }
      const filterButton = event.target.closest('button[data-filter]');
      if (filterButton) { state.errorFilter = filterButton.dataset.filter; return render(); }
      const goto = event.target.closest('[data-goto]');
      if (goto) { state.page = goto.dataset.goto; state.search = ''; writeHash(); render(); return window.scrollTo(0, 0); }
      const sortHeader = event.target.closest('th.sortable[data-sort]');
      if (sortHeader) {
        const key = sortHeader.dataset.sort;
        state.sort = { key, dir: state.sort.key === key && state.sort.dir === 'desc' ? 'asc' : 'desc' };
        return render();
      }
      const toggleFrames = event.target.closest('button[data-toggle-frames]');
      if (toggleFrames) { state.allFrames = !state.allFrames; return render(); }
      const copy = event.target.closest('button[data-copy]');
      if (copy) {
        const source = document.getElementById(copy.dataset.copy);
        if (source && navigator.clipboard) navigator.clipboard.writeText(source.textContent).then(() => { copy.textContent = 'Copiado'; setTimeout(() => { copy.textContent = 'Copiar'; }, 1500); }).catch(() => undefined);
        return;
      }
      const errorItem = event.target.closest('[data-error-id]');
      if (errorItem) {
        state.selectedError = errorItem.dataset.errorId;
        state.selectedSample = 0;
        state.errorDetail = null;
        state.allFrames = false;
        if (state.page !== 'Erros') { state.page = 'Erros'; state.search = ''; }
        writeHash();
        render();
        return refreshDetail();
      }
      const sample = event.target.closest('[data-sample]');
      if (sample) {
        state.selectedSample = Number(sample.dataset.sample);
        render();
        return refreshDetail();
      }
      const openTrace = event.target.closest('[data-open-trace]');
      if (openTrace) {
        state.traceId = openTrace.dataset.openTrace;
        state.selectedSpan = null;
        state.page = 'Traces';
        state.search = '';
        writeHash();
        render();
        window.scrollTo(0, 0);
        return refreshTrace();
      }
      const traceRow = event.target.closest('tr[data-trace-id]');
      if (traceRow) {
        state.traceId = traceRow.dataset.traceId;
        state.selectedSpan = null;
        writeHash();
        render();
        return refreshTrace();
      }
      const spanRow = event.target.closest('.span-row.clickable[data-span-id]');
      if (spanRow) { state.selectedSpan = spanRow.dataset.spanId; return render(); }
    });
    content.addEventListener('input', (event) => {
      const input = event.target.closest('input[data-search]');
      if (!input) return;
      state.search = input.value;
      render();
    });
    async function refreshDetail() {
      if (!state.selectedError) return;
      try {
        const detail = await api('errors/' + encodeURIComponent(state.selectedError));
        if (detail.id !== state.selectedError) return;
        state.errorDetail = detail;
        const sample = detail.samples[Math.min(state.selectedSample, detail.samples.length - 1)] || detail.latest;
        if (sample && (!state.trace || state.trace.traceId !== sample.traceId)) {
          state.trace = await api('traces/' + encodeURIComponent(sample.traceId));
          if (state.page !== 'Traces') state.traceId = sample.traceId;
        }
        render();
      } catch (error) { /* the next snapshot poll retries */ }
    }
    async function refreshTrace() {
      if (!state.traceId) return;
      try {
        state.trace = await api('traces/' + encodeURIComponent(state.traceId));
        render();
      } catch (error) { /* retried on the next poll */ }
    }
    // When the page opens with a selection in the URL, load the detail and its trace right away.
    if (state.selectedError) refreshDetail();

    /* ---------- Gráficos ---------- */
    function drawCharts() {
      charts.clear();
      const s = state.snapshot;
      const main = document.querySelector('#mainChart');
      if (main) drawLine(main, overviewSeries(state.metric.overview), { labels: s.timeseries.map((p) => p.time), format: state.metric.overview === 'latency' ? (value) => value.toFixed(0) + ' ms' : (value) => compact(Math.round(value)) });
      const server = document.querySelector('#serverChart');
      if (server) {
        const history = state.range === '6h' ? s.serverHistoryLong : s.serverHistory;
        drawLine(server, serverSeries(state.metric.server, history), { labels: history.map((p) => p.time), format: serverFormatter(state.metric.server) });
      }
      content.querySelectorAll('canvas.spark[data-spark]').forEach((canvas) => {
        const key = canvas.dataset.spark;
        drawLine(canvas, [{ values: s.serverHistory.map((p) => p[key]), color: '#E0234E', fill: true }], { compact: true });
      });
      content.querySelectorAll('canvas.spark[data-spark-ts]').forEach((canvas) => {
        const key = canvas.dataset.sparkTs;
        drawLine(canvas, [{ values: s.timeseries.map((p) => p[key]), color: '#E0234E', fill: true }], { compact: true });
      });
      content.querySelectorAll('canvas[data-trend]').forEach((canvas) => {
        const group = s.errors.find((item) => item.id === canvas.dataset.trend);
        if (group) drawLine(canvas, [{ values: group.trend, color: '#fb7185', fill: true }], { compact: true, bars: true });
      });
    }
    function drawLine(canvas, series, options) {
      options = options || {};
      const ratio = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      canvas.width = Math.max(1, rect.width * ratio);
      canvas.height = Math.max(1, rect.height * ratio);
      const ctx = canvas.getContext('2d');
      ctx.scale(ratio, ratio);
      ctx.clearRect(0, 0, rect.width, rect.height);
      const all = series.flatMap((item) => item.values).filter((value) => Number.isFinite(value));
      const max = Math.max(...all, options.compact ? 1 : 0.0001);
      const padTop = options.compact ? 2 : 12;
      const padBottom = options.compact ? 2 : 22;
      const padLeft = options.compact ? 0 : 54;
      const padRight = options.compact ? 0 : 8;
      const width = rect.width - padLeft - padRight;
      const height = rect.height - padTop - padBottom;
      const count = Math.max(...series.map((item) => item.values.length), 1);
      const x = (index) => padLeft + (count === 1 ? width / 2 : (index / (count - 1)) * width);
      const y = (value) => padTop + height - (Math.max(0, value) / Math.max(1e-9, max)) * height;
      if (!options.compact) {
        ctx.strokeStyle = '#242424';
        ctx.fillStyle = '#7a7a7a';
        ctx.font = '11px Inter, system-ui, sans-serif';
        ctx.textAlign = 'right';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 4; i++) {
          const value = max - (max / 4) * i;
          const py = padTop + (height / 4) * i;
          ctx.beginPath(); ctx.moveTo(padLeft, py); ctx.lineTo(rect.width - padRight, py); ctx.stroke();
          ctx.fillText((options.format || String)(value), padLeft - 8, py + 4);
        }
        if (options.labels && options.labels.length) {
          ctx.textAlign = 'left';
          ctx.fillText(time(options.labels[0]), padLeft, rect.height - 6);
          ctx.textAlign = 'right';
          ctx.fillText(time(options.labels[options.labels.length - 1]), rect.width - padRight, rect.height - 6);
          if (options.labels.length > 4) { ctx.textAlign = 'center'; ctx.fillText(time(options.labels[Math.floor(options.labels.length / 2)]), padLeft + width / 2, rect.height - 6); }
        }
      }
      series.forEach((item) => {
        const values = item.values;
        if (!values.length) return;
        if (options.bars) {
          const barWidth = Math.max(1, width / values.length - 1);
          ctx.fillStyle = item.color;
          values.forEach((value, index) => { if (value > 0) ctx.fillRect(padLeft + (index / values.length) * width, y(value), barWidth, padTop + height - y(value)); });
          return;
        }
        if (item.fill) {
          ctx.beginPath();
          values.forEach((value, index) => { index ? ctx.lineTo(x(index), y(value)) : ctx.moveTo(x(index), y(value)); });
          ctx.lineTo(x(values.length - 1), padTop + height); ctx.lineTo(x(0), padTop + height); ctx.closePath();
          ctx.fillStyle = hexToRgba(item.color, options.compact ? 0.18 : 0.12);
          ctx.fill();
        }
        ctx.strokeStyle = item.color;
        ctx.lineWidth = options.compact ? 1.5 : 2;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        values.forEach((value, index) => { index ? ctx.lineTo(x(index), y(value)) : ctx.moveTo(x(index), y(value)); });
        ctx.stroke();
      });
      if (!options.compact) charts.set(canvas, { series, options, geometry: { padLeft, width, count } });
    }
    content.addEventListener('mousemove', (event) => {
      const canvas = event.target.closest('canvas[data-chart]');
      const chart = canvas && charts.get(canvas);
      if (!chart) { tooltip.style.display = 'none'; return; }
      const rect = canvas.getBoundingClientRect();
      const { padLeft, width, count } = chart.geometry;
      const ratio = (event.clientX - rect.left - padLeft) / Math.max(1, width);
      const index = Math.max(0, Math.min(count - 1, Math.round(ratio * (count - 1))));
      const label = chart.options.labels && chart.options.labels[index] ? dateTime(chart.options.labels[index]) : '#' + index;
      tooltip.innerHTML = '<span class="label">' + escapeHtml(label) + '</span>' + chart.series.map((item) => '<div><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:' + item.color + ';margin-right:6px"></i>' + escapeHtml(item.label || '') + ' <b>' + escapeHtml((chart.options.format || String)(item.values[index] || 0)) + '</b></div>').join('');
      tooltip.style.display = 'block';
      const mainRect = content.getBoundingClientRect();
      let left = event.clientX - mainRect.left + 14;
      if (left + tooltip.offsetWidth > mainRect.width - 20) left = event.clientX - mainRect.left - tooltip.offsetWidth - 14;
      tooltip.style.left = left + 'px';
      tooltip.style.top = (event.clientY - mainRect.top + content.offsetTop - 10) + 'px';
    });
    content.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
    function legend(series) {
      return '<div class="legend">' + series.map((item) => '<span><i style="background:' + item.color + '"></i>' + escapeHtml(item.label || '') + '</span>').join('') + '</div>';
    }

    /* ---------- Componentes ---------- */
    function metric(label, value, delta, tone, spark) {
      const toneClass = tone === true ? 'bad' : tone === false ? '' : (tone || '');
      return '<article class="card"><div class="label">' + label + '</div><div class="value">' + value + '</div><div class="delta ' + toneClass + '">' + (delta || '') + '</div>' + (spark ? '<canvas class="spark" data-spark-ts="' + spark + '"></canvas>' : '') + '</article>';
    }
    function sparkCard(label, value, key, bad) {
      return '<article class="card compact"><div class="label">' + label + '</div><div class="value" style="' + (bad ? 'color:#fb7185' : '') + '">' + value + '</div><canvas class="spark" data-spark="' + key + '"></canvas></article>';
    }
    function sectionTitle(title, subtitle) { return '<div class="section-title"><h2>' + title + '</h2><span>' + (subtitle || '') + '</span></div>'; }
    function kvt(key, value) { return '<div>' + key + '</div><div>' + value + '</div>'; }
    // Attribute values that hold JSON (query, params, headers, body) are pretty-printed; everything else stays inline.
    function attributeValue(value) {
      const text = String(value === undefined || value === null ? '' : value);
      if (/^\s*[\[{]/.test(text)) {
        try { return '<pre class="stack" style="max-height:240px">' + escapeHtml(JSON.stringify(JSON.parse(text), null, 2)) + '</pre>'; } catch (error) { /* not JSON, fall through */ }
      }
      return '<span class="mono">' + escapeHtml(text) + '</span>';
    }
    function metaItem(label, value) { return '<div><div class="label">' + label + '</div><b>' + value + '</b></div>'; }
    function bar(percent, tone) { return '<div class="bar-line ' + (tone || '') + '"><i style="width:' + Math.max(0, Math.min(100, percent || 0)) + '%"></i></div>'; }
    function trendText(value) {
      if (value === null || value === undefined) return 'sem base de comparação';
      return (value > 0 ? '+' : '') + value.toFixed(1) + '% vs minuto anterior';
    }
    function trendClass(value, inverse) {
      if (value === null || value === undefined || Math.abs(value) < 0.05) return '';
      const good = inverse ? value < 0 : value > 0;
      return good ? 'good' : 'bad';
    }
    function matchesSearch(text) {
      const query = state.search.trim().toLowerCase();
      return !query || String(text).toLowerCase().includes(query);
    }
    function statusClass(status) { return status ? Math.floor(status / 100) + 'xx' : 'muted'; }
    function shortPath(location) { const parts = location.split(/[\\/]/); return parts.slice(-2).join('/'); }
    function gcLabel(kind) { return { minor: 'Minor (scavenge)', major: 'Major (mark-sweep)', incremental: 'Incremental', weakcb: 'Weak callbacks', other: 'Outros' }[kind] || kind; }
    function sumValues(object) { return Object.values(object || {}).reduce((sum, value) => sum + (Number(value) || 0), 0); }
    function hexToRgba(hex, alpha) {
      const value = hex.replace('#', '');
      const r = parseInt(value.slice(0, 2), 16); const g = parseInt(value.slice(2, 4), 16); const b = parseInt(value.slice(4, 6), 16);
      return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
    }
    function bytes(value) {
      value = Number(value) || 0;
      if (value >= 1099511627776) return (value / 1099511627776).toFixed(2) + ' TB';
      if (value >= 1073741824) return (value / 1073741824).toFixed(2) + ' GB';
      if (value >= 1048576) return (value / 1048576).toFixed(1) + ' MB';
      if (value >= 1024) return (value / 1024).toFixed(1) + ' KB';
      return value.toFixed(0) + ' B';
    }
    function rate(value) { return bytes(value) + '/s'; }
    function pct(value) { return (Number(value) || 0).toFixed(1) + '%'; }
    function ms(value) { value = Number(value) || 0; return value >= 1000 ? (value / 1000).toFixed(2) + ' s' : value.toFixed(value < 10 ? 2 : 1) + ' ms'; }
    function number(value) { value = Number(value) || 0; return Number.isInteger(value) ? compact(value) : value.toFixed(2); }
    function duration(seconds) {
      seconds = Math.max(0, Math.floor(Number(seconds) || 0));
      const days = Math.floor(seconds / 86400); const hours = Math.floor((seconds % 86400) / 3600); const minutes = Math.floor((seconds % 3600) / 60);
      if (days) return days + 'd ' + hours + 'h';
      if (hours) return hours + 'h ' + minutes + 'min';
      if (minutes) return minutes + 'min ' + (seconds % 60) + 's';
      return seconds + 's';
    }
    function relative(value) {
      const diff = Math.max(0, Date.now() - new Date(value).getTime());
      if (diff < 5000) return 'agora';
      if (diff < 60000) return 'há ' + Math.floor(diff / 1000) + ' s';
      if (diff < 3600000) return 'há ' + Math.floor(diff / 60000) + ' min';
      if (diff < 86400000) return 'há ' + Math.floor(diff / 3600000) + ' h';
      return 'há ' + Math.floor(diff / 86400000) + ' d';
    }
    function escapeHtml(value) { return String(value === undefined || value === null ? '' : value).replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])); }
    function compact(value) { const n = Number(value) || 0; return Math.abs(n) >= 1000000 ? (n / 1000000).toFixed(1) + 'M' : Math.abs(n) >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n); }
    function time(value) { return new Date(value).toLocaleTimeString(); }
    function dateTime(value) { return new Date(value).toLocaleString(); }
    function labelStatus(value) { return value === 'critical' ? 'Erros: crítico' : value === 'degraded' ? 'Erros: atenção' : 'Erros: normal'; }
    load(true);
    window.addEventListener('resize', drawCharts);
    setInterval(() => load(false), 5000);
  </script>
</body>
</html>`;
}
