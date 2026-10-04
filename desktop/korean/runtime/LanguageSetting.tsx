import { toast } from "sonner";
import { setLocale, t, useLocale } from "./locale";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { SettingsOptionRow } from "@/features/settings/ui/SettingsOptionGroup";

export function LanguageSetting() {
  const locale = useLocale();
  return (
    <SettingsOptionRow data-testid="language-setting-row">
      <div className="min-w-0">
        <p className="text-sm font-medium">{t("Language")}</p>
        <p
          className="text-sm font-normal text-muted-foreground/70"
          data-settings-subcopy
        >
          {t("Choose the language used for menus and settings.")}
        </p>
      </div>
      <SegmentedControl
        legend={t("Language")}
        onValueChange={(next) => {
          try {
            setLocale(next);
          } catch {
            toast.error(t("Could not save your language preference."));
          }
        }}
        options={[
          { value: "ko", label: "한국어" },
          { value: "en", label: "English" },
        ]}
        optionTestIdPrefix="language-option"
        testId="language-control"
        value={locale}
      />
    </SettingsOptionRow>
  );
}
