import { VerifyView } from "@/components/TeamView";

// The link's code is in the address after the #, so it never reaches the server and is not part of this page's address.
export const metadata = { title: "Sign in to a team workspace", robots: { index: false } };

export default function VerifyPage() {
  return <VerifyView />;
}
