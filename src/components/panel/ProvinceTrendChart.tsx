import type { ProvinceTrendPoint } from '../../types/index.ts';

interface ProvinceTrendChartProps {
  trend: readonly ProvinceTrendPoint[];
  activePeriodId: string;
  onSelectPeriod: (periodId: string) => void;
}

export function ProvinceTrendChart({
  trend,
  activePeriodId,
  onSelectPeriod,
}: ProvinceTrendChartProps) {
  if (trend.length < 2) return null;

  const width = 340;
  const height = 108;
  const padLeft = 28;
  const padRight = 16;
  const padTop = 14;
  const padBottom = 24;
  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;

  const xFor = (idx: number) =>
    padLeft + (trend.length === 1 ? innerW / 2 : (idx / (trend.length - 1)) * innerW);
  const yFor = (score: number) => padTop + ((5.0 - Math.min(5, Math.max(1, score))) / 4.0) * innerH;

  const riskPoints = trend.map((pt, i) => `${xFor(i).toFixed(1)},${yFor(pt.ddpmScore).toFixed(1)}`).join(' ');
  const capPoints = trend.map((pt, i) => `${xFor(i).toFixed(1)},${yFor(pt.capacityScore).toFixed(1)}`).join(' ');

  const first = trend[0];
  const last = trend[trend.length - 1];
  const deltaR = +(last.ddpmScore - first.ddpmScore).toFixed(2);
  const deltaC = +(last.capacityScore - first.capacityScore).toFixed(2);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-1 text-[11px]">
        <span className="font-semibold text-[#0F294A]">
          แนวโน้มความเสี่ยงและศักยภาพรายงวด ({trend.length} งวด)
        </span>
        <div className="flex items-center gap-2.5 tabular-nums">
          <span className="inline-flex items-center gap-1 text-slate-700">
            <span className="h-2 w-2 rounded-full bg-[#DC2626]" aria-hidden="true" />
            ความเสี่ยง {deltaR > 0 ? `+${deltaR.toFixed(2)}` : deltaR.toFixed(2)}
          </span>
          <span className="inline-flex items-center gap-1 text-teal-800">
            <span className="h-2 w-2 rounded-full bg-[#0D9488]" aria-hidden="true" />
            ศักยภาพ {deltaC > 0 ? `+${deltaC.toFixed(2)}` : deltaC.toFixed(2)}
          </span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="กราฟเส้นแสดงแนวโน้มความเสี่ยงสุทธิและศักยภาพย้อนหลังรายงวด"
        className="w-full h-[108px] overflow-visible"
      >
        {[1, 2, 3, 4, 5].map((tick) => {
          const y = yFor(tick);
          return (
            <g key={tick}>
              <line
                x1={padLeft}
                x2={width - padRight}
                y1={y}
                y2={y}
                stroke="#E2E8F0"
                strokeWidth="1"
                strokeDasharray={tick === 3 ? '3 2' : undefined}
              />
              <text
                x={padLeft - 6}
                y={y + 3}
                textAnchor="end"
                className="fill-slate-400 text-[9px] tabular-nums"
              >
                {tick}
              </text>
            </g>
          );
        })}

        <polyline
          fill="none"
          stroke="#0D9488"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={capPoints}
        />
        <polyline
          fill="none"
          stroke="#DC2626"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={riskPoints}
        />

        {trend.map((pt, i) => {
          const cx = xFor(i);
          const cyR = yFor(pt.ddpmScore);
          const cyC = yFor(pt.capacityScore);
          const active = pt.periodId === activePeriodId;
          const shortCode = pt.periodId.replace(/^25(\d{2})-Q(\d)$/, 'ต.$2/$1');

          return (
            <g
              key={pt.periodId}
              className="cursor-pointer"
              onClick={() => onSelectPeriod(pt.periodId)}
            >
              {active && (
                <line
                  x1={cx}
                  x2={cx}
                  y1={padTop - 2}
                  y2={height - padBottom + 2}
                  stroke="#0F294A"
                  strokeWidth="1"
                  strokeDasharray="2 2"
                />
              )}
              <circle
                cx={cx}
                cy={cyC}
                r={active ? 4 : 3}
                fill="#0D9488"
                stroke="#FFFFFF"
                strokeWidth="1.2"
              >
                <title>{`${pt.labelTh}: ศักยภาพ ${pt.capacityScore.toFixed(2)}`}</title>
              </circle>
              <circle
                cx={cx}
                cy={cyR}
                r={active ? 4.5 : 3.2}
                fill="#DC2626"
                stroke={active ? '#0F294A' : '#FFFFFF'}
                strokeWidth={active ? '1.8' : '1.2'}
              >
                <title>{`${pt.labelTh}: ความเสี่ยงสุทธิ ${pt.ddpmScore.toFixed(2)}`}</title>
              </circle>
              <text
                x={cx}
                y={height - 6}
                textAnchor="middle"
                className={`text-[9px] tabular-nums ${
                  active ? 'fill-[#0F294A] font-bold' : 'fill-slate-500'
                }`}
              >
                {shortCode}
              </text>
            </g>
          );
        })}
      </svg>

      <p className="text-[10px] text-slate-500">
        เลือกจุดบนกราฟเพื่อดูแผนที่และข้อมูลรายอำเภอในงวดนั้น
      </p>
    </div>
  );
}
