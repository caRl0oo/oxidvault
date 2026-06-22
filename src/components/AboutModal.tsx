import { useId } from "react";
import { useTranslation } from "react-i18next";
import { AppLogo } from "@/components/AppLogo";
import { OverlayModal } from "@/components/ui/OverlayModal";
import {
  AGPL_LICENSE_URL,
  APP_COPYRIGHT,
  APP_NAME,
  APP_VERSION_LABEL,
} from "@/lib/appMeta";
import { openWebsiteUrl } from "@/lib/openWebsite";
import { runAsync } from "@/lib/runAsync";

interface AboutModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function AboutModal({ open, onClose }: Readonly<AboutModalProps>) {
  const { t } = useTranslation();
  const titleId = useId();

  const handleLicenseLinkClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    runAsync(() => openWebsiteUrl(AGPL_LICENSE_URL));
  };

  return (
    <OverlayModal
      open={open}
      onClose={onClose}
      ariaLabel={t("about.title")}
      ariaLabelledBy={titleId}
      closeLabel={t("common.closeDialog")}
      panelClassName="max-w-sm"
    >
      <header className="flex items-start justify-between gap-3 border-b border-vault-border px-5 py-4">
        <h2 id={titleId} className="font-mono text-sm font-semibold text-vault-text">
          {t("about.title")}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.closeDialog")}
          className="rounded border border-transparent px-1.5 py-0.5 font-mono text-sm leading-none text-vault-muted transition hover:border-vault-border hover:text-vault-text"
        >
          ×
        </button>
      </header>

      <div className="flex flex-col items-center px-5 py-6 text-center">
        <AppLogo size="lg" className="mb-4" />
        <p className="font-mono text-base font-semibold tracking-tight text-vault-text">{APP_NAME}</p>
        <p className="mt-1 font-mono text-xs text-vault-muted">{t("about.version", { version: APP_VERSION_LABEL })}</p>
        <p className="mt-4 font-mono text-[11px] text-vault-muted">{APP_COPYRIGHT}</p>
        <p className="mt-3 font-mono text-[11px] text-vault-muted">
          {t("about.licenseNotice")}{" "}
          <a
            href={AGPL_LICENSE_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleLicenseLinkClick}
            className="text-vault-accent underline decoration-vault-accent/40 underline-offset-2 transition hover:decoration-vault-accent"
          >
            {t("about.licenseLink")}
          </a>
        </p>
      </div>
    </OverlayModal>
  );
}
