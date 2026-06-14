import { redirect } from "next/navigation";

// Root redirects to the dashboard
export default function RootPage() {
  redirect("/dashboard");
}
