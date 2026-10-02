"use client";
import { useState } from "react";
export function TrendChart({
  data,
}: {
  data: { date: string; conversations: number; orders: number }[];
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const max = Math.max(4, ...data.flatMap((d) => [d.conversations, d.orders]));
  const point = (n: number, i: number) =>
    `${45 + i * 90},${190 - (n / max) * 155}`;
  const line = (key: "conversations" | "orders") =>
    data.map((d, i) => point(d[key], i)).join(" ");
  const focus = selected === null ? null : data[selected];
  return (
    <div className="trend-chart">
      <div className="chart-legend">
        <span>
          <i />
          Biseda
        </span>
        <span>
          <i />
          Porosi
        </span>
      </div>
      <svg
        viewBox="0 0 620 225"
        role="img"
        aria-label="Biseda dhe porosi të krijuara në 7 ditët e fundit"
      >
        <defs>
          <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8247ff" stopOpacity=".2" />
            <stop offset="100%" stopColor="#8247ff" stopOpacity=".01" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line
              x1="45"
              x2="585"
              y1={190 - i * 38.75}
              y2={190 - i * 38.75}
              stroke="#ededf7"
              strokeDasharray="3 3"
            />
            <text x="5" y={194 - i * 38.75} fontSize="11" fill="#8489a8">
              {Math.round((max * i) / 4)}
            </text>
          </g>
        ))}
        <polygon
          points={`45,190 ${line("conversations")} 585,190`}
          fill="url(#trend-fill)"
        />
        <polyline
          points={line("conversations")}
          fill="none"
          stroke="#7938ff"
          strokeWidth="2.5"
        />
        <polyline
          points={line("orders")}
          fill="none"
          stroke="#b393ff"
          strokeWidth="2.5"
        />
        {data.map((d, i) => (
          <g key={d.date}>
            <circle
              cx={45 + i * 90}
              cy={190 - (d.conversations / max) * 155}
              r="4"
              fill="#7938ff"
            />
            <text
              x={45 + i * 90}
              y="217"
              textAnchor="middle"
              fontSize="10"
              fill="#8489a8"
            >
              {`${new Date(d.date).getUTCDate()} ${["jan", "shk", "mar", "pri", "maj", "qer", "kor", "gsh", "sht", "tet", "nën", "dhj"][new Date(d.date).getUTCMonth()]}`}
            </text>
          </g>
        ))}
      </svg>
      <div className="chart-day-buttons">
        {data.map((d, i) => (
          <button
            key={d.date}
            type="button"
            aria-label={`Shiko statistikat për ${d.date.slice(0, 10)}`}
            aria-pressed={selected === i}
            onClick={() => setSelected(i)}
          >
            {new Date(d.date).getUTCDate()}
          </button>
        ))}
      </div>
      <p className="chart-detail" aria-live="polite">
        {focus
          ? `${focus.date.slice(0, 10)}: ${focus.conversations} biseda · ${focus.orders} porosi`
          : "Zgjidh një ditë për të parë numrat."}
      </p>
    </div>
  );
}
