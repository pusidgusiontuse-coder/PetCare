import { formatLocale, uiText, htmlUiText } from '../../i18n';
type Capacity = { total: number; available: number };
type CpuTimes = { total: number; idle: number };

export type Stats = {
  captured_at: string;
  users: number; pets: number; documents: number; active_sessions: number;
  load_average: number[] | null; cpu_times: CpuTimes | null; cpu_count: number | null;
  ram: Capacity | null; disk: Capacity | null; swap: { total: number; used: number } | null;
  host_uptime_seconds: number | null; worker_peak_memory_bytes: number;
  worker: { memory_bytes: number | null; threads: number | null; uptime_seconds: number | null } | null;
  smtp_configured: boolean; push_configured: boolean; ocr_configured: boolean;
};

const WINDOW_MS = 10 * 60 * 1000;
const number = new Intl.NumberFormat(formatLocale, { maximumFractionDigits: 2 });
const clock = new Intl.DateTimeFormat(formatLocale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function appendSample(samples: Stats[], sample: Stats) {
  const time = Date.parse(sample.captured_at);
  if (samples.length && time <= Date.parse(samples[samples.length - 1].captured_at)) return samples;
  return [...samples.filter(item => Date.parse(item.captured_at) >= time - WINDOW_MS), sample].slice(-120);
}

function bytes(value: number | null | undefined) {
  if (value == null) return '—';
  return value < 1024 ** 3 ? number.format(value / 1024 ** 2) + (" "+uiText("МБ")) : number.format(value / 1024 ** 3) + (" "+uiText("ГБ"));
}

function duration(seconds: number | null | undefined) {
  if (seconds == null) return '—';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return `< 1 ${uiText("мин")}`;
  const hours = Math.floor(minutes / 60);
  if (!hours) return minutes + (" "+uiText("мин"));
  if (hours < 24) return hours + (" "+uiText("ч")+" ") + (minutes % 60) + (" "+uiText("мин"));
  return Math.floor(hours / 24) + (" "+uiText("д")+" ") + (hours % 24) + (" "+uiText("ч"));
}

function cpuPercent(previous: Stats | undefined, current: Stats) {
  if (!previous?.cpu_times || !current.cpu_times) return null;
  const elapsed = Date.parse(current.captured_at) - Date.parse(previous.captured_at);
  const total = current.cpu_times.total - previous.cpu_times.total;
  const idle = current.cpu_times.idle - previous.cpu_times.idle;
  if (elapsed < 1000 || elapsed > 30_000 || total <= 0 || idle < 0) return null;
  return Math.max(0, Math.min(100, (total - idle) / total * 100));
}

type Series = { label: string; color: string; values: (number | null)[] };
const CAPACITY = 1024 ** 3;

function Graph({ title, samples, series, max, format }: {
  title: string; samples: Stats[]; series: Series[]; max: number; format: (n: number) => string;
}) {
  const times = samples.map(item => Date.parse(item.captured_at));
  const span = Math.max(10_000, times[times.length - 1] - times[0]);
  const xAt = (index: number) => 2 + 316 * (times[index] - times[0]) / span;
  const yAt = (value: number) => 88 - 86 * Math.min(max, Math.max(0, value)) / max;
  const hasTrend = series.some(line => line.values.filter(value => value != null).length >= 2);
  return <div className="admin-chart">
    <h3>{title}</h3>
    <div className="admin-chart-plot">
      <svg viewBox="0 0 320 90" preserveAspectRatio="none" aria-label={title} role="img">
        {[2, 45, 88].map(y => <path key={y} d={`M0 ${y}H320`} className="admin-chart-grid" />)}
        {series.map(line => {
          const path = line.values.map((value, index) => {
            if (value == null) return '';
            const connects = line.values[index - 1] != null && times[index] - times[index - 1] <= 30_000;
            return `${connects ? 'L' : 'M'}${xAt(index)},${yAt(value)}`;
          }).join('');
          const last = line.values[line.values.length - 1];
          return <g key={line.label} fill={line.color}>
            <path d={path} stroke={line.color} className="admin-chart-line" />
            {last != null && <circle cx={xAt(times.length - 1)} cy={yAt(last)} r={2} />}
          </g>;
        })}
      </svg>
      <span>{format(max)}</span><span>{format(0)}</span>
    </div>
    <div className="admin-chart-time">
      <span>{clock.format(times[0])}</span><span>{clock.format(times[times.length - 1])}</span>
    </div>
    <ul className="admin-chart-key">
      {series.map(line => {
        const value = line.values[line.values.length - 1];
        return <li key={line.label}><i style={{ backgroundColor: line.color }} />{line.label} <strong>{value == null ? '—' : format(value)}</strong></li>;
      })}
    </ul>
    {!hasTrend && <small className="admin-muted">{uiText("График появится по мере поступления замеров.")}</small>}
  </div>;
}

export function ServerMetrics({ samples, refreshError }: { samples: Stats[]; refreshError: boolean }) {
  const stats = samples[samples.length - 1];
  if (!stats) return <p className="admin-muted">{refreshError ? uiText("Не удалось получить показатели сервера.") : uiText("Загружаем показатели сервера…")}</p>;
  const loadMax = Math.max(1, Math.ceil(Math.max(...samples.flatMap(sample => sample.load_average ?? []))));
  const ramMax = Math.max(1, Math.ceil(Math.max(...samples.map(sample => (sample.ram?.total ?? 0) / CAPACITY))));
  const loadSeries = [(htmlUiText("1 мин")), (htmlUiText("5 мин")), (htmlUiText("15 мин"))].map((label, index) => ({
    label, color: ['#adf0c8', '#f7ca87', '#9ebffe'][index], values: samples.map(sample => sample.load_average?.[index] ?? null),
  }));
  const percent = (value: number) => Math.round(value) + '%';
  const gigabytes = (value: number) => number.format(value) + (" "+uiText("ГБ"));
  return <section className="admin-telemetry" aria-labelledby="server-metrics-title">
    <div className="admin-heading admin-telemetry-heading">
      <h2 id="server-metrics-title">{uiText("Состояние сервера")}</h2>
      <p className="admin-muted">{uiText("Замер в")+" "}<time dateTime={stats.captured_at}>{clock.format(Date.parse(stats.captured_at))}</time> · {refreshError ? uiText("связь потеряна, повторяем") : uiText("обновление каждые 10 сек")}</p>
    </div>
    <div className="admin-metrics">
      <Metric label={uiText("Доступно ОЗУ на хосте")} value={bytes(stats.ram?.available)} detail={stats.ram && `${uiText("Всего")+" "}${bytes(stats.ram.total)}`} />
      <Metric label={uiText("Свободно на разделе сайта")} value={bytes(stats.disk?.available)} detail={stats.disk && `${uiText("Всего")+" "}${bytes(stats.disk.total)}`} />
      <Metric label={uiText("Занято в подкачке")} value={bytes(stats.swap?.used)} detail={stats.swap && `${uiText("Всего")+" "}${bytes(stats.swap.total)}`} />
      <Metric label={uiText("Память процесса PetCare")} value={bytes(stats.worker?.memory_bytes)} detail={`${uiText("Пик")+" "}${bytes(stats.worker_peak_memory_bytes)}`} />
    </div>
    <div className="admin-charts">
      <Graph title={uiText("Средняя нагрузка хоста")} samples={samples} series={loadSeries} max={loadMax} format={n => number.format(n)} />
      <Graph title={uiText("Загрузка CPU хоста")} samples={samples} max={100} format={percent} series={[
        { label: uiText("Загрузка"), color: '#f7ca87', values: samples.map((sample, index) => cpuPercent(samples[index - 1], sample)) },
      ]} />
      <Graph title={uiText("Доступная ОЗУ хоста")} samples={samples} max={ramMax} format={gigabytes} series={[
        { label: uiText("Доступно"), color: '#9ebffe', values: samples.map(sample => sample.ram ? sample.ram.available / CAPACITY : null) },
      ]} />
    </div>
    <div className="admin-metrics">
      <Metric label={uiText("Логические ядра · время работы хоста")} value={`${stats.cpu_count ?? '—'} · ${duration(stats.host_uptime_seconds)}`} />
      <Metric label={uiText("Потоки · время работы процесса")} value={`${stats.worker?.threads ?? '—'} · ${duration(stats.worker?.uptime_seconds)}`} />
      <Metric label={uiText("Пользователи · активные сеансы")} value={`${stats.users} · ${stats.active_sessions}`} />
      <Metric label={uiText("Питомцы · документы")} value={`${stats.pets} · ${stats.documents}`} />
    </div>
    <p className="admin-muted admin-telemetry-note">
      {[`${uiText("Почта")+" "}${stats.smtp_configured ? '✓' : '—'}`, `Push ${stats.push_configured ? '✓' : '—'}`, `OCR ${stats.ocr_configured ? '✓' : '—'}`].join(' · ')}
      {(" · "+uiText("Графики за последние 10 минут в этой вкладке. Диск показан для раздела сайта."))}
    </p>
  </section>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string | null }) {
  return <div className="admin-metric"><span>{label}</span><strong>{value}</strong>{detail && <span>{detail}</span>}</div>;
}
