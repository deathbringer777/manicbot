export const runtime = "edge";

import { PublicFooter } from "~/components/public/PublicFooter";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      <PublicFooter />
    </div>
  );
}
