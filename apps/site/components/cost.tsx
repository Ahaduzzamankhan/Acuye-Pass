"use client";

import type { CSSProperties } from "react";
import { useState } from "react";

const YEARS = [1, 3, 5] as const;
type Years = (typeof YEARS)[number];

const PLANS = [
  {
    name: "Acuye Pass",
    yearly: 0,
    period: "MIT · everything included",
    ours: true,
    points: ["No account, no server bill", "Every feature, no upsell", "Your time is the real cost"],
  },
  {
    name: "Bitwarden Premium",
    yearly: 19.8,
    period: "individual, yearly billing",
    ours: false,
    points: ["TOTP and attachments", "Sync and sharing", "Audited, mature"],
  },
  {
    name: "1Password Individual",
    yearly: 47.88,
    period: "individual, yearly billing",
    ours: false,
    points: ["No free tier", "Polished autofill", "Secret Key model"],
  },
];

const money = (value: number) =>
  value === 0 ? "$0" : `$${value.toFixed(2).replace(/\.00$/, "")}`;

export function Cost() {
  const [years, setYears] = useState<Years>(3);
  const max = Math.max(...PLANS.map((plan) => plan.yearly * years));

  return (
    <>
      <div className="cost__toggle" role="group" aria-label="Cost horizon">
        {YEARS.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={years === option}
            onClick={() => setYears(option)}
          >
            {option} {option === 1 ? "year" : "years"}
          </button>
        ))}
      </div>

      <div className="cost">
        {PLANS.map((plan) => {
          const total = plan.yearly * years;
          return (
            <div className={`price${plan.ours ? " price--ours" : ""}`} key={plan.name}>
              <div className="price__name">
                {plan.name}
                {plan.ours ? <span className="pill pill--live">this project</span> : null}
              </div>
              <div className="price__amount">{money(total)}</div>
              <div className="price__period">
                {plan.ours
                  ? "for every year, forever"
                  : `${money(plan.yearly)}/yr × ${years}`}
              </div>
              <div className="price__bar">
                <span
                  data-zero={total === 0}
                  style={{ "--width": max === 0 ? "0%" : `${(total / max) * 100}%` } as CSSProperties}
                />
              </div>
              <ul>
                {plan.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="cost__foot">
        {years === 1 ? "One" : years} {years === 1 ? "year" : "years"} of individual plans at
        list price, checked November 2026: Bitwarden Premium $19.80/yr, 1Password Individual
        $47.88/yr billed yearly. Acuye Pass is $0 because there is no server to run and no
        support team to pay — that is also why it has no audit budget.
      </p>
    </>
  );
}
