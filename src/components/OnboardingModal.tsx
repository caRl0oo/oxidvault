// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ModalDialog } from "@/components/ui/ModalDialog";
import { MODAL_PANEL_CLASS } from "@/lib/uiClasses";

export const ONBOARDING_STORAGE_KEY = "oxidvault-onboarding-done";

const ONBOARDING_TITLE_ID = "onboarding-title";

const panelClass = `${MODAL_PANEL_CLASS} w-full max-w-md gap-6 p-8`;
const stepIndicatorClass = "flex justify-center gap-2";
const stepDotActiveClass = "h-2 w-2 rounded-full bg-vault-accent";
const stepDotInactiveClass = "h-2 w-2 rounded-full bg-vault-border";
const contentClass = "flex flex-col gap-3 text-center";
const iconClass = "text-4xl";
const titleClass = "font-mono text-lg font-semibold text-vault-text";
const descriptionClass = "font-mono text-sm text-vault-muted";
const navClass = "flex justify-between";
const skipClass = "font-mono text-xs text-vault-muted hover:text-vault-text";
const nextClass =
  "rounded bg-vault-accent px-4 py-2 font-mono text-sm text-vault-on-accent hover:opacity-90";

const STEPS = [
  {
    icon: "🔐",
    titleKey: "onboarding.step1.title",
    descKey: "onboarding.step1.desc",
  },
  {
    icon: "👥",
    titleKey: "onboarding.step2.title",
    descKey: "onboarding.step2.desc",
  },
  {
    icon: "🚀",
    titleKey: "onboarding.step3.title",
    descKey: "onboarding.step3.desc",
  },
] as const;

interface OnboardingModalProps {
  readonly onComplete: () => void;
}

export function OnboardingModal({ onComplete }: Readonly<OnboardingModalProps>) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);

  const currentStep = STEPS[step];
  const isLast = step === STEPS.length - 1;

  const handleNext = () => {
    if (isLast) {
      onComplete();
      return;
    }
    setStep((value) => value + 1);
  };

  return (
    <ModalDialog
      open
      onClose={onComplete}
      ariaLabelledBy={ONBOARDING_TITLE_ID}
    >
      <div className={panelClass}>
        <div className={stepIndicatorClass}>
          {STEPS.map((_, index) => (
            <div
              key={STEPS[index].titleKey}
              className={index === step ? stepDotActiveClass : stepDotInactiveClass}
            />
          ))}
        </div>
        <div className={contentClass}>
          <span className={iconClass} aria-hidden>
            {currentStep.icon}
          </span>
          <h2 id={ONBOARDING_TITLE_ID} className={titleClass}>
            {t(currentStep.titleKey)}
          </h2>
          <p className={descriptionClass}>{t(currentStep.descKey)}</p>
        </div>
        <div className={navClass}>
          <button type="button" onClick={onComplete} className={skipClass}>
            {t("onboarding.skip")}
          </button>
          <button type="button" onClick={handleNext} className={nextClass}>
            {isLast ? t("onboarding.done") : t("onboarding.next")}
          </button>
        </div>
      </div>
    </ModalDialog>
  );
}
