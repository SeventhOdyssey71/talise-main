import { TabPlaceholder } from "@/design/components/TabPlaceholder";

/** Profile tab — port of iOS Profile/ProfileView.swift (identity, KYC, banks, security, help). */
export default function ProfileScreen() {
  return (
    <TabPlaceholder
      title="Profile"
      subtitle="Account · Settings"
      icon="person.crop.circle.fill"
      note="Identity, KYC status, linked banks, handle, security (PIN/biometrics) and help land here as the Profile module is ported from iOS."
    />
  );
}
