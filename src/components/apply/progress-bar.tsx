"use client";

import { CheckCircle } from "lucide-react";

const STEPS = [
  { label: "Check", key: 1 },
  { label: "Verify", key: 2 },
  { label: "Upload", key: 3 },
  { label: "Review", key: 4 },
  { label: "Pay", key: 5 },
  { label: "Done", key: 6 },
] as const;

const PHASE_TO_STEP: Record<string, number> = {
  check: 1,
  verify: 2,
  landing: 2,
  upload: 3,
  review: 4,
  confirm: 5,
  success: 6,
};

export function ProgressBar({ currentPhase }: { currentPhase: string }) {
  const currentStep = PHASE_TO_STEP[currentPhase] ?? 1;

  return (
    <div className="w-full max-h-[60px] flex items-center justify-center px-2 py-1">
      <div className="flex items-center w-full max-w-xl">
        {STEPS.map((step, i) => {
          const isCompleted = step.key < currentStep;
          const isCurrent = step.key === currentStep;

          return (
            <div key={step.key} className="flex items-center flex-1 last:flex-none">
              {/* Step circle + label */}
              <div className="flex flex-col items-center gap-0.5">
                {isCompleted ? (
                  <CheckCircle className="h-6 w-6 text-green-500 fill-green-500 stroke-white" />
                ) : isCurrent ? (
                  <div className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold animate-pulse">
                    {step.key}
                  </div>
                ) : (
                  <div className="h-6 w-6 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-xs font-medium">
                    {step.key}
                  </div>
                )}
                <span
                  className={`text-[10px] leading-tight ${
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
                <div
                  className={`flex-1 h-0.5 mx-1 ${
                    step.key < currentStep ? "bg-green-500" : "bg-muted"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
