// Settings › About: app updates + the privacy note.
import { useTranslation } from "react-i18next";
import { UpdateSection } from "../UpdateSection.tsx";

export function AboutSection() {
  const { t } = useTranslation();
  return (
    <>
      <UpdateSection />
      <p className="privacy-note">{t("settings.privacyNote")}</p>
    </>
  );
}
