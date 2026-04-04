"use client";

import { CheckCircle } from "lucide-react";

const STEPS = [
  { label: "Select Type", key: 1 },
  { label: "Verify Email", key: 2 },
  { label: "Upload Docs", key: 3 },
  { label: "Review", key: 4 },
  { label: "Payment", key: 5 },
  { label: "Success", key: 6 },
] as const;

const PHASE_TO_STEP: Record<string, number> = {
  check: 1,
  landing: 1,
  verify: 2,
  upload: 3,
  review: 4,
  confirm: 5,
  success: 6,
};

export function ProgressBar({ currentPhase }: { currentPhase: string }) {
  const currentStep = PHASE_TO_STEP[currentPhase] ?? 1;

  return (
    <div className="w-full flex items-center justify-center px-2 py-3 mb-2">
      <div className="flex items-center w-full max-w-2xl">
        {STEPS.map((step, i) => {
          const isCompleted = step.key < currentStep;
          const isCurrent = step.key === currentStep;

          return (
            <div key={step.key} className="flex items-center flex-1 last:flex-none">
              {/* Step circle + label */}
              <div className="flex flex-col items-center gap-1">
                {isCompleted ? (
                  <div className="h-7 w-7 rounded-full bg-green-500 flex items-center justify-center shadow-sm">
                    <CheckCircle className="h-4 w-4 text-white" />
                  </div>
                ) : isCurrent ? (
                  <div className="h-7 w-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shadow-sm ring-2 ring-primary/30 ring-offset-1">
                    {step.key}
                  </div>
                ) : (
                  <div className="h-7 w-7 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-xs font-medium">
                    {step.key}
                  </div>
                )}
                <span
                  className={`text-[10px] sm:text-[11px] leading-tight text-center whitespace-nowrap ${
                    isCompleted
                      ? "text-green-600 font-medium"
                      : isCurrent
                        ? "text-primary font-semibold"
                        : "text-muted-foreground"
                  }`}
                >
                  {step.label}
                </span>
              </div>

              {/* Connector line */}
              {i < STEPS.length - 1 && (
                <div className="flex-1 mx-1 relative h-0.5">
                  <div className="absolute inset-0 bg-muted rounded-full" />
                  {step.key < currentStep && (
                    <div className="absolute inset-0 bg-green-500 rounded-full transition-all duration-500" />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
