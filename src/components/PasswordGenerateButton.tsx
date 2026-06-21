import { useTranslation } from "react-i18next";

interface PasswordGenerateButtonProps {
  onClick: () => void;
  className?: string;
}

export function PasswordGenerateButton({
  onClick,
  className = "",
}: Readonly<PasswordGenerateButtonProps>) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      onClick={onClick}
      title={t("passwordGen.generateButtonTitle")}
      aria-label={t("passwordGen.generateButtonAria")}
      className={`shrink-0 rounded border border-vault-border p-2 text-vault-muted transition hover:border-vault-accent hover:text-vault-accent ${className}`}
    >
      <KeyIcon className="h-4 w-4" />
    </button>
  );
}

function KeyIcon({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="m21 2-9.6 9.6" />
      <path d="m15.5 7.5 3 3L22 7l-3-3" />
    </svg>
  );
}
