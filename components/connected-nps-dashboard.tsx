import styles from "./connected-nps-dashboard.module.css";

// This is a standalone, read-only replica of the "Connected NPS" report
// built with static demo data. It does not read from or write to any of
// the existing dashboard/upload code paths in this project.

const FILTERS: Array<{ label: string; value: string }> = [
  { label: "Month", value: "01-06-2026" },
  { label: "Age", value: "All" },
  { label: "Category", value: "All" },
  { label: "Subcategory", value: "All" },
  { label: "Variant", value: "All" }
];

const YEAR_BARS = [
  { label: "23-24", value: null as number | null },
  { label: "24-25", value: null as number | null },
  { label: "25-26", value: 40.6 }
];

const CURRENT_YEAR_MONTHS = ["Apr", "May", "Jun", "Jul", "Aug"];
const CURRENT_YEAR_VALUES = [45.6, 42.9, 53.4, 54.0, 56.3];
const REMAINING_MONTHS = ["Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];
const COMPARISON_MONTHLY = [38.2, 41.5, 39.8, 43.6, 49.1, 45.3, 42.4, 46.0, 47.8, 50.6, 47.2, 43.9];
const YTD_VALUE = 50.4;
const CURRENT_MONTH_SAMPLE = 460;
const RESPONSIBLE = "S Manickaraj (SM)";

const WEEKS = ["21-Jun", "28-Jun", "05-Jul", "12-Jul", "19-Jul", "26-Jul", "02-Aug", "09-Aug"];
const WEEK_ACTUALS = [52.2, 50.6, 56.7, 55.7, 53.9, 40.0, 60.1, 39.5];
const WEEK_TARGETS = [0, 0, 0, 0, 0, 0, 0, 0];

type SampleMonth = {
  label: string;
  dialed: number;
  closeCall: number;
  respondents: number;
  respondentPct: number;
};

const SAMPLE_TREND: SampleMonth[] = [
  { label: "Mar-26", dialed: 846, closeCall: 620, respondents: 422, respondentPct: 50 },
  { label: "Apr-26", dialed: 1582, closeCall: 1522, respondents: 1145, respondentPct: 75 },
  { label: "May-26", dialed: 1674, closeCall: 1610, respondents: 1274, respondentPct: 76 },
  { label: "Jun-26", dialed: 993, closeCall: 860, respondents: 639, respondentPct: 64 },
  { label: "Jul-26", dialed: 841, closeCall: 730, respondents: 526, respondentPct: 63 },
  { label: "Aug-26", dialed: 578, closeCall: 547, respondents: 460, respondentPct: 84 }
];

const VARIANCE_VALUE = 639;

function NpsComboChart() {
  const width = 760;
  const height = 300;
  const left = 46;
  const right = 20;
  const top = 26;
  const bottom = 46;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const upperBound = 64;
  const ticks = [64, 48, 32, 16, 0];

  const categories = [
    ...YEAR_BARS.map((bar) => bar.label),
    ...CURRENT_YEAR_MONTHS,
    ...REMAINING_MONTHS,
    "YTD"
  ];
  const slot = plotWidth / categories.length;
  const getX = (index: number) => left + slot * index + slot / 2;
  const getY = (value: number) =>
    top + (1 - Math.min(value, upperBound) / upperBound) * plotHeight;

  const monthlyStartIndex = YEAR_BARS.length;
  const monthlyPoints = CURRENT_YEAR_VALUES.map(
    (value, index) => `${getX(monthlyStartIndex + index)},${getY(value)}`
  ).join(" ");

  const comparisonMonths = [...CURRENT_YEAR_MONTHS, ...REMAINING_MONTHS];
  const comparisonPoints = COMPARISON_MONTHLY.map(
    (value, index) => `${getX(monthlyStartIndex + index)},${getY(value)}`
  ).join(" ");

  const ytdIndex = categories.length - 1;

  return (
    <svg
      className={styles.chartSvg}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Connected NPS trend chart"
    >
      {ticks.map((tick) => {
        const y = getY(tick);

        return (
          <g key={tick}>
            <line
              x1={left}
              x2={width - right}
              y1={y}
              y2={y}
              stroke="#e2e8f0"
              strokeWidth={1}
            />
            <text x={left - 10} y={y + 4} fontSize={11} fill="#5a6b82" textAnchor="end">
              {tick}
            </text>
          </g>
        );
      })}
      <line
        x1={left}
        x2={width - right}
        y1={height - bottom}
        y2={height - bottom}
        stroke="#334155"
        strokeWidth={1.4}
      />

      {YEAR_BARS.map((bar, index) => {
        const x = getX(index);
        const barWidth = slot * 0.55;

        if (bar.value === null) {
          return (
            <text
              key={bar.label}
              x={x}
              y={height - bottom - 6}
              fontSize={11}
              fill="#94a3b8"
              textAnchor="middle"
            >
              NA
            </text>
          );
        }

        const barHeight = plotHeight * (bar.value / upperBound);

        return (
          <g key={bar.label}>
            <rect
              x={x - barWidth / 2}
              y={height - bottom - barHeight}
              width={barWidth}
              height={barHeight}
              fill="#ffffff"
              stroke="#334155"
              strokeWidth={1.2}
            />
            <text
              x={x}
              y={height - bottom - barHeight - 8}
              fontSize={12}
              fontWeight={700}
              fill="#1f2937"
              textAnchor="middle"
            >
              {bar.value.toFixed(1)}
            </text>
          </g>
        );
      })}

      <polyline points={comparisonPoints} fill="none" stroke="#c3c9d4" strokeWidth={1.6} />
      <polyline points={monthlyPoints} fill="none" stroke="#1f9d55" strokeWidth={2.4} />

      {CURRENT_YEAR_VALUES.map((value, index) => {
        const x = getX(monthlyStartIndex + index);
        const y = getY(value);

        return (
          <g key={CURRENT_YEAR_MONTHS[index]}>
            <circle cx={x} cy={y} r={3.2} fill="#1f9d55" stroke="#ffffff" strokeWidth={1.4} />
            <text x={x} y={y - 10} fontSize={11} fontWeight={700} fill="#1f9d55" textAnchor="middle">
              {value.toFixed(1)}
            </text>
          </g>
        );
      })}

      <rect
        x={getX(ytdIndex) - slot * 0.28}
        y={getY(YTD_VALUE)}
        width={slot * 0.56}
        height={height - bottom - getY(YTD_VALUE)}
        fill="#1f9d55"
      />
      <text
        x={getX(ytdIndex)}
        y={getY(YTD_VALUE) - 8}
        fontSize={12}
        fontWeight={700}
        fill="#1f9d55"
        textAnchor="middle"
      >
        {YTD_VALUE.toFixed(1)}
      </text>

      {categories.map((label, index) => (
        <text
          key={`${label}-${index}`}
          x={getX(index)}
          y={height - bottom + 16}
          fontSize={10.5}
          fill="#5a6b82"
          textAnchor="middle"
        >
          {label}
        </text>
      ))}
    </svg>
  );
}

function SampleTrendChart() {
  const width = 560;
  const height = 280;
  const left = 40;
  const right = 12;
  const top = 44;
  const bottom = 34;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maxCount = Math.max(1, ...SAMPLE_TREND.map((month) => month.dialed));
  const slot = plotWidth / SAMPLE_TREND.length;
  const barGroupWidth = slot * 0.68;
  const barWidth = barGroupWidth / 3;

  const getBarHeight = (value: number) => (value / maxCount) * plotHeight;
  const getPctY = (pct: number) => top + (1 - pct / 100) * plotHeight;

  const pctPoints = SAMPLE_TREND.map((month, index) => {
    const x = left + slot * index + slot / 2;
    return `${x},${getPctY(month.respondentPct)}`;
  }).join(" ");

  return (
    <svg
      className={styles.chartSvg}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Sample trend for the last six months"
    >
      <line
        x1={left}
        x2={width - right}
        y1={height - bottom}
        y2={height - bottom}
        stroke="#334155"
        strokeWidth={1.2}
      />

      {SAMPLE_TREND.map((month, index) => {
        const groupX = left + slot * index + (slot - barGroupWidth) / 2;
        const bars: Array<{ value: number; color: string; offset: number }> = [
          { value: month.dialed, color: "#4f8ef0", offset: 0 },
          { value: month.closeCall, color: "#9a6fd1", offset: 1 },
          { value: month.respondents, color: "#f5a25d", offset: 2 }
        ];

        return (
          <g key={month.label}>
            {bars.map((bar) => {
              const barHeight = getBarHeight(bar.value);
              const x = groupX + bar.offset * barWidth;

              return (
                <g key={bar.color}>
                  <rect
                    x={x}
                    y={height - bottom - barHeight}
                    width={barWidth - 3}
                    height={barHeight}
                    fill={bar.color}
                  />
                  <text
                    x={x + (barWidth - 3) / 2}
                    y={height - bottom - barHeight - 4}
                    fontSize={9}
                    fill="#334155"
                    textAnchor="middle"
                  >
                    {bar.value}
                  </text>
                </g>
              );
            })}
            <text
              x={left + slot * index + slot / 2}
              y={height - bottom + 16}
              fontSize={10.5}
              fill="#5a6b82"
              textAnchor="middle"
            >
              {month.label}
            </text>
          </g>
        );
      })}

      <polyline points={pctPoints} fill="none" stroke="#f2b705" strokeWidth={2.2} />
      {SAMPLE_TREND.map((month, index) => {
        const x = left + slot * index + slot / 2;
        const y = getPctY(month.respondentPct);

        return (
          <g key={`pct-${month.label}`}>
            <circle cx={x} cy={y} r={3} fill="#f2b705" stroke="#ffffff" strokeWidth={1} />
            <rect
              x={x - 15}
              y={y - 20}
              width={30}
              height={14}
              rx={3}
              fill="#f2b705"
              opacity={0.9}
            />
            <text x={x} y={y - 10} fontSize={9.5} fontWeight={700} fill="#3a2c00" textAnchor="middle">
              {month.respondentPct}%
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function VarianceChart() {
  const width = 320;
  const height = 240;
  const left = 30;
  const right = 20;
  const top = 30;
  const bottom = 26;
  const plotHeight = height - top - bottom;
  const maxValue = VARIANCE_VALUE * 1.1;
  const barHeight = (VARIANCE_VALUE / maxValue) * plotHeight;
  const barWidth = 90;
  const x = width / 2 - barWidth / 2;

  return (
    <svg
      className={styles.chartSvg}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Connected rating variance"
    >
      <line
        x1={left}
        x2={width - right}
        y1={height - bottom}
        y2={height - bottom}
        stroke="#334155"
        strokeWidth={1.2}
      />
      <text x={width / 2} y={top - 8} fontSize={12} fontWeight={700} fill="#1f2937" textAnchor="middle">
        {VARIANCE_VALUE}
      </text>
      <rect
        x={x}
        y={height - bottom - barHeight}
        width={barWidth}
        height={barHeight}
        fill="#4f8ef0"
      />
    </svg>
  );
}

export function ConnectedNpsDashboard() {
  return (
    <div className={styles.page}>
      <div className={styles.main}>
        <header className={styles.topbar}>
          <h1 className={styles.pageTitle}>Connected NPS</h1>
        </header>
        <div className={styles.accentBar} />

        <div className={styles.filters}>
          {FILTERS.map((filter) => (
            <div className={styles.filterField} key={filter.label}>
              <span className={styles.filterLabel}>{filter.label}</span>
              <div className={styles.filterValue}>
                <span>{filter.value}</span>
                <span>{"▾"}</span>
              </div>
            </div>
          ))}
        </div>

        <main className={styles.content}>
          <div className={styles.sectionBanner}>EV Performance</div>

          <div className={styles.topGrid}>
            <div className={styles.leftStack}>
              <section className={styles.card}>
                <div className={styles.cardHead}>
                  <div className={styles.cardHeadLeft}>
                    <small>UOM : Net Promoter Score</small>
                    <strong>Connected NPS</strong>
                  </div>
                  <div className={styles.cardHeadRight}>
                    <span>Current Month Sample : {CURRENT_MONTH_SAMPLE}</span>
                    <span className={`${styles.statusDot} ${styles.good}`} />
                  </div>
                </div>
                <div className={styles.yearTabs}>
                  <span>2024</span>
                  <span>2025</span>
                  <span>2026</span>
                  <span className={styles.yearActive}>2027</span>
                </div>
                <div className={styles.chartBody}>
                  <NpsComboChart />
                </div>
                <div className={styles.respLine}>
                  RESP(Responsible) : <strong>{RESPONSIBLE}</strong>
                </div>
              </section>

              <section className={styles.card}>
                <div className={styles.cardHead}>
                  <div className={styles.cardHeadLeft}>
                    <strong>Last 8 Weeks Actual</strong>
                  </div>
                </div>
                <div className={styles.tableScroll}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Start of Week</th>
                        {WEEKS.map((week) => (
                          <th key={week}>{week}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Actual</td>
                        {WEEK_ACTUALS.map((value, index) => (
                          <td key={`actual-${WEEKS[index]}`}>{value.toFixed(1)}</td>
                        ))}
                      </tr>
                      <tr>
                        <td>Target</td>
                        {WEEK_TARGETS.map((value, index) => (
                          <td key={`target-${WEEKS[index]}`}>{value.toFixed(1)}</td>
                        ))}
                      </tr>
                      <tr>
                        <td>Achievement%</td>
                        {WEEKS.map((week) => (
                          <td key={`ach-${week}`}>&nbsp;</td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            <div className={styles.rightStack}>
              <section className={styles.card}>
                <div className={styles.cardHead}>
                  <div className={styles.cardHeadLeft}>
                    <strong>Sample Trend (Last 6 Months)</strong>
                  </div>
                </div>
                <div className={styles.legendRow}>
                  <span className={styles.legendDialed}>Total Dialed</span>
                  <span className={styles.legendClose}>Total Close Call</span>
                  <span className={styles.legendResp}>Number of Respondents</span>
                  <span className={styles.legendPct}>Respondent%</span>
                </div>
                <div className={styles.chartBody}>
                  <SampleTrendChart />
                </div>
              </section>

              <section className={styles.card}>
                <div className={styles.cardHead}>
                  <div className={styles.cardHeadLeft}>
                    <strong>Connected Rating Variance</strong>
                  </div>
                </div>
                <div className={styles.variancePanel}>
                  <VarianceChart />
                </div>
              </section>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
